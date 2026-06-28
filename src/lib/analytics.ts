import "server-only";
import { prisma } from "@/lib/db";
import { startOfDay, addDays } from "@/lib/schedule/schedule";
import { adherenceOverWindow, heatmapBuckets } from "@/lib/analytics-core";
import type { AdherenceResult, HeatmapBucket } from "@/lib/analytics-core";
import type { PlasmaPoint, DosePoint } from "@/lib/plasma";
import { plasmaCurve } from "@/lib/plasma";
import { resolveTitration } from "@/lib/titration/resolve";
import { buildResolveInput } from "@/lib/titration/from-protocol";
import { forwardDosePoints } from "@/lib/plasma-projection";
import { decryptField } from "@/lib/crypto/fieldEncryption";
import { deserializeSideEffects } from "@/lib/side-effects";
import {
  computeInsights,
  type Insight,
  type InsightInput,
  type InsightWearableRow,
  type InsightJournalEntry,
} from "@/lib/insights";

/**
 * Build a pure (value, unit) → mcg converter for the plasma forward projection.
 * The returned fn is fed the resolver's already-basis-divided, phase-resolved
 * PER-INJECTION value (via forwardDosePoints' `toMcg` param) — NOT a raw
 * Protocol.targetDose. Do not pass a weekly/target dose here: that was the closed
 * overdose path (spec §6); the resolver divides per_week before this point.
 *
 * Unit resolution:
 *   mcg   → value
 *   mg    → value * 1000
 *   ml    → value * concentrationMcgPerMl                       (active prep)
 *   units → (value / syringe.unitsPerMl) * concentrationMcgPerMl
 * ml/units resolve to mass ONLY when the protocol's active prep concentration
 * (and, for units, the default syringe's unitsPerMl) are known. When they are
 * not, ml/units → null → that protocol's forward curve stays decay-only (never
 * fabricated, never 1000x wrong).
 */
function makeProjectionToMcg(opts: {
  concentrationMcgPerMl: number | null;
  unitsPerMl: number | null;
}): (value: string, unit: string) => number | null {
  const { concentrationMcgPerMl, unitsPerMl } = opts;
  const haveConc = concentrationMcgPerMl != null && concentrationMcgPerMl > 0;
  return (value, unit) => {
    const v = Number(value);
    if (!Number.isFinite(v) || v <= 0) return null;
    if (unit === "mcg") return v;
    if (unit === "mg") return v * 1000;
    if (unit === "ml") {
      return haveConc ? v * concentrationMcgPerMl! : null;
    }
    if (unit === "units") {
      if (!haveConc) return null;
      if (unitsPerMl == null || unitsPerMl <= 0) return null;
      return (v / unitsPerMl) * concentrationMcgPerMl!;
    }
    return null;
  };
}

export interface PeptideAdherence {
  peptideId: string;
  peptideName: string;
  adherence: AdherenceResult;
}

export interface PeptidePlasma {
  peptideId: string;
  peptideName: string;
  halfLifeHours: number;
  series: PlasmaPoint[];
  /** True when forward-projected doses were appended to the history. */
  hasProjection: boolean;
}

export interface AnalyticsData {
  /** Per-peptide adherence over the 90-day window. */
  adherenceByPeptide: PeptideAdherence[];
  /** Overall adherence across all peptides. */
  overallAdherence: AdherenceResult;
  /** Heatmap buckets for the 90-day window (all peptides combined). */
  heatmap: HeatmapBucket[];
  /** Per-peptide plasma curves (±30 days around today). */
  plasmaByPeptide: PeptidePlasma[];
  /** The "now" timestamp at the time of the read (for the chart's vertical marker). */
  now: Date;
  /**
   * Scheduled-but-not-logged dose times (resolver status "missed") that fall
   * within the plasma chart window (plasmaFrom..plasmaTo). Cheaply derived from
   * the same resolver slots that feed adherence — no extra DB work. Used by the
   * plasma chart to draw missed-dose markers (pitstop design only).
   */
  missedDoseTimes: Date[];
  /** Start of the heatmap window (for display labels). */
  heatmapFrom: Date;
  /** Peptides with no halfLifeHours set (no curve available). */
  peptidesWithoutHalfLife: { peptideId: string; peptideName: string }[];
}

