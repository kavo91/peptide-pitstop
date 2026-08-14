/**
 * Build the multi-peptide "Today" view: every protocol due today, across all
 * peptides, with the data the log form needs. Server-side (reads DB).
 */
import { prisma } from "@/lib/db";
import { startOfDay, addDays } from "@/lib/schedule/schedule";
import { classifyOverrideDays, dueSlotsForDay, dayKey } from "@/lib/today-overrides";
import { localeTimeLabel } from "@/lib/tz-day";
import { resolveTitration } from "@/lib/titration/resolve";
import { buildResolveInput } from "@/lib/titration/from-protocol";
import { perInjectionDose } from "@/lib/titration/dose-basis";
import { dosesPerWeek } from "@/lib/schedule/frequency";
import { budStatus, resolveBudDays, type BudState } from "@/lib/bud";
import type { ResolvedSlot, PhaseProgress } from "@/lib/titration/types";
import type { DoseUnit } from "@/lib/dosing/types";
import { compareStackGrouped, compareTime } from "@/lib/stack-sort";
import type { Prisma } from "@prisma/client";

/** Monday (local) of the week containing `date` — matches the calendar's Monday-first weeks. */
const weekStart = (d: Date) => addDays(startOfDay(d), -((startOfDay(d).getDay() + 6) % 7));

export function buildTodayProtocolWhere(userId: string, day: Date, nextDay: Date): Prisma.ProtocolWhereInput {
  return {
    userId,
    OR: [
      { status: "active" },
      {
        status: "completed",
        doseLogs: {
          some: {
            userId,
            // localDay-first day bucketing, same as getLoggedToday.
            OR: [{ localDay: dayKey(day) }, { localDay: null, takenAt: { gte: day, lt: nextDay } }],
          },
        },
      },
    ],
  };
}

export function shouldShowCompletedLoggedFallback(status: string, slotCount: number, todayLogCount: number): boolean {
  return status === "completed" && slotCount === 0 && todayLogCount > 0;
}

