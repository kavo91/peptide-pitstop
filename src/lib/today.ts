/**
 * Build the multi-peptide "Today" view: every protocol due today, across all
 * peptides, with the data the log form needs. Server-side (reads DB).
 */
import { prisma } from "@/lib/db";
import { startOfDay, addDays } from "@/lib/schedule/schedule";
import { classifyOverrideDays, dueSlotsForDay } from "@/lib/today-overrides";
import { resolveTitration } from "@/lib/titration/resolve";
import { buildResolveInput } from "@/lib/titration/from-protocol";
import { perInjectionDose } from "@/lib/titration/dose-basis";
import { dosesPerWeek } from "@/lib/schedule/frequency";
import type { ResolvedSlot, PhaseProgress } from "@/lib/titration/types";
import type { DoseUnit } from "@/lib/dosing/types";

/** Monday (local) of the week containing `date` — matches the calendar's Monday-first weeks. */
const weekStart = (d: Date) => addDays(startOfDay(d), -((startOfDay(d).getDay() + 6) % 7));

export interface DueDose {
  protocolId: string;
  peptideId: string;
  peptideName: string;
  /** "injection" | "oral" — oral renders the simplified log form (no prep/syringe/site). */
  route: string;
  doseValue: string;
  doseUnit: DoseUnit;
  /**
   * Scheduled slot time "HH:MM" (local), or null for an untimed dose.
   * Used to pre-fill the log form and label the card.
   */
  time: string | null;
  /**
   * Unique key for this slot within the day: `${protocolId}@${time ?? "any"}`.
   * Used as the React list key so multi-slot peptides each get a distinct card.
   */
  slotKey: string;
  /** Active prep for this peptide, or null if the dry vial isn't reconstituted yet. */
  preparation: { id: string; concentrationMcgPerMl: string; remainingMl: string } | null;
  /** A vial awaiting preparation, when no active prep exists. Drives the recon wizard. */
  vialForPrep: { id: string; labelStrengthMg: string } | null;
  syringe:
    | { id: string; name: string; graduationType: "units" | "ml"; unitsPerMl: number; capacityMl: string; capacityUnits: number; increment: string }
    | null;
  /**
   * True if this slot is considered already logged.
   * - Timed slot: a DoseLog for this protocol today within ±adherenceWindowMin of slot time.
   * - Untimed slot: any DoseLog for this protocol today (preserves prior behaviour).
   */
  alreadyLoggedToday: boolean;
  /** Hours since the most recent dose for this peptide. null = no prior dose. */
  hoursSinceLast: number | null;
  /** From Peptide.halfLifeHours; null when unset. */
  halfLifeHours: number | null;
  /** From Peptide.minIntervalHours; null when unset. */
  minIntervalHours: number | null;
  /** Titration phase position for the protocol (null = non-titration). Drives the "Phase N of M" label. */
  phaseProgress: PhaseProgress | null;
}

export interface LoggedDose {
  id: string;
  peptideName: string;
  doseMcg: string;
  doseInputUnit: string;
  volumeMl: string;
  injectionSite: string | null;
  /** "injection" | "oral" — drives the logged-dose display (oral shows the dose value, no site). */
  route: string;
  timeLabel: string;
}