/**
 * Load all analytics data for a user. Called from the RSC page.
 * Forward-projection doses come from on-the-fly schedule expansion —
 * no hard dependency on Component 1's PlannedDose rows having been generated.
 */
export async function getAnalyticsData(userId: string): Promise<AnalyticsData> {
  const now = new Date();
  const todayStart = startOfDay(now);

  // ── Window definitions ────────────────────────────────────────────────────
  // Heatmap + adherence: 90-day lookback
  const adherenceWindow = {
    from: addDays(todayStart, -89), // inclusive: today − 89 = 90 days total
    to: now,
  };

  // Plasma: ±30 days around today (30-day history + 30-day forward projection)
  const plasmaFrom = addDays(todayStart, -30);
  const plasmaTo = addDays(todayStart, 30);

  // ── Load data in parallel ─────────────────────────────────────────────────
  const [doseLogs, activeProtocols, vialsWithPrep, syringes] = await Promise.all([
    prisma.doseLog.findMany({
      where: {
        userId,
        takenAt: { gte: adherenceWindow.from }, // full 90-day window (heatmap); plasma filters to its own 30-day slice below
      },
      include: {
        preparation: { include: { vial: { include: { peptide: true } } } },
        // Oral doses have no preparation — resolve the peptide via the protocol.
        protocol: { include: { peptide: true } },
      },
      orderBy: { takenAt: "asc" },
    }),
    prisma.protocol.findMany({
      where: { userId, status: "active" },
      include: { peptide: true, steps: true },
    }),
    // Active prep per vial → drives ml/units → mcg in the forward projection.
    // Mirrors inventory.ts's active-prep selection (active:true, latest first).
    prisma.vial.findMany({
      where: { userId },
      select: {
        peptideId: true,
        status: true,
        preparations: {
          where: { active: true },
          orderBy: { reconstitutedAt: "desc" },
          take: 1,
          select: { concentrationMcgPerMl: true, reconstitutedAt: true },
        },
      },
    }),
    // User + global syringes → unitsPerMl for unit-dosed protocols (via
    // Protocol.defaultSyringeId). Mirrors inventory.ts's syringe load.
    prisma.syringe.findMany({
      where: { OR: [{ userId }, { userId: null }] },
      select: { id: true, unitsPerMl: true },
    }),
  ]);

  // Exclude protocols that haven't started yet (future start date) from ALL
  // analytics — a not-yet-started protocol has no real adherence, plasma, or dose
  // history, so including it shows a misleading 0%/"—" gauge and a phantom curve.
  // A null start date has no anchor (not "future") and is kept as before.
  const protocols = activeProtocols.filter((p) => p.startDate == null || p.startDate <= now);

  // Active prep concentration (mcg/mL) per peptide. Multiple vials per peptide →
  // prefer an in-use vial, then the most recently reconstituted active prep. Absent
  // → that peptide's ml/units forward curve stays decay-only (never fabricated).
  const concentrationByPeptide = new Map<string, number>();
  const concPickedFor = new Map<string, { inUse: boolean; at: number }>();
  for (const v of vialsWithPrep) {
    const prep = v.preparations[0];
    if (!prep) continue;
    const conc = Number(prep.concentrationMcgPerMl);
    if (!Number.isFinite(conc) || conc <= 0) continue;
    const inUse = v.status === "in_use";
    const at = new Date(prep.reconstitutedAt).getTime();
    const prev = concPickedFor.get(v.peptideId);
    const better =
      !prev || (inUse && !prev.inUse) || (inUse === prev.inUse && at > prev.at);
    if (better) {
      concentrationByPeptide.set(v.peptideId, conc);
      concPickedFor.set(v.peptideId, { inUse, at });
    }
  }

  const unitsPerMlBySyringe = new Map(syringes.map((s) => [s.id, s.unitsPerMl]));

  // ── Heatmap: window to the data we actually have (earliest dose → today),
  // bounded by the 90-day lookback so it grows over time rather than showing a
  // wall of empty cells. Empty (no grid) until the first dose is logged.
  const adherenceWindowLogs = doseLogs.filter(
    (l) => new Date(l.takenAt) >= adherenceWindow.from,
  );
  const earliestLog = adherenceWindowLogs.length
    ? startOfDay(new Date(adherenceWindowLogs[0].takenAt)) // logs are ordered asc
    : null;
  const heatmapStart = earliestLog ?? todayStart;
  const heatmap = earliestLog
    ? heatmapBuckets({
        logs: adherenceWindowLogs.map((l) => ({ takenAt: new Date(l.takenAt) })),
        window: { from: heatmapStart, to: now },
      })
    : [];

  // ── Full delivered history per protocol (phase cursor + rebase) ─────────────
  // The 90-day `doseLogs` above is truncated to the heatmap window; a titration
  // ramp can span >90 days, so the resolver needs the UNBOUNDED history (the
  // from-protocol.ts invariant; doses-timeline.ts honours it too) for both the
  // adherence resolve and the plasma forward curve. One query, grouped in memory.
  const fullLogs = await prisma.doseLog.findMany({
    where: { userId, protocolId: { not: null } },
    select: { id: true, protocolId: true, takenAt: true },
  });
  const fullLogsByProtocol = new Map<string, { id: string; takenAt: Date }[]>();
  for (const l of fullLogs) {
    if (!l.protocolId) continue;
    const arr = fullLogsByProtocol.get(l.protocolId) ?? [];
    arr.push({ id: l.id, takenAt: new Date(l.takenAt) });
    fullLogsByProtocol.set(l.protocolId, arr);
  }

  // Collect unique peptides from dose logs + protocols. Injection logs resolve
  // the peptide via prep→vial; oral logs (no prep) via the linked protocol.
  const peptideMap = new Map<string, string>(); // peptideId → name
  for (const l of doseLogs) {
    const p = l.preparation?.vial.peptide ?? l.protocol?.peptide ?? null;
    if (p) peptideMap.set(p.id, p.name);
  }
  for (const proto of protocols) {
    peptideMap.set(proto.peptide.id, proto.peptide.name);
  }

  // ── Adherence from the resolver (single source of truth) ────────────────────
  // Per active protocol, resolve the schedule over the window (+buffer so the
  // trailing slot has a successor for the missed/pending decision) and count
  // taken vs missed slots. A rebased (shifted) taken slot has resolver status
  // "taken" → counts as adherent. This replaces the PlannedDose-status source,
  // which could NEVER report "taken" (status is only ever written "planned"/
  // "missed"), structurally pinning adherence at 0%/—.
  const RESOLVE_BUFFER_DAYS = 31;
  const adherenceRowsByPeptide = new Map<string, { scheduledAt: Date; status: "planned" | "taken" | "missed" | "skipped" }[]>();
  // Missed (scheduled-but-not-logged) slot times within the plasma chart window
  // (plasmaFrom..plasmaTo). Collected here because the resolver slots are already
  // in hand — no extra query. The chart maps these to dashed-red markers.
  const missedDoseTimes: Date[] = [];
  for (const proto of protocols) {
    if (!proto.scheduleRule) continue;
    let resolved: ReturnType<typeof resolveTitration> | null = null;
    try {
      resolved = resolveTitration(
        buildResolveInput({
          protocol: proto,
          deliveredLogs: fullLogsByProtocol.get(proto.id) ?? [],
          range: { start: adherenceWindow.from, end: addDays(startOfDay(adherenceWindow.to), RESOLVE_BUFFER_DAYS) },
          now,
        }),
      );
    } catch (e) {
      console.error("[adherence] resolve failed", e);
    }
    if (!resolved) continue;
    const rows = adherenceRowsByPeptide.get(proto.peptideId) ?? [];
    for (const s of resolved.slots) {
      if (s.date < adherenceWindow.from || s.date > adherenceWindow.to) continue; // clip the buffer
      // Only resolved taken/missed feed the denominator; projected/pending → "planned"
      // (excluded by adherenceOverWindow), skipped → "skipped" (also excluded).
      const status = s.status === "taken" ? "taken" as const
        : s.status === "missed" ? "missed" as const
        : s.status === "skipped" ? "skipped" as const
        : "planned" as const;
      rows.push({ scheduledAt: s.date, status });
      // Mirror onto the chart-window missed-dose marker list. Missed slots are
      // always in the past; keep only those inside the plasma window so the
      // marker x-values map onto the chart's time axis. A protocol with NO
      // startDate has no schedule anchor, so its "missed" slots are phantom
      // (you can't miss a dose that was never scheduled) — exclude them from the
      // markers so a date-less protocol doesn't paint a wall of red lines.
      if (status === "missed" && proto.startDate != null && s.date >= plasmaFrom && s.date <= plasmaTo) {
        missedDoseTimes.push(s.date);
      }
    }
    adherenceRowsByPeptide.set(proto.peptideId, rows);
  }

  const adherenceByPeptide: PeptideAdherence[] = [];
  for (const [peptideId, peptideName] of peptideMap) {
    const planned = adherenceRowsByPeptide.get(peptideId) ?? [];
    const adherence = adherenceOverWindow({ planned, logs: [], window: adherenceWindow });
    adherenceByPeptide.push({ peptideId, peptideName, adherence });
  }
  adherenceByPeptide.sort((a, b) => a.peptideName.localeCompare(b.peptideName));

  // Overall adherence (all resolver-derived rows across all peptides).
  const allPlanned = [...adherenceRowsByPeptide.values()].flat();
  const overallAdherence = adherenceOverWindow({
    planned: allPlanned,
    logs: [],
    window: adherenceWindow,
  });

  // ── Plasma curves ─────────────────────────────────────────────────────────
  // Group historical logs by peptide
  const logsByPeptide = new Map<string, DosePoint[]>();
  for (const l of doseLogs) {
    // Injection: prep→vial→peptide. Oral (no prep): the linked protocol's peptide.
    // An unlinked oral dose has no peptide → it can't feed a peptide plasma curve.
    const peptideId = l.preparation?.vial.peptideId ?? l.protocol?.peptideId ?? null;
    if (!peptideId) continue;
    const pts = logsByPeptide.get(peptideId) ?? [];
    pts.push({ at: new Date(l.takenAt), amountMcg: Number(l.doseMcg) });
    logsByPeptide.set(peptideId, pts);
  }

  const plasmaByPeptide: PeptidePlasma[] = [];
  const peptidesWithoutHalfLife: { peptideId: string; peptideName: string }[] = [];

  // Build unique set of peptides that have protocols (with halfLifeHours)
  const peptideHalfLifes = new Map<string, number | null>();
  for (const proto of protocols) {
    const halfLife = proto.peptide.halfLifeHours != null ? Number(proto.peptide.halfLifeHours) : null;
    peptideHalfLifes.set(proto.peptide.id, halfLife);
    if (!peptideMap.has(proto.peptide.id)) {
      peptideMap.set(proto.peptide.id, proto.peptide.name);
    }
  }

  for (const proto of protocols) {
    const peptideId = proto.peptide.id;
    const peptideName = proto.peptide.name;
    const halfLifeHours = peptideHalfLifes.get(peptideId) ?? null;

    if (halfLifeHours === null) {
      // Only add to the no-halflife list once per peptide
      if (!peptidesWithoutHalfLife.find((p) => p.peptideId === peptideId)) {
        peptidesWithoutHalfLife.push({ peptideId, peptideName });
      }
      continue;
    }

    // If we've already processed this peptide via an earlier protocol, skip
    if (plasmaByPeptide.find((p) => p.peptideId === peptideId)) continue;

    // Historical doses
    const historical = logsByPeptide.get(peptideId) ?? [];

    // Forward-projection via the resolver: titration- and basis-aware, reflecting
    // step-ups and the current (recalculated) plan. Replaces the legacy flat-dose
    // occurrencesInRange projection. ml/units resolve to mcg via the active prep
    // concentration (+ syringe unitsPerMl); decay-only if concentration unknown.
    const toMcg = makeProjectionToMcg({
      concentrationMcgPerMl: concentrationByPeptide.get(peptideId) ?? null,
      unitsPerMl: proto.defaultSyringeId
        ? unitsPerMlBySyringe.get(proto.defaultSyringeId) ?? null
        : null,
    });
    let projectionDoses: DosePoint[] = [];
    let hasProjection = false;
    if (proto.scheduleRule && proto.status === "active") {
      try {
        const resolved = resolveTitration(
          buildResolveInput({
            protocol: proto,
            deliveredLogs: fullLogsByProtocol.get(proto.id) ?? [],
            range: { start: now, end: plasmaTo },
            now,
          }),
        );
        projectionDoses = forwardDosePoints(resolved.slots, toMcg);
        hasProjection = projectionDoses.length > 0;
      } catch (e) {
        // Resolver/schedule failure → decay-only forward curve (safe, not
        // fabricated). Log so a real bug isn't silently swallowed.
        console.error("[plasma] projection failed", e);
      }
    }

    const allDoses = [...historical, ...projectionDoses];

    const series = plasmaCurve({
      doses: allDoses,
      halfLifeHours,
      from: plasmaFrom,
      to: plasmaTo,
      stepHours: 6,
    });

    plasmaByPeptide.push({ peptideId, peptideName, halfLifeHours, series, hasProjection });
  }

  plasmaByPeptide.sort((a, b) => a.peptideName.localeCompare(b.peptideName));

  // Stable, ascending order for deterministic marker rendering.
  missedDoseTimes.sort((a, b) => a.getTime() - b.getTime());

  return {
    adherenceByPeptide,
    overallAdherence,
    heatmap,
    plasmaByPeptide,
    now,
    heatmapFrom: heatmapStart,
    peptidesWithoutHalfLife,
    missedDoseTimes,
  };
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number((v as { toString(): string }).toString());
  return Number.isFinite(n) ? n : null;
}