export interface DueDose {
  protocolId: string;
  peptideId: string;
  peptideName: string;
  stackId?: string | null;
  stackName?: string | null;
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
  preparation: {
    id: string;
    concentrationMcgPerMl: string;
    remainingMl: string;
    /** ISO date; drives the beyond-use warning in LogDoseForm. Null when unrecorded. */
    beyondUseDate: string | null;
  } | null;
  /** ok | approaching | passed | unknown, for the badge on the collapsed row. */
  budState: BudState;
  /** A vial awaiting preparation, when no active prep exists. Drives the recon wizard. */
  vialForPrep: { id: string; labelStrengthMg: string; budDefaultDays: number } | null;
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
  /** True when the slot is displayed because the schedule was rebased/shifted. */
  shifted: boolean;
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
  // Day bucketing: a client-stamped localDay is authoritative (travel-proof —
  // a dose taken Friday night in Chile files under Friday even though its
  // takenAt instant is Saturday in the runtime TZ). Legacy rows (null
  // localDay) keep the original runtime-TZ instant window.
  const viewKey = dayKey(day);
  const logs = await prisma.doseLog.findMany({
    where: {
      userId,
      OR: [{ localDay: viewKey }, { localDay: null, takenAt: { gte: day, lt: nextDay } }],
    },
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
    // Render the wall clock the dose was actually taken at: the stored tz when
    // stamped (22:09 in Chile shows a Chile clock, not the runtime-TZ 12:09),
    // else the runtime TZ. ONE locale format for both branches so stamped and
    // legacy rows never mix 12h/24h styles in the same list.
    timeLabel: localeTimeLabel(new Date(l.takenAt), l.tz),
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
export async function getTodayDoseStatus(userId: string, now = new Date(), nowHHMMOverride?: string): Promise<TodayDoseStatus> {
  // `now` may be a noon day-anchor while travelling / during the 02:00 grace
  // window. Dose intervals still use the real server instant.
  const due = await getTodayDoses(userId, now, new Date());
  const total = due.length;
  const remainingItems = due.filter((d) => !d.alreadyLoggedToday);
  const remaining = remainingItems.length;
  const logged = total - remaining;
  // Current local wall-clock as zero-padded "HH:MM" for a lexical compare with
  // slot.time. When the caller anchors `now` to a viewer's NOON day anchor
  // (viewerToday().date abroad), it MUST pass the viewer's real wall clock via
  // nowHHMMOverride — otherwise every slot would be compared against "12:00".
  const nowHHMM = nowHHMMOverride ?? `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const overdue = remainingItems.filter((d) => d.time !== null && d.time < nowHHMM).length;
  const status = total === 0 ? "none" : overdue > 0 ? "behind" : "on_track";
  return { status, overdue, remaining, logged };
}

export async function getTodayDoses(
  userId: string,
  date = new Date(),
  intervalNow = date,
): Promise<DueDose[]> {
  const day = startOfDay(date);
  const nextDay = new Date(day.getTime() + 86_400_000);

  const protocols = await prisma.protocol.findMany({
    where: buildTodayProtocolWhere(userId, day, nextDay),
    include: { peptide: true, stack: true, steps: true },
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

    // Fetch all of today's logs for this protocol (used for per-slot consumed
    // tracking). Same localDay-first bucketing as getLoggedToday: a stamped
    // dose belongs to its FROZEN day only — a Chile-Friday dose whose instant
    // is runtime-Saturday must not satisfy Saturday's untimed slot.
    const todayLogs = await prisma.doseLog.findMany({
      where: {
        userId,
        protocolId: p.id,
        OR: [{ localDay: dayKey(day) }, { localDay: null, takenAt: { gte: day, lt: nextDay } }],
      },
      orderBy: { takenAt: "asc" },
    });

    // Determine which slots are due today. Override days are always untimed;
    // otherwise the live grid wins. Completed protocols with a same-day log get
    // one read-only logged fallback row when the live grid has no slot, so Today
    // still reflects a protocol that was logged before/around completion without
    // adding any new "to go" work.
    const slots = dueSlotsForDay(p.scheduleRule, overrideDays.get(p.id), day, p.startDate, p.endDate);
    const completedLoggedFallback = shouldShowCompletedLoggedFallback(p.status, slots.length, todayLogs.length);
    const shiftedOverrideToday = overrideDays.get(p.id)?.has(dayKey(day)) === true;
    const effectiveSlots = completedLoggedFallback
      ? [{ time: null }]
      : slots;

    if (effectiveSlots.length === 0) continue;

    // Resolve dose + live status via the single source of truth. The phase
    // cursor counts DELIVERED doses, so the resolver needs this protocol's FULL
    // log history (not just today's) — a raw step.dose/targetDose must never
    // reach a dose path (spec §6: a per_week weekly value here = 7×–365×
    // overdose). All protocol logs are loaded once and passed as `delivered`.
    const allProtocolLogs = await prisma.doseLog.findMany({
      where: { userId, protocolId: p.id },
      select: { id: true, takenAt: true, localDay: true },
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
    // A within-week fixed_anchor rebase makes resolveTitration return the WHOLE
    // rebased week (an off-grid Sunday dose shifts M–F to Sun–Thu), so even a
    // single-day range can yield slots on OTHER days — all sharing the same
    // "HH:MM". Indexing those by time alone let a *different* day's slot answer
    // for today: a taken Sunday 21:00 slot was picked up by today's 21:00 slot,
    // so Monday's card wrongly read "logged". Restrict to slots whose local
    // calendar day IS today before indexing (today.ts asked for this day only;
    // the calendar clips the same over-expansion via clipSlotsToRange).
    const todayKey = dayKey(day);
    const daySlots = resolved.slots.filter((rs) => dayKey(rs.date) === todayKey);
    const resolvedByTime = new Map<string | null, ResolvedSlot>();
    for (const rs of daySlots) if (!resolvedByTime.has(rs.time ?? null)) resolvedByTime.set(rs.time ?? null, rs);
    // Day-level fallback (override days are untimed and may not align to a grid slot).
    const dayResolved = daySlots[0] ?? null;

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

    // Half-life timing: most recent DoseLog for this peptide (any protocol).
    // Same value for every slot. `date` can be a tracking-day noon anchor;
    // `intervalNow` stays the real UTC/server instant for clinically relevant
    // elapsed-time and half-life warnings.
    const lastDoseLog = await prisma.doseLog.findFirst({
      where: { userId, preparation: { vial: { peptideId: p.peptideId } } },
      orderBy: { takenAt: "desc" },
    });
    // Clamp negatives (a just-logged dose).
    const hoursSinceLast = lastDoseLog
      ? Math.max(0, (intervalNow.getTime() - new Date(lastDoseLog.takenAt).getTime()) / 3_600_000)
      : null;

    const halfLifeHours = p.peptide.halfLifeHours != null ? Number(p.peptide.halfLifeHours.toString()) : null;
    const minIntervalHours = p.peptide.minIntervalHours != null ? Number(p.peptide.minIntervalHours.toString()) : null;

    // Per-slot consumed tracking: each untimed log can satisfy at most one slot.
    const consumedLogIds = new Set<string>();

    for (const slot of effectiveSlots) {
      // Per-injection dose comes ONLY from the resolver (never raw step.dose /
      // targetDose). Match the resolved slot by time; fall back to the day's
      // resolved slot (override days are untimed and may not align to a grid
      // slot). doseValue is PATIENT-FACING — it prefills LogDoseForm → the
      // injected volume — so a raw per_week weekly value here is a 2–7× overdose
      // (spec §6). On a no-slot fallback we divide a per_week target; if the
      // frequency can't be resolved we leave doseValue "" (no prefilled dose —
      // LogDoseForm guards on empty and disables submit) rather than overdose.
      const slotResolved = resolvedByTime.get(slot.time ?? null) ?? dayResolved;
      const shifted = !completedLoggedFallback && (shiftedOverrideToday || slotResolved?.rebased === true);
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
      // timed slot. NOTE: it matches on SAME TRACKING DAY + nearest slot — there
      // is deliberately NO ±adherenceWindow gate (see resolve.ts PASS 1: the
      // window test used to flag real same-day doses taken off-time as missed).
      // `Protocol.adherenceWindowMin` is still collected and stored but is not
      // consulted by any status or adherence calculation. An untimed slot
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
        stackId: p.stackId,
        stackName: p.stack?.name ?? null,
        route: p.peptide.route,
        doseValue,
        doseUnit,
        time: slot.time,
        slotKey: `${p.id}@${slot.time ?? "any"}`,
        budState: budStatus({ beyondUseDate: prep?.beyondUseDate ?? null, now: new Date() }).state,
        preparation: prep
          ? {
              id: prep.id,
              concentrationMcgPerMl: prep.concentrationMcgPerMl.toString(),
              remainingMl: prep.remainingMl.toString(),
              beyondUseDate: prep.beyondUseDate ? prep.beyondUseDate.toISOString() : null,
            }
          : null,
        vialForPrep: vialForPrep
          ? {
              id: vialForPrep.id,
              labelStrengthMg: vialForPrep.labelStrengthMg.toString(),
              budDefaultDays: resolveBudDays({ peptideDefaultBudDays: p.peptide.defaultBudDays }),
            }
          : null,
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
        shifted,
      });
    }
  }

  return due.sort((a, b) => {
    const timeCmp = compareTime(a.time, b.time);
    if (timeCmp !== 0) return timeCmp;
    return compareStackGrouped(a, b);
  });
}