/** Doses recorded during the local day — scheduled or ad-hoc — newest first. */
export async function getLoggedToday(userId: string, date = new Date()): Promise<LoggedDose[]> {
  const day = startOfDay(date);
  const nextDay = new Date(day.getTime() + 86_400_000);
  const logs = await prisma.doseLog.findMany({
    where: { userId, takenAt: { gte: day, lt: nextDay } },
    include: {
      preparation: { include: { vial: { include: { peptide: true } } } },
      // Oral doses have no preparation — resolve the peptide name via the protocol.
      protocol: { include: { peptide: true } },
    },
    orderBy: { takenAt: "desc" },
  });
  return logs.map((l) => ({
    id: l.id,
    // Injection doses name via prep→vial→peptide; oral doses (no prep) fall back
    // to the linked protocol's peptide, then a generic "Oral dose" label.
    peptideName: l.preparation?.vial.peptide.name ?? l.protocol?.peptide.name ?? "Oral dose",
    doseMcg: l.doseMcg.toString(),
    doseInputUnit: l.doseInputUnit,
    volumeMl: l.volumeMl.toString(),
    injectionSite: l.injectionSite,
    route: l.route ?? "injection",
    timeLabel: new Date(l.takenAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
  }));
}

/** Dashboard dose-status summary for the day. Drives the pitstop header chip. */
export interface TodayDoseStatus {
  /** "none" = nothing due today; "behind" = an overdue dose exists; "on_track" = all due so far logged. */
  status: "on_track" | "behind" | "none";
  /** Count of due-but-unlogged slots whose timed slot is already past the current local time. */
  overdue: number;
  /** Count of due-but-unlogged slots (timed or untimed). */
  remaining: number;
  /** Count of due slots already logged today. */
  logged: number;
}

/**
 * Read-only day status for the dashboard header chip. Derived purely from
 * getTodayDoses: an unlogged TIMED slot whose "HH:MM" is earlier than the
 * current local "HH:MM" is overdue; untimed unlogged slots are never overdue.
 * No DB writes, no extra queries beyond getTodayDoses.
 */
export async function getTodayDoseStatus(userId: string, now = new Date()): Promise<TodayDoseStatus> {
  const due = await getTodayDoses(userId, now);
  const total = due.length;
  const remainingItems = due.filter((d) => !d.alreadyLoggedToday);
  const remaining = remainingItems.length;
  const logged = total - remaining;
  // Current local wall-clock as zero-padded "HH:MM" for a lexical compare with slot.time.
  const nowHHMM = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const overdue = remainingItems.filter((d) => d.time !== null && d.time < nowHHMM).length;
  const status = total === 0 ? "none" : overdue > 0 ? "behind" : "on_track";
  return { status, overdue, remaining, logged };
}

export async function getTodayDoses(userId: string, date = new Date()): Promise<DueDose[]> {
  const day = startOfDay(date);
  const nextDay = new Date(day.getTime() + 86_400_000);

  const protocols = await prisma.protocol.findMany({
    where: { userId, status: "active" },
    include: { peptide: true, steps: true },
  });

  // Rebase overrides for this week: a confirmed snap-back deletes the week's
  // on-grid rows and writes shifted (OFF-grid) ones. Only those off-grid rows
  // count as an override — routine rows materialised by the rolling-dose cron
  // sit ON the live grid and must NOT hijack Today, or the live schedule
  // (including custom multi-time slots) would be ignored.
  const ws = weekStart(day);
  const overrides = await prisma.plannedDose.findMany({
    where: { userId, status: "planned", scheduledAt: { gte: ws, lt: addDays(ws, 7) } },
  });
  // Override classification is pure (no I/O) and lives in today-overrides.ts so
  // it can be unit-tested. TZ ASSUMPTION (WS6): it derives each row's local
  // calendar day from `scheduledAt` (an instant standing for a LOCAL midnight)
  // using the runtime TZ — correct only when the container TZ matches the write
  // TZ (Australia/Brisbane). A wrong TZ shifts Monday→Sunday and misreads a
  // routine on-grid row as an off-grid rebase override (dose shows "due" a day
  // early). Hardened by the env fix + the startup guard in instrumentation.ts +
  // today.test.ts. Deeper fix (out of scope): persist an explicit local-date on
  // PlannedDose so this never depends on runtime TZ. See today-overrides.ts.
  const overrideDays = classifyOverrideDays(protocols, overrides);

  const due: DueDose[] = [];

  for (const p of protocols) {
    if (!p.scheduleRule) continue;

    // Determine which slots are due today. Override days are always untimed;
    // otherwise the live grid wins. (Pure decision — see today-overrides.ts.)
    const slots = dueSlotsForDay(p.scheduleRule, overrideDays.get(p.id), day, p.startDate, p.endDate);

    if (slots.length === 0) continue;

    // Resolve dose + live status via the single source of truth. The phase
    // cursor counts DELIVERED doses, so the resolver needs this protocol's FULL
    // log history (not just today's) — a raw step.dose/targetDose must never
    // reach a dose path (spec §6: a per_week weekly value here = 7×–365×
    // overdose). All protocol logs are loaded once and passed as `delivered`.
    const allProtocolLogs = await prisma.doseLog.findMany({
      where: { userId, protocolId: p.id },
      select: { id: true, takenAt: true },
    });
    const resolved = resolveTitration(
      buildResolveInput({
        protocol: p,
        deliveredLogs: allProtocolLogs,
        range: { start: day, end: day },
        now: day,
      }),
    );
    // Index resolved slots by their time so each due slot reads its own dose.
    const resolvedByTime = new Map<string | null, ResolvedSlot>();
    for (const rs of resolved.slots) if (!resolvedByTime.has(rs.time ?? null)) resolvedByTime.set(rs.time ?? null, rs);
    // Day-level fallback (override days are untimed and may not align to a grid slot).
    const dayResolved = resolved.slots[0] ?? null;

    // Oral peptides have NO preparation, vial-to-prep, or syringe — those are
    // injection-only. Skip all three lookups so an oral protocol is loggable
    // without a vial/prep (the card renders the simplified oral form).
    const isOral = p.peptide.route === "oral";

    // Shared per-peptide resources — resolved once and reused across all slots.
    // Prefer the protocol's pinned vial so Today resolves the SAME prep the stack
    // button uses when a peptide has >1 active prep; legacy rows (null vialId)
    // fall back to the most recent in-use vial. Mirrors getStacks/logStack/
    // stackComponentVialIds in actions/stacks.ts.
    const prep = isOral
      ? null
      : await prisma.preparation.findFirst({
          where: p.vialId
            ? { active: true, vialId: p.vialId }
            : { active: true, vial: { peptideId: p.peptideId, userId, status: "in_use" } },
          orderBy: { reconstitutedAt: "desc" },
        });

    const vialForPrep = isOral || prep
      ? null
      : await prisma.vial.findFirst({
          // Prefer the protocol's pinned vial so the unprepped-vial fallback points
          // at the same vial the prep lookup pins; legacy rows (null vialId) fall
          // back to the most recent sealed/in-use vial for the peptide.
          where: p.vialId
            ? { id: p.vialId, userId }
            : { userId, peptideId: p.peptideId, status: { in: ["sealed", "in_use"] } },
          orderBy: { openedAt: "desc" },
        });

    const syringe = !isOral && p.defaultSyringeId
      ? await prisma.syringe.findUnique({ where: { id: p.defaultSyringeId } })
      : null;

    // Fetch all of today's logs for this protocol (used for per-slot consumed tracking).
    const todayLogs = await prisma.doseLog.findMany({
      where: { userId, protocolId: p.id, takenAt: { gte: day, lt: nextDay } },
      orderBy: { takenAt: "asc" },
    });

    // Half-life timing: most recent DoseLog for this peptide (any protocol).
    // Same value for every slot; measuring from the actual reference time (not
    // midnight) avoids understating elapsed hours.
    const lastDoseLog = await prisma.doseLog.findFirst({
      where: { userId, preparation: { vial: { peptideId: p.peptideId } } },
      orderBy: { takenAt: "desc" },
    });
    // Clamp negatives (a just-logged dose).
    const hoursSinceLast = lastDoseLog
      ? Math.max(0, (date.getTime() - new Date(lastDoseLog.takenAt).getTime()) / 3_600_000)
      : null;

    const halfLifeHours = p.peptide.halfLifeHours != null ? Number(p.peptide.halfLifeHours.toString()) : null;
    const minIntervalHours = p.peptide.minIntervalHours != null ? Number(p.peptide.minIntervalHours.toString()) : null;

    // Per-slot consumed tracking: each untimed log can satisfy at most one slot.
    const consumedLogIds = new Set<string>();

    for (const slot of slots) {
      // Per-injection dose comes ONLY from the resolver (never raw step.dose /
      // targetDose). Match the resolved slot by time; fall back to the day's
      // resolved slot (override days are untimed and may not align to a grid
      // slot). doseValue is PATIENT-FACING — it prefills LogDoseForm → the
      // injected volume — so a raw per_week weekly value here is a 2–7× overdose
      // (spec §6). On a no-slot fallback we divide a per_week target; if the
      // frequency can't be resolved we leave doseValue "" (no prefilled dose —
      // LogDoseForm guards on empty and disables submit) rather than overdose.
      const slotResolved = resolvedByTime.get(slot.time ?? null) ?? dayResolved;
      let doseValue = slotResolved?.perInjectionValue ?? "";
      let doseUnit = (slotResolved?.perInjectionUnit ?? (p.doseInputUnit as DoseUnit) ?? "mcg") as DoseUnit;
      if (!slotResolved && p.targetDose != null) {
        const per = perInjectionDose({
          doseBasis: p.doseBasis === "per_week" ? "per_week" : "per_injection",
          value: p.targetDose.toString(),
          unit: doseUnit,
          injectionsPerWeek: dosesPerWeek(p.scheduleRule),
        });
        if (per) {
          doseValue = per.value;
          doseUnit = per.unit;
        }
      }

      // alreadyLoggedToday: the resolver's live status is authoritative for a
      // timed slot (it uses the same ±adherenceWindow match). An untimed slot
      // keeps the prior "any log today satisfies it" rule (the resolver matches
      // an untimed slot against local midnight, which would miss a daytime
      // log), preserving non-titration behaviour exactly.
      // A protocol's slots on a given day are either all timed or all untimed
      // (slotsOn dedups by time and untimed-vs-timed don't coexist for one
      // entry), so the timed (resolver-status) and untimed (consumedLogIds)
      // branches never both run for the same protocol+day — no double-counting.
      let alreadyLoggedToday = false;
      if (slot.time !== null) {
        alreadyLoggedToday = slotResolved?.status === "taken";
      } else {
        // Untimed slot: any unconsumed log today satisfies it.
        const matchingLog = todayLogs.find((l) => !consumedLogIds.has(l.id));
        if (matchingLog) {
          consumedLogIds.add(matchingLog.id);
          alreadyLoggedToday = true;
        }
      }

      due.push({
        protocolId: p.id,
        peptideId: p.peptideId,
        peptideName: p.peptide.name,
        route: p.peptide.route,
        doseValue,
        doseUnit,
        time: slot.time,
        slotKey: `${p.id}@${slot.time ?? "any"}`,
        preparation: prep
          ? { id: prep.id, concentrationMcgPerMl: prep.concentrationMcgPerMl.toString(), remainingMl: prep.remainingMl.toString() }
          : null,
        vialForPrep: vialForPrep ? { id: vialForPrep.id, labelStrengthMg: vialForPrep.labelStrengthMg.toString() } : null,
        syringe: syringe
          ? {
              id: syringe.id,
              name: syringe.name,
              graduationType: syringe.graduationType as "units" | "ml",
              unitsPerMl: syringe.unitsPerMl,
              capacityMl: syringe.capacityMl.toString(),
              capacityUnits: syringe.capacityUnits,
              increment: syringe.increment.toString(),
            }
          : null,
        alreadyLoggedToday,
        hoursSinceLast,
        halfLifeHours,
        minIntervalHours,
        phaseProgress: resolved.phaseProgress,
      });
    }
  }

  return due;
}