/**
 * Load + compute the descriptive cross-metric insights for a user over the
 * trailing 90-day window. Loads the three raw streams (dose timestamps,
 * wearable daily rows, journal entries — free-text decrypted, side-effects
 * deserialized here), reuses the overall adherence from the resolver, then
 * delegates the honest comparisons to the pure `computeInsights`.
 *
 * Returns the (possibly empty) insight list. All min-sample skipping happens
 * inside `computeInsights`; the page renders an empty-state when [].
 */
export async function getInsightsData(
  userId: string,
  adherencePct: number | null,
): Promise<Insight[]> {
  const now = new Date();
  const todayStart = startOfDay(now);
  const window = { from: addDays(todayStart, -89), to: now };

  const [doseLogs, wearableRows, journalRows] = await Promise.all([
    prisma.doseLog.findMany({
      where: { userId, takenAt: { gte: window.from, lte: window.to } },
      select: { takenAt: true },
      orderBy: { takenAt: "asc" },
    }),
    prisma.wearableDaily.findMany({
      where: { userId, date: { gte: window.from, lte: window.to } },
      select: {
        date: true,
        sleepSeconds: true,
        restingHr: true,
        bodyBatteryHigh: true,
      },
      orderBy: { date: "asc" },
    }),
    prisma.journalEntry.findMany({
      where: { userId, date: { gte: window.from, lte: window.to } },
      orderBy: { date: "asc" },
    }),
  ]);

  const doseDates: Date[] = doseLogs.map((d) => new Date(d.takenAt));

  const wearable: InsightWearableRow[] = wearableRows.map((r) => ({
    date: new Date(r.date),
    sleepSeconds: r.sleepSeconds ?? null,
    restingHr: r.restingHr ?? null,
    bodyBatteryHigh: r.bodyBatteryHigh ?? null,
  }));

  const journal: InsightJournalEntry[] = journalRows.map((e) => ({
    date: new Date(e.date),
    weight: toNum(e.weight),
    weightUnit: e.weightUnit ?? null,
    calories: e.calories ?? null,
    proteinG: toNum(e.proteinG),
    waterMl: e.waterMl ?? null,
    sideEffects: deserializeSideEffects(decryptField(e.sideEffects)),
  }));

  const input: InsightInput = {
    doseDates,
    wearable,
    journal,
    window,
    adherencePct,
    now,
  };

  return computeInsights(input);
}
