import "server-only";
/**
 * Body-composition data layer — server-only. Decrypts the ENCRYPTED report
 * numbers, aggregates the streams that sit beside a scan interval
 * (exposure, wellness, intake, nearest labs) and composes the `/body` view.
 *
 * Nothing derived is stored: every index, band, flag and rate is recomputed here
 * from `src/lib/body-comp-core.ts` at read time. This module shows what was
 * measured and what was logged alongside it; it never attributes a change to
 * any compound, food, training or event.
 */
import { prisma } from "@/lib/db";
import { encryptField, decryptField } from "@/lib/crypto/fieldEncryption";
import { buildExposureRollup } from "@/lib/analytics-core";
import type { ExposureRow } from "@/lib/blends-core";
import { loadExposureMaps } from "@/lib/exposure-maps";
import { startOfDay, addDays, daysBetween } from "@/lib/schedule/schedule";
import { dayKey } from "@/lib/today-overrides";
import { BODY_COPY, intervalSentence } from "@/lib/bodycomp-copy";
import { LAB_SUBSET, labAliasRank, matchesLabAlias } from "@/lib/bodycomp-labs";
import {
  DEFAULT_PRECISION,
  almLsc,
  bmdLsc,
  calibrateBia,
  checksums,
  cleanWeightSeries,
  comparability,
  deltaFlag,
  demoteFlag,
  distributionRatios,
  fatLsc,
  indices,
  intervalCompleteness,
  leanLsc,
  limbAsymmetry,
  nextScanDue,
  pctFatLsc,
  ratePer30d,
  rmrEquations,
  rmrLsc,
  rmrPerKg,
  vatLsc,
  vo2FromRmr,
  biaOffset,
  type ChecksumResult,
  type Comparability,
  type DeltaFlag,
  type EquationRow,
  type GhsState,
  type Indices,
  type LscBand,
  type NextDue,
  type Precision,
  type PrecisionSource,
  type Region,
  type RegionValues,
  type ScaleReading,
  type ScanValues,
} from "@/lib/body-comp-core";
import type { BodyCompScan, BodyCompRegion, MetabolicTest, BodyCompPrecision, Prisma } from "@prisma/client";
import type { ReportBodyComp, ReportBodyCompDelta, ReportBodyCompScan, ReportRmr } from "@/lib/pdf/report";
// Pure presentational words (tri-state, method, precision source) — reused so the report prints what the page prints.
import { methodLabel, precisionLabel, tri } from "@/components/body/format";

const DAY = 86_400_000;

// ── Step 1: encrypt/decrypt helpers ──────────────────────────────────────────

/** Number → encrypted string for storage; null for null/NaN/Infinity. */
export const encNum = (n: number | null | undefined): string | null =>
  n == null || !Number.isFinite(n) ? null : encryptField(String(n));

/**
 * Encrypted (or legacy plaintext) string → number; null when absent, non-numeric
 * or undecryptable (corrupt ciphertext, rotated PT_FIELD_KEY, failed GCM tag) —
 * a bad cell must never throw the page or an export.
 */
export const decNum = (s: string | null | undefined): number | null => {
  let v: string | null;
  try {
    v = decryptField(s);
  } catch (e) {
    console.warn("[bodycomp-data] decrypt failed", e);
    return null;
  }
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** `decryptField` that returns null (with a warning) instead of throwing on a bad cell. */
function decText(s: string | null | undefined): string | null {
  try {
    return decryptField(s);
  } catch (e) {
    console.warn("[bodycomp-data] decrypt failed", e);
    return null;
  }
}

const dec = (d: Prisma.Decimal | null | undefined): number | null => (d == null ? null : Number(d.toString()));
const asSex = (s: string): "male" | "female" => (s === "female" ? "female" : "male");

/**
 * Required encrypted columns: every value, or null when any cell is missing or
 * undecryptable — one warning per row, and the caller drops the row. A 0
 * fallback would divide through `indices()` and render Infinity.
 */
function decRequiredAll<K extends string>(cells: Record<K, string | null | undefined>, kind: string, rowId: string): Record<K, number> | null {
  const out = {} as Record<K, number>;
  const missing: string[] = [];
  for (const k of Object.keys(cells) as K[]) {
    const n = decNum(cells[k]);
    if (n == null) missing.push(k);
    else out[k] = n;
  }
  if (missing.length) {
    console.warn(`[bodycomp-data] ${kind} ${rowId} dropped: required field(s) ${missing.join(", ")} could not be decrypted`);
    return null;
  }
  return out;
}

// ── Step 2: row → values ─────────────────────────────────────────────────────

export type ScanRow = BodyCompScan & { regions: BodyCompRegion[] };

/** null when a required total cannot be decrypted — the scan is dropped from the series (regions likewise). */
export function toScanValues(row: ScanRow, ghs: GhsState): ScanValues | null {
  const totals = decRequiredAll(
    { totalFatG: row.totalFatG, totalLeanG: row.totalLeanG, totalBmcG: row.totalBmcG, totalMassG: row.totalMassG, pctFat: row.pctFat },
    "scan", row.id,
  );
  if (!totals) return null;
  const regions: RegionValues[] = row.regions.flatMap((r) => {
    const req = decRequiredAll({ fatG: r.fatG, leanG: r.leanG, totalG: r.totalG, pctFat: r.pctFat }, `region ${r.region}`, r.id);
    if (!req) return [];
    return [{
      region: r.region as Region,
      bmcG: decNum(r.bmcG),
      ...req,
      pctFatYn: decNum(r.pctFatYn),
      pctFatAm: decNum(r.pctFatAm),
      bmdGcm2: decNum(r.bmdGcm2),
    }];
  });
  return {
    id: row.id,
    scannedAt: row.scannedAt,
    localDay: row.localDay,
    deviceSerial: row.deviceSerial,
    softwareVersion: row.softwareVersion,
    sex: asSex(row.sex),
    ageYears: dec(row.ageYears) ?? 0,
    heightCm: dec(row.heightCm) ?? 0,
    clinicWeightKg: decNum(row.clinicWeightKg),
    ...totals,
    pctFatYn: decNum(row.pctFatYn),
    pctFatAm: decNum(row.pctFatAm),
    vatMassG: decNum(row.vatMassG),
    vatVolumeCm3: decNum(row.vatVolumeCm3),
    vatAreaCm2: decNum(row.vatAreaCm2),
    totalBmdGcm2: decNum(row.totalBmdGcm2),
    bmdTScore: decNum(row.bmdTScore),
    bmdZScore: decNum(row.bmdZScore),
    bmdCvPct: dec(row.bmdCvPct),
    prep: {
      fasted: row.prepFasted,
      fastingHours: dec(row.prepFastingHours),
      noCaffeine: row.prepNoCaffeine,
      noTrainingPriorDay: row.prepNoTrainingPriorDay,
      activeTravel: row.prepActiveTravel,
      euhydratedVoided: row.prepEuhydratedVoided,
      illnessFree14d: row.prepIllnessFree14d,
    },
    creatineStatus: row.creatineStatus,
    ghs,
    regions,
  };
}

export interface MetabolicTestValues {
  id: string;
  testedAt: Date;
  localDay: string;
  method: string;
  deviceLabel: string | null;
  measuredRmrKcal: number;
  kcalPerLitreO2: number | null;
  vo2MlMin: number | null;
  rq: number | null;
  durationMin: number | null;
  steadyStateCvPct: number | null;
  sex: "male" | "female";
  ageYears: number;
  heightCm: number;
  weightKg: number;
  reportedPredictedKcal: number | null;
  reportedPredictionEquation: string | null;
  /** Stored verbatim as the clinic printed it — NEVER used to compute a target. */
  reportedActivityFactor: number | null;
  reportedActivityLabel: string | null;
  prep: {
    fasted: boolean | null;
    fastingHours: number | null;
    noCaffeine: boolean | null;
    noTrainingPriorDay: boolean | null;
    activeTravel: boolean | null;
    restMinBeforeTest: number | null;
    /** Tri-state answer; null on tests saved before the column existed — readers fall back to the minutes heuristic. */
    rested: boolean | null;
    illnessFree14d: boolean | null;
    awakeQuiet: boolean | null;
  };
  bodyCompScanId: string | null;
}

/** null when measured RMR or test-day weight cannot be decrypted — the test is dropped. */
export function toMetabolicTestValues(row: MetabolicTest): MetabolicTestValues | null {
  const req = decRequiredAll({ measuredRmrKcal: row.measuredRmrKcal, weightKg: row.weightKg }, "metabolic test", row.id);
  if (!req) return null;
  return {
    id: row.id,
    testedAt: row.testedAt,
    localDay: row.localDay,
    method: row.method,
    deviceLabel: row.deviceLabel,
    measuredRmrKcal: req.measuredRmrKcal,
    kcalPerLitreO2: decNum(row.kcalPerLitreO2),
    vo2MlMin: decNum(row.vo2MlMin),
    rq: decNum(row.rq),
    durationMin: row.durationMin,
    steadyStateCvPct: decNum(row.steadyStateCvPct),
    sex: asSex(row.sex),
    ageYears: dec(row.ageYears) ?? 0,
    heightCm: dec(row.heightCm) ?? 0,
    weightKg: req.weightKg,
    reportedPredictedKcal: decNum(row.reportedPredictedKcal),
    reportedPredictionEquation: row.reportedPredictionEquation,
    reportedActivityFactor: decNum(row.reportedActivityFactor),
    reportedActivityLabel: row.reportedActivityLabel,
    prep: {
      fasted: row.prepFasted,
      fastingHours: dec(row.prepFastingHours),
      noCaffeine: row.prepNoCaffeine,
      noTrainingPriorDay: row.prepNoTrainingPriorDay,
      activeTravel: row.prepActiveTravel,
      restMinBeforeTest: row.prepRestMinBeforeTest,
      rested: row.prepRested,
      illnessFree14d: row.prepIllnessFree14d,
      awakeQuiet: row.prepAwakeQuiet,
    },
    bodyCompScanId: row.bodyCompScanId,
  };
}

// ── Step 3: precision ────────────────────────────────────────────────────────

const OWN_PRECISION: PrecisionSource[] = ["measured_own", "clinic_supplied"];
const SOURCE_RANK: Record<string, number> = { measured_own: 0, clinic_supplied: 1, device_class_default: 2, iscd_min: 3 };

function precisionFromRow(row: BodyCompPrecision): Precision {
  const d = DEFAULT_PRECISION;
  return {
    source: (row.source in SOURCE_RANK ? row.source : d.source) as PrecisionSource,
    fatCvPct: dec(row.fatCvPct) ?? d.fatCvPct,
    leanCvPct: dec(row.leanCvPct) ?? d.leanCvPct,
    pctFatLscAbs: dec(row.pctFatLscAbs) ?? d.pctFatLscAbs,
    almCvPct: dec(row.almCvPct) ?? d.almCvPct,
    vatCvPct: dec(row.vatCvPct) ?? d.vatCvPct,
    bmdCvPct: dec(row.bmdCvPct) ?? d.bmdCvPct,
    rmrCvPct: dec(row.rmrCvPct) ?? d.rmrCvPct,
    practicalFatMultiplier: dec(row.practicalFatMultiplier) ?? d.practicalFatMultiplier,
    practicalLeanMultiplier: dec(row.practicalLeanMultiplier) ?? d.practicalLeanMultiplier,
  };
}

/**
 * Precision for a device: the clinic's own or self-measured row for that serial
 * wins; else the serial-less default row (best source first); else the
 * literature default. Until an own/clinic row exists the UI labels every band
 * "default LSC".
 */
export async function getPrecision(userId: string, deviceSerial: string | null): Promise<Precision> {
  const rows = await prisma.bodyCompPrecision.findMany({ where: { userId } });
  const rank = (r: BodyCompPrecision) => SOURCE_RANK[r.source] ?? 99;
  const own = deviceSerial
    ? rows.filter((r) => r.deviceSerial === deviceSerial && OWN_PRECISION.includes(r.source as PrecisionSource)).sort((a, b) => rank(a) - rank(b))[0]
    : undefined;
  if (own) return precisionFromRow(own);
  const fallback = rows.filter((r) => r.deviceSerial == null).sort((a, b) => rank(a) - rank(b))[0];
  return fallback ? precisionFromRow(fallback) : DEFAULT_PRECISION;
}

// ── Step 4: GH-secretagogue state per scan ───────────────────────────────────

/**
 * Peptide-name pattern for GH secretagogues (GHRH analogues and ghrelin
 * mimetics). Name matching is the ONLY signal the schema offers — Peptide has
 * no pharmacological-class column — so a compound named outside this list is
 * treated as not a secretagogue. GH raises extracellular water that DXA reads
 * as lean, which is why the comparability check carries this state.
 */
export const GHS_NAME_RE = /tesamorelin|cjc|ipamorelin|sermorelin|ghrp|hexarelin|mk-?677|ibutamoren/i;
/** The same alternatives as `GHS_NAME_RE`, as SQL `contains` tokens (SQLite LIKE is case-insensitive for ASCII). */
const GHS_NAME_TOKENS = ["tesamorelin", "cjc", "ipamorelin", "sermorelin", "ghrp", "hexarelin", "mk-677", "mk677", "ibutamoren"];
const GHS_WINDOW_DAYS = 14;

/** Secretagogue state at `scannedAt`: on if any matching dose fell in the prior 14 days. */
export async function ghsStateAt(userId: string, scannedAt: Date): Promise<GhsState> {
  // The name filter lives in the query (protocol join and preparation→vial join,
  // so an ad-hoc dose logged from a vial without a protocol is not missed): the
  // newest matching dose is wanted however many other doses came after it.
  const last = await prisma.doseLog.findFirst({
    where: {
      userId,
      takenAt: { lte: scannedAt },
      OR: GHS_NAME_TOKENS.flatMap((t) => [
        { protocol: { peptide: { name: { contains: t } } } },
        { preparation: { vial: { peptide: { name: { contains: t } } } } },
      ]),
    },
    orderBy: { takenAt: "desc" },
    select: { takenAt: true },
  });
  if (!last) return { onGhs: false, daysSinceLastDose: null };
  const days = Math.floor((scannedAt.getTime() - last.takenAt.getTime()) / DAY);
  return { onGhs: days <= GHS_WINDOW_DAYS, daysSinceLastDose: days };
}

// ── Step 5: exposure per interval ────────────────────────────────────────────

export type ComponentSource = "label" | "coa" | "assumed";
const SOURCE_WORST: Record<ComponentSource, number> = { assumed: 0, label: 1, coa: 2 };
const worstSource = (a: ComponentSource | null, b: ComponentSource | null): ComponentSource | null => {
  if (a == null) return b;
  if (b == null) return a;
  return SOURCE_WORST[a] <= SOURCE_WORST[b] ? a : b;
};
const asSource = (s: string): ComponentSource => (s === "coa" || s === "assumed" ? s : "label");

export interface ExposureRowExt extends ExposureRow {
  /** Distinct tracking days on which a dose delivering this compound was logged. */
  daysActive: number;
  doseCount: number;
  lastDoseDay: string | null;
  daysSinceLastDoseAtWindowEnd: number | null;
  /** True when any of the mass came through a blend ratio rather than a logged dose. */
  derived: boolean;
  /** Worst BlendComponent.source among contributing blends (assumed > label > coa); null when nothing was derived. */
  source: ComponentSource | null;
}

/**
 * Co-occurring exposure in (from, to]: the same roll-up as the analytics page
 * (preparation-first resolution, blends expanded via BlendComponent), plus
 * per-compound activity counts. Sorted alphabetically — never by recency or
 * dose — because order would read as ranking.
 */
export async function exposureInWindow(userId: string, from: Date, to: Date): Promise<ExposureRowExt[]> {
  const [maps, doses] = await Promise.all([
    loadExposureMaps(userId),
    prisma.doseLog.findMany({
      where: { userId, takenAt: { gt: from, lte: to } },
      select: { preparationId: true, protocolId: true, takenAt: true, localDay: true, doseMcg: true },
    }),
  ]);

  // Grouped sums, as prisma.groupBy would return them, built in memory from the
  // same rows so the counts below cannot disagree with the mass.
  const sums = new Map<string, { preparationId: string | null; protocolId: string | null; totalMcg: number }>();
  const stats = new Map<string, { days: Set<string>; doseCount: number; lastDay: string | null; derived: boolean; source: ComponentSource | null }>();
  const stat = (name: string) => {
    let s = stats.get(name);
    if (!s) { s = { days: new Set(), doseCount: 0, lastDay: null, derived: false, source: null }; stats.set(name, s); }
    return s;
  };
  for (const d of doses) {
    const k = `${d.preparationId ?? ""}|${d.protocolId ?? ""}`;
    const cur = sums.get(k);
    const mcg = Number(d.doseMcg.toString());
    if (cur) cur.totalMcg += mcg;
    else sums.set(k, { preparationId: d.preparationId, protocolId: d.protocolId, totalMcg: mcg });

    const pep =
      (d.preparationId ? maps.prepPeptide.get(d.preparationId) : undefined) ??
      (d.protocolId ? maps.protoPeptide.get(d.protocolId) : undefined);
    if (!pep) continue;
    const day = d.localDay ?? dayKey(d.takenAt);
    const comps = maps.componentsByBlendId.get(pep.peptideId);
    const targets = comps && comps.length > 0
      ? comps.map((c) => ({ name: c.name, derived: true as const, source: asSource(c.source) }))
      : [{ name: pep.name, derived: false as const, source: null }];
    for (const t of targets) {
      const s = stat(t.name);
      s.days.add(day);
      s.doseCount += 1;
      if (s.lastDay == null || day > s.lastDay) s.lastDay = day;
      if (t.derived) { s.derived = true; s.source = worstSource(s.source, t.source); }
    }
  }

  const rollup = buildExposureRollup({
    doseSums: [...sums.values()],
    prepPeptide: maps.prepPeptide,
    protoPeptide: maps.protoPeptide,
    componentsByBlendId: maps.componentsByBlendId,
  });
  const endDay = dayKey(to);
  return rollup
    .map((r): ExposureRowExt => {
      const s = stats.get(r.peptideName);
      const lastDoseDay = s?.lastDay ?? null;
      return {
        ...r,
        daysActive: s?.days.size ?? 0,
        doseCount: s?.doseCount ?? 0,
        lastDoseDay,
        daysSinceLastDoseAtWindowEnd: lastDoseDay ? Math.round((Date.parse(endDay) - Date.parse(lastDoseDay)) / DAY) : null,
        derived: s?.derived ?? r.hasDerived,
        source: s?.source ?? null,
      };
    })
    .sort((a, b) => a.peptideName.localeCompare(b.peptideName));
}

// ── Step 6: wellness window ──────────────────────────────────────────────────

export interface MedianStat { median: number | null; n: number }
export interface WellnessWindow {
  from: Date;
  to: Date;
  /** Wellness days that contributed after partial-day exclusion. */
  days: number;
  sleepHours: MedianStat;
  hrvMs: MedianStat;
  restingHr: MedianStat;
  steps: MedianStat;
  intensityMinutesSum: number;
  activityCountSum: number;
  /** Days with a logged activity or any intensity minutes ÷ window days × 100. */
  trainingDaysPct: number;
  weight: ReturnType<typeof cleanWeightSeries>;
  bodyFat: { day: string; bodyFatPct: number }[];
  /** Today, or rows synced before the wellness day had ended — excluded and counted. */
  excludedPartialDays: number;
  /** The same medians with days inside any life-event window removed (illness/travel/other). */
  excludingEvents: WellnessExcludingEvents;
}

export interface WellnessExcludingEvents {
  sleepHours: MedianStat;
  hrvMs: MedianStat;
  restingHr: MedianStat;
  steps: MedianStat;
  /** Contributing wellness days removed because they fall inside a life-event window. */
  excludedEventDays: number;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
const stat = (xs: (number | null)[]): MedianStat => {
  const v = xs.filter((x): x is number => x != null);
  return { median: median(v), n: v.length };
};

/**
 * Wearable aggregates for (from, to]. One row per day: when several sources
 * cover the same day the Garmin row is kept (the source the insights use), so a
 * day is never counted twice.
 */
export async function wellnessWindow(userId: string, from: Date, to: Date, today: Date, events: LifeEventValues[] = []): Promise<WellnessWindow> {
  const todayStart = startOfDay(today);
  const rows = await prisma.wearableDaily.findMany({
    where: { userId, date: { gt: startOfDay(from), lte: to } },
    select: {
      date: true, source: true, syncedAt: true, sleepSeconds: true, hrvMs: true, restingHr: true, steps: true,
      intensityMinutes: true, activityCount: true, weightKg: true, bodyFatPct: true,
    },
    orderBy: { date: "asc" },
  });
  const byDay = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const k = dayKey(r.date);
    const cur = byDay.get(k);
    if (!cur || (cur.source !== "garmin" && r.source === "garmin")) byDay.set(k, r);
  }
  let excludedPartialDays = 0;
  const kept: { day: string; row: (typeof rows)[number] }[] = [];
  for (const [day, r] of byDay) {
    const partial = r.date.getTime() >= todayStart.getTime() || r.syncedAt.getTime() < r.date.getTime() + DAY;
    if (partial) { excludedPartialDays += 1; continue; }
    kept.push({ day, row: r });
  }
  const windowDays = Math.max(1, daysBetween(from, to));
  const trainingDays = kept.filter(({ row }) => (row.activityCount ?? 0) > 0 || (row.intensityMinutes ?? 0) > 0).length;
  const medians = (rows: typeof kept) => ({
    sleepHours: stat(rows.map(({ row }) => (row.sleepSeconds == null ? null : row.sleepSeconds / 3600))),
    hrvMs: stat(rows.map(({ row }) => dec(row.hrvMs))),
    restingHr: stat(rows.map(({ row }) => row.restingHr)),
    steps: stat(rows.map(({ row }) => row.steps)),
  });
  const outsideEvents = events.length ? kept.filter(({ day }) => !isLifeEventDay(events, day)) : kept;
  return {
    from,
    to,
    days: kept.length,
    ...medians(kept),
    excludingEvents: { ...medians(outsideEvents), excludedEventDays: kept.length - outsideEvents.length },
    intensityMinutesSum: kept.reduce((a, { row }) => a + (row.intensityMinutes ?? 0), 0),
    activityCountSum: kept.reduce((a, { row }) => a + (row.activityCount ?? 0), 0),
    trainingDaysPct: Math.round((trainingDays / windowDays) * 1000) / 10,
    weight: cleanWeightSeries(kept.map(({ day, row }) => ({ day, weightKg: dec(row.weightKg) }))),
    bodyFat: kept.flatMap(({ day, row }) => { const v = dec(row.bodyFatPct); return v == null ? [] : [{ day, bodyFatPct: v }]; }),
    excludedPartialDays,
  };
}

// ── Step 6b: life events (illness / travel / other windows) ─────────────────

export type LifeEventKind = "illness" | "travel" | "other";

export interface LifeEventValues {
  id: string;
  kind: LifeEventKind;
  /** YYYY-MM-DD (local), inclusive on both ends. */
  startDay: string;
  endDay: string;
  label: string | null;
  /** Decrypted here; never in SQL. */
  notes: string | null;
}

export interface LifeEventDays {
  illnessDays: number;
  travelDays: number;
  otherDays: number;
  /** Distinct window days inside a window of any kind (overlaps counted once). */
  anyDays: number;
}

const asKind = (k: string): LifeEventKind => (k === "illness" || k === "travel" ? k : "other");

/** Every window of the user, oldest start first. Notes decrypted; a bad cell yields null, never a throw. */
export async function getLifeEvents(userId: string): Promise<LifeEventValues[]> {
  const rows = await prisma.lifeEvent.findMany({ where: { userId }, orderBy: [{ startDay: "asc" }, { createdAt: "asc" }] });
  return rows.map((r) => ({ id: r.id, kind: asKind(r.kind), startDay: r.startDay, endDay: r.endDay, label: r.label, notes: decText(r.notes) }));
}

/** True when `day` (YYYY-MM-DD) lies inside any window, inclusive. ISO day strings compare lexically. */
export function isLifeEventDay(events: LifeEventValues[], day: string): boolean {
  return events.some((e) => e.startDay <= day && day <= e.endDay);
}

const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + DAY).toISOString().slice(0, 10);

/**
 * Days of the window (fromDay, toDay] that fall inside a life-event window, per kind
 * (a day inside two windows of one kind counts once for that kind). The half-open
 * window matches `wellnessWindow` and `journalCompleteness`.
 */
export function lifeEventDayCounts(events: LifeEventValues[], fromDay: string, toDay: string): LifeEventDays {
  const out: LifeEventDays = { illnessDays: 0, travelDays: 0, otherDays: 0, anyDays: 0 };
  if (events.length === 0 || toDay <= fromDay) return out;
  for (let day = nextDay(fromDay); day <= toDay; day = nextDay(day)) {
    let any = false;
    const seen = new Set<LifeEventKind>();
    for (const e of events) {
      if (e.startDay <= day && day <= e.endDay && !seen.has(e.kind)) {
        seen.add(e.kind);
        any = true;
        if (e.kind === "illness") out.illnessDays += 1;
        else if (e.kind === "travel") out.travelDays += 1;
        else out.otherDays += 1;
      }
    }
    if (any) out.anyDays += 1;
  }
  return out;
}

// ── Step 7: nearest labs ─────────────────────────────────────────────────────

const LAB_WINDOW_DAYS = 30;
// The fixed subset and its token-boundary alias matcher live in the pure module
// `src/lib/bodycomp-labs.ts` (unit-tested against the biomarker library names).

export interface NearestLabRow {
  label: string;
  value: string | null;
  unit: string | null;
  referenceLow: number | null;
  referenceHigh: number | null;
  flag: string | null;
  status: "present" | "not_in_panel" | "never_measured";
}
export interface NearestLabs {
  panelId: string;
  panelDate: Date;
  /** Signed: negative = drawn before the scan. */
  daysFromScan: number;
  labSource: string | null;
  notes: string | null;
  rows: NearestLabRow[];
}

/** The lab panel closest to `scannedAt` within ±30 days, or null. Values decrypted here, never in SQL. */
export async function nearestLabs(userId: string, scannedAt: Date): Promise<NearestLabs | null> {
  const panels = await prisma.labPanel.findMany({ where: { userId }, select: { id: true, collectedDate: true } });
  let best: { id: string; collectedDate: Date; dist: number } | null = null;
  for (const p of panels) {
    const dist = Math.abs(p.collectedDate.getTime() - scannedAt.getTime());
    if (dist <= LAB_WINDOW_DAYS * DAY && (!best || dist < best.dist)) best = { id: p.id, collectedDate: p.collectedDate, dist };
  }
  if (!best) return null;

  const [panel, everMeasured] = await Promise.all([
    prisma.labPanel.findUnique({
      where: { id: best.id },
      include: { results: { include: { biomarker: { select: { name: true } } } } },
    }),
    prisma.labResult.findMany({ where: { labPanel: { userId } }, select: { biomarker: { select: { name: true } } }, distinct: ["biomarkerId"] }),
  ]);
  if (!panel) return null;
  const everNames = everMeasured.map((r) => r.biomarker.name);

  const rows: NearestLabRow[] = LAB_SUBSET.map((def) => {
    // Most specific alias wins: a panel holding both "CRP" and "hsCRP" shows the hsCRP result under the hsCRP label.
    let hit: (typeof panel.results)[number] | undefined, hitRank = Infinity;
    for (const r of panel.results) {
      const rank = labAliasRank(r.biomarker.name, def);
      if (rank != null && rank < hitRank) { hit = r; hitRank = rank; }
    }
    if (hit) {
      return {
        label: def.label,
        value: decText(hit.value),
        unit: hit.unit,
        referenceLow: dec(hit.referenceLow),
        referenceHigh: dec(hit.referenceHigh),
        flag: hit.flag,
        status: "present",
      };
    }
    const ever = everNames.some((n) => matchesLabAlias(n, def));
    return { label: def.label, value: null, unit: null, referenceLow: null, referenceHigh: null, flag: null, status: ever ? "not_in_panel" : "never_measured" };
  });

  return {
    panelId: panel.id,
    panelDate: panel.collectedDate,
    daysFromScan: Math.round((panel.collectedDate.getTime() - scannedAt.getTime()) / DAY),
    labSource: panel.labSource,
    notes: decText(panel.notes),
    rows,
  };
}

// ── Step 8: intake completeness ──────────────────────────────────────────────

export interface IntakeCompleteness { caloriesPct: number; proteinPct: number; weightDaysPct: number; windowDays: number }

/** Share of days in (from, to] with intake logged; 0 rows prints "not logged — attribution blocked" upstream. */
export async function journalCompleteness(userId: string, from: Date, to: Date): Promise<IntakeCompleteness> {
  const fromDay = dayKey(from), toDay = dayKey(to);
  const windowDays = Math.max(1, daysBetween(from, to));
  const [entries, wearable] = await Promise.all([
    prisma.journalEntry.findMany({ where: { userId, date: { gte: startOfDay(from), lte: to } }, select: { date: true, calories: true, proteinG: true } }),
    prisma.wearableDaily.findMany({ where: { userId, date: { gte: startOfDay(from), lte: to }, weightKg: { not: null } }, select: { date: true } }),
  ]);
  const inWindow = (d: Date) => { const k = dayKey(d); return k > fromDay && k <= toDay; };
  const cal = new Set<string>(), pro = new Set<string>(), wt = new Set<string>();
  for (const e of entries) {
    if (!inWindow(e.date)) continue;
    if (e.calories != null) cal.add(dayKey(e.date));
    if (e.proteinG != null) pro.add(dayKey(e.date));
  }
  for (const w of wearable) if (inWindow(w.date)) wt.add(dayKey(w.date));
  const pct = (n: number) => Math.round((n / windowDays) * 1000) / 10;
  return { caloriesPct: pct(cal.size), proteinPct: pct(pro.size), weightDaysPct: pct(wt.size), windowDays };
}

// ── Step 9: compose ──────────────────────────────────────────────────────────

export type DeltaKey = "fat" | "lean" | "pctFat" | "alm" | "vat" | "bmd" | "rmr";
export type RateKey = "fat" | "lean" | "pctFat";

export interface ScanWithDerived extends ScanValues {
  /** Linked uploaded report (`Document.id`), served at `/api/documents/[id]`; null when keyed by hand. */
  documentId: string | null;
  indices: Indices;
  ratios: ReturnType<typeof distributionRatios>;
  asymmetry: ReturnType<typeof limbAsymmetry>;
  checks: ChecksumResult[];
}

export interface LatestBands {
  fat: LscBand;
  lean: LscBand;
  pctFat: LscBand;
  alm: LscBand | null;
  vat: LscBand | null;
  bmd: number | null;
  rmr: number | null;
}

export interface BodyInterval {
  from: ScanValues;
  to: ScanValues;
  days: number;
  comparability: Comparability;
  /** null when the pair is not comparable (different scanner/software) or the metric is absent on either scan. */
  deltas: Record<DeltaKey, DeltaFlag | null>;
  /** Suppressed (null) when Δ is within technical LSC or the interval is under 28 days. */
  rates: Record<RateKey, number | null>;
  exposure: ExposureRowExt[];
  wellness: WellnessWindow;
  intake: { caloriesPct: number; proteinPct: number; weightDaysPct: number };
  /** Days of the interval inside illness / travel / other windows — counted, never interpreted. */
  lifeEventDays: LifeEventDays;
  /** Wellness medians with event days removed (same object as `wellness.excludingEvents`). */
  wellnessExcludingEvents: WellnessExcludingEvents;
  completeness: { score: number; attributionBlocked: boolean };
  sentence: string;
}

export interface BodyDashboardData {
  /** Oldest → newest. */
  scans: ScanWithDerived[];
  /** Oldest → newest. */
  tests: MetabolicTestValues[];
  precision: Precision;
  latest: { scan: ScanValues; nextDue: NextDue; bands: LatestBands } | null;
  /** Consecutive scan pairs, oldest first. */
  intervals: BodyInterval[];
  /** 90 days before the first scan — context only, "no comparator scan". */
  preBaseline: { exposure: ExposureRowExt[]; from: Date; to: Date } | null;
  /** Scale series for the last 180 days; offset fields null without a same-day (±1 d) DXA pair. */
  bia: {
    offsetPts: number | null;
    scaleDay: string | null;
    anchorWeightKg: number | null;
    weight: ReturnType<typeof cleanWeightSeries>;
    calibrated: { day: string; calibratedPct: number | null }[];
    /** Raw scale %fat as read — uncalibrated bioimpedance, drawn only while no DEXA exists (n = 0). */
    raw: { day: string; bodyFatPct: number }[];
  } | null;
  /** Nearest panel (±30 d) to the latest scan. */
  labs: NearestLabs | null;
  /** Every illness / travel / other window, oldest first — shaded on the chart, listed under the intervals. */
  lifeEvents: LifeEventValues[];
  /** Latest test; FFM from the linked scan, else the nearest scan within 14 days. */
  rmr: {
    test: MetabolicTestValues;
    ladder: EquationRow[];
    perKg: ReturnType<typeof rmrPerKg>;
    vo2: ReturnType<typeof vo2FromRmr> | null;
    lsc: number;
    /** The scan supplying FFM (null → weight-only equations) and its distance from the test. */
    ffmScanId: string | null;
    ffmScanDaysApart: number | null;
  } | null;
}

const PREP_KEYS = ["fasted", "noCaffeine", "noTrainingPriorDay", "activeTravel", "euhydratedVoided", "illnessFree14d"] as const;
const prepMatched = (a: ScanValues, b: ScanValues) => PREP_KEYS.every((k) => a.prep[k] != null && b.prep[k] != null && a.prep[k] === b.prep[k]);

function bandsFor(s: ScanValues, p: Precision, alm: number | null): Omit<LatestBands, "rmr"> {
  return {
    fat: fatLsc(s.totalFatG / 1000, p),
    lean: leanLsc(s.totalLeanG / 1000, p),
    pctFat: pctFatLsc(p),
    alm: alm == null ? null : almLsc(alm, p),
    vat: s.vatMassG == null ? null : vatLsc(s.vatMassG, p),
    bmd: s.totalBmdGcm2 == null ? null : bmdLsc(s.totalBmdGcm2, s.bmdCvPct ?? p.bmdCvPct ?? 1.0),
  };
}

/** Nearest scan to `test` within 14 days: the linked scan wins, else the smallest |gap|. */
export function ffmScanFor(
test: MetabolicTestValues, scans: ScanWithDerived[]): ScanWithDerived | null {
  const linked = test.bodyCompScanId ? scans.find((s) => s.id === test.bodyCompScanId) : undefined;
  if (linked) return linked;
  let best: ScanWithDerived | null = null, bestGap = Infinity;
  for (const s of scans) {
    const gap = Math.abs(s.scannedAt.getTime() - test.testedAt.getTime());
    if (gap <= 14 * DAY && gap < bestGap) { best = s; bestGap = gap; }
  }
  return best;
}

/** Every scan of the user, oldest first, decrypted and derived; undecryptable rows dropped. */
async function loadScans(userId: string): Promise<ScanWithDerived[]> {
  const scanRows = await prisma.bodyCompScan.findMany({ where: { userId }, include: { regions: true }, orderBy: { scannedAt: "asc" } });
  const scans: ScanWithDerived[] = [];
  for (const row of scanRows) {
    const ghs = await ghsStateAt(userId, row.scannedAt);
    const v = toScanValues(row, ghs);
    if (!v) continue;
    scans.push({ ...v, documentId: row.documentId, indices: indices(v), ratios: distributionRatios(v), asymmetry: limbAsymmetry(v.regions), checks: checksums(v) });
  }
  return scans;
}

export interface IntervalDeltas {
  comparability: Comparability;
  /** Bands sized on the earlier scan's values (the reference the change is read against). */
  bands: Omit<LatestBands, "rmr">;
  deltas: Record<DeltaKey, DeltaFlag | null>;
}

/**
 * Change flags for one scan pair — the ONE place the bands, the comparability
 * demotion and the RMR pairing are decided. The /body page and the doctor
 * report both call this, so the two surfaces cannot disagree. `tests` are the
 * tests eligible for the RMR row (oldest first); the two most recent are read
 * only when `readRmr` is set (the page sets it on the latest interval only).
 */
export function intervalDeltas(from: ScanWithDerived, to: ScanWithDerived, precision: Precision, tests: MetabolicTestValues[], readRmr: boolean): IntervalDeltas {
  const comp = comparability(from, to);
  const b = bandsFor(from, precision, from.indices.almKg);
  const flag = (prev: number | null, next: number | null, band: LscBand | null): DeltaFlag | null => {
    if (comp.hidden || prev == null || next == null || band == null) return null;
    const f = deltaFlag(prev, next, band);
    return comp.demote ? demoteFlag(f) : f;
  };
  const rmrDelta = (): DeltaFlag | null => {
    // RMR is not tied to a scan pair: the two latest tests are read on the latest interval only.
    if (!readRmr || tests.length < 2) return null;
    const a = tests[tests.length - 2], z = tests[tests.length - 1];
    return flag(a.measuredRmrKcal, z.measuredRmrKcal, { technical: rmrLsc(a.measuredRmrKcal, precision), practical: null });
  };
  const deltas: Record<DeltaKey, DeltaFlag | null> = {
    fat: flag(from.totalFatG / 1000, to.totalFatG / 1000, b.fat),
    lean: flag(from.totalLeanG / 1000, to.totalLeanG / 1000, b.lean),
    pctFat: flag(from.pctFat, to.pctFat, b.pctFat),
    alm: flag(from.indices.almKg, to.indices.almKg, b.alm),
    vat: flag(from.vatMassG, to.vatMassG, b.vat),
    bmd: flag(from.totalBmdGcm2, to.totalBmdGcm2, b.bmd == null ? null : { technical: b.bmd, practical: null }),
    rmr: rmrDelta(),
  };
  return { comparability: comp, bands: b, deltas };
}

export async function getBodyDashboardData(userId: string, now: Date): Promise<BodyDashboardData> {
  const [scans, testRows, lifeEvents] = await Promise.all([
    loadScans(userId),
    prisma.metabolicTest.findMany({ where: { userId }, orderBy: { testedAt: "asc" } }),
    getLifeEvents(userId),
  ]);
  const tests = testRows.flatMap((row) => { const t = toMetabolicTestValues(row); return t ? [t] : []; });
  const latestScan = scans[scans.length - 1] ?? null;
  const latestTest = tests[tests.length - 1] ?? null;
  const precision = await getPrecision(userId, latestScan?.deviceSerial ?? null);

  // ── RMR panel ──
  let rmr: BodyDashboardData["rmr"] = null;
  if (latestTest) {
    const ffmScan = ffmScanFor(latestTest, scans);
    const ffmKg = ffmScan?.indices.ffmKg ?? null;
    rmr = {
      test: latestTest,
      ladder: rmrEquations({ rmrKcal: latestTest.measuredRmrKcal, sex: latestTest.sex, ageYears: latestTest.ageYears, heightCm: latestTest.heightCm, weightKg: latestTest.weightKg, ffmKg }),
      perKg: rmrPerKg(latestTest.measuredRmrKcal, ffmKg, ffmScan ? ffmScan.totalLeanG / 1000 : null, latestTest.weightKg),
      vo2: latestTest.kcalPerLitreO2 ? vo2FromRmr(latestTest.measuredRmrKcal, latestTest.kcalPerLitreO2, latestTest.weightKg) : null,
      lsc: rmrLsc(latestTest.measuredRmrKcal, precision),
      ffmScanId: ffmScan?.id ?? null,
      ffmScanDaysApart: ffmScan ? Math.round((latestTest.testedAt.getTime() - ffmScan.scannedAt.getTime()) / DAY) : null,
    };
  }

  // ── Latest scan: next-due + forward bands ──
  let latest: BodyDashboardData["latest"] = null;
  if (latestScan) {
    latest = {
      scan: latestScan,
      nextDue: nextScanDue(latestScan.scannedAt, now),
      bands: { ...bandsFor(latestScan, precision, latestScan.indices.almKg), rmr: rmr ? rmr.lsc : null },
    };
  }

  // ── Intervals: consecutive pairs ──
  const intervals: BodyInterval[] = [];
  for (let i = 1; i < scans.length; i++) {
    const from = scans[i - 1], to = scans[i];
    const days = Math.max(0, Math.round((to.scannedAt.getTime() - from.scannedAt.getTime()) / DAY));
    const [exposure, wellness, intake] = await Promise.all([
      exposureInWindow(userId, from.scannedAt, to.scannedAt),
      wellnessWindow(userId, from.scannedAt, to.scannedAt, now, lifeEvents),
      journalCompleteness(userId, from.scannedAt, to.scannedAt),
    ]);
    const lifeEventDays = lifeEventDayCounts(lifeEvents, dayKey(from.scannedAt), dayKey(to.scannedAt));

    const { comparability: comp, bands: b, deltas } = intervalDeltas(from, to, precision, tests, i === scans.length - 1);
    const rate = (d: DeltaFlag | null, band: LscBand) => (d == null ? null : ratePer30d(d.delta, days, band));
    const rates: Record<RateKey, number | null> = { fat: rate(deltas.fat, b.fat), lean: rate(deltas.lean, b.lean), pctFat: rate(deltas.pctFat, b.pctFat) };

    const completeness = intervalCompleteness({
      prepMatched: prepMatched(from, to),
      intakeLoggedPct: intake.caloriesPct,
      weightDaysPct: intake.weightDaysPct,
      trainingDaysPct: wellness.trainingDaysPct,
      // "The user is tagging" — any window in the user's data, not "this interval has one".
      lifeEventsTagged: lifeEvents.length > 0,
    });
    const sentence = deltas.fat
      ? intervalSentence({
          metric: "Fat mass",
          deltaKg: deltas.fat.delta,
          days,
          tier: deltas.fat.tier,
          technical: deltas.fat.technical,
          practical: deltas.fat.practical,
          compounds: exposure.map((e) => e.peptideName),
          intakeLogged: !completeness.attributionBlocked,
          demoted: deltas.fat.demoted,
          rawTier: deltas.fat.rawTier,
          comparabilityReasons: comp.reasons,
        })
      : BODY_COPY.notComparable;

    intervals.push({
      from, to, days, comparability: comp, deltas, rates, exposure, wellness,
      intake: { caloriesPct: intake.caloriesPct, proteinPct: intake.proteinPct, weightDaysPct: intake.weightDaysPct },
      lifeEventDays, wellnessExcludingEvents: wellness.excludingEvents,
      completeness, sentence,
    });
  }

  // ── Pre-baseline context: 90 days before the first scan ──
  let preBaseline: BodyDashboardData["preBaseline"] = null;
  if (scans.length > 0) {
    const first = scans[0];
    const from = new Date(first.scannedAt.getTime() - 90 * DAY);
    preBaseline = { exposure: await exposureInWindow(userId, from, first.scannedAt), from, to: first.scannedAt };
  }

  // ── BIA background: last 180 days of scale readings, offset to the latest DXA ──
  const biaFrom = addDays(startOfDay(now), -180);
  const scaleRows = await prisma.wearableDaily.findMany({
    where: { userId, date: { gte: biaFrom, lte: now }, OR: [{ weightKg: { not: null } }, { bodyFatPct: { not: null } }] },
    select: { date: true, source: true, weightKg: true, bodyFatPct: true },
    orderBy: { date: "asc" },
  });
  const scaleByDay = new Map<string, ScaleReading>();
  for (const r of scaleRows) {
    const day = dayKey(r.date);
    const cur = scaleByDay.get(day);
    if (cur && r.source !== "garmin") continue;
    scaleByDay.set(day, { day, weightKg: dec(r.weightKg), bodyFatPct: dec(r.bodyFatPct) });
  }
  const scale = [...scaleByDay.values()];
  let bia: BodyDashboardData["bia"] = null;
  if (scale.length > 0) {
    const weight = cleanWeightSeries(scale);
    const offset = latestScan ? biaOffset(latestScan.pctFat, scale, latestScan.localDay) : null;
    bia = {
      offsetPts: offset?.offsetPts ?? null,
      scaleDay: offset?.scaleDay ?? null,
      anchorWeightKg: offset?.anchorWeightKg ?? null,
      weight,
      calibrated: offset ? calibrateBia(scale, offset.offsetPts, offset.anchorWeightKg) : [],
      raw: scale.flatMap((r) => (r.bodyFatPct == null ? [] : [{ day: r.day, bodyFatPct: r.bodyFatPct }])),
    };
  }

  const labs = latestScan ? await nearestLabs(userId, latestScan.scannedAt) : null;

  return { scans, tests, precision, latest, intervals, preBaseline, bia, labs, rmr, lifeEvents };
}

// ── Step 10: doctor report ───────────────────────────────────────────────────

/** The same sentence `ScanDetail` prints under a scan — the report must not re-word it. */
function scanPrepSummary(p: ScanValues["prep"]): string {
  return `fasted ${tri(p.fasted)}${p.fastingHours != null ? ` (${p.fastingHours} h)` : ""}, no caffeine ${tri(p.noCaffeine)}, no training prior day ${tri(p.noTrainingPriorDay)}, active travel ${tri(p.activeTravel)}, hydrated and voided ${tri(p.euhydratedVoided)}, illness-free 14 d ${tri(p.illnessFree14d)}`;
}

/** The same sentence `RmrPanel` prints, including its fallback for tests saved before `prepRested` existed. */
function rmrConditions(p: MetabolicTestValues["prep"]): string {
  const otherPrepAnswered = [p.fasted, p.noCaffeine, p.noTrainingPriorDay, p.activeTravel, p.illnessFree14d, p.awakeQuiet].some((v) => v != null);
  const rested: boolean | null = p.rested ?? (p.restMinBeforeTest != null ? true : otherPrepAnswered ? false : null);
  const restText = rested == null ? "unknown" : rested ? (p.restMinBeforeTest != null ? `${p.restMinBeforeTest} min` : "yes") : "no";
  return `fasted ${tri(p.fasted)}${p.fastingHours != null ? ` (${p.fastingHours} h)` : ""}, no caffeine ${tri(p.noCaffeine)}, no training prior day ${tri(p.noTrainingPriorDay)}, active travel ${tri(p.activeTravel)}, rested ${restText}, awake and still ${tri(p.awakeQuiet)}, illness-free 14 d ${tri(p.illnessFree14d)}`;
}

/**
 * Body-composition section of the doctor report: scans with `scannedAt` in
 * [from, to] plus the nearest earlier scan as the comparator, RMR tests in
 * range, and the latest-vs-previous deltas from `intervalDeltas` — the same
 * function the /body page uses, so the two surfaces cannot disagree. The RMR
 * delta pairs the two latest tests dated on or before `to`, so a previous test
 * from before the range serves as its comparator exactly as the earlier scan
 * does; only the RMR table is range-scoped. Returns null when neither a scan
 * nor a test falls in the range. Serial numbers, `reportJson` and file paths
 * never leave here.
 */
export async function getReportBodyComp(userId: string, from: Date, to: Date): Promise<ReportBodyComp | null> {
  const [allScans, testRows, lifeEvents, deviceRows] = await Promise.all([
    loadScans(userId),
    prisma.metabolicTest.findMany({ where: { userId, testedAt: { lte: to } }, orderBy: { testedAt: "asc" } }),
    getLifeEvents(userId),
    prisma.bodyCompScan.findMany({ where: { userId }, select: { id: true, deviceMake: true, deviceModel: true } }),
  ]);
  // Every test up to the range end feeds the delta (its comparator may predate the range); the table shows those in range.
  const tests = testRows.flatMap((row) => { const t = toMetabolicTestValues(row); return t ? [t] : []; });
  const testsInRange = tests.filter((t) => t.testedAt.getTime() >= from.getTime());
  const inRange = allScans.filter((s) => s.scannedAt.getTime() >= from.getTime() && s.scannedAt.getTime() <= to.getTime());
  if (inRange.length === 0 && testsInRange.length === 0) return null;

  // The comparator is only meaningful when a scan in range has something to be read against.
  const earlier = allScans.filter((s) => s.scannedAt.getTime() < from.getTime());
  const comparator = inRange.length > 0 ? earlier[earlier.length - 1] ?? null : null;
  const shown = comparator ? [comparator, ...inRange] : inRange;

  // Precision keyed on the latest scan overall — identical to the page.
  const latestOverall = allScans[allScans.length - 1] ?? null;
  const precision = await getPrecision(userId, latestOverall?.deviceSerial ?? null);
  const deviceById = new Map(deviceRows.map((r) => [r.id, [r.deviceMake, r.deviceModel].filter(Boolean).join(" ") || null]));

  const scans: ReportBodyCompScan[] = shown.map((s) => ({
    date: s.scannedAt,
    device: deviceById.get(s.id) ?? null,
    software: s.softwareVersion,
    fatKg: s.totalFatG / 1000,
    leanKg: s.totalLeanG / 1000,
    bmcKg: s.totalBmcG / 1000,
    pctFat: s.pctFat,
    almKg: s.indices.almKg,
    ffmi: s.indices.ffmi,
    almi: s.indices.almi,
    vatG: s.vatMassG,
    bmdGcm2: s.totalBmdGcm2,
    bmdZ: s.bmdZScore,
    prepSummary: scanPrepSummary(s.prep),
    reportLinked: s.documentId != null,
  }));

  // Latest vs previous — the last two scans shown (comparator included), read like the page's latest interval.
  const deltas: ReportBodyCompDelta[] = [];
  let comparabilityReasons: string[] = [];
  if (shown.length >= 2) {
    const prev = shown[shown.length - 2], latest = shown[shown.length - 1];
    const d = intervalDeltas(prev, latest, precision, tests, true);
    const word: ReportBodyCompDelta["comparability"] = d.comparability.hidden ? "not_comparable" : d.comparability.demote ? "reduced" : "comparable";
    const prevTest = tests.length >= 2 ? tests[tests.length - 2] : null;
    const lastTest = tests.length >= 2 ? tests[tests.length - 1] : null;
    // Labels, units and order are the DeltaTable's LSC-bearing rows.
    const rows: { key: DeltaKey; metric: string; unit: string; prev: number | null; next: number | null }[] = [
      { key: "fat", metric: "Fat mass", unit: "kg", prev: prev.totalFatG / 1000, next: latest.totalFatG / 1000 },
      { key: "lean", metric: "Lean mass", unit: "kg", prev: prev.totalLeanG / 1000, next: latest.totalLeanG / 1000 },
      { key: "pctFat", metric: "Body fat", unit: "%", prev: prev.pctFat, next: latest.pctFat },
      { key: "alm", metric: "ALM", unit: "kg", prev: prev.indices.almKg, next: latest.indices.almKg },
      { key: "vat", metric: "VAT", unit: "g", prev: prev.vatMassG, next: latest.vatMassG },
      { key: "bmd", metric: "Total BMD", unit: "g/cm²", prev: prev.totalBmdGcm2, next: latest.totalBmdGcm2 },
      { key: "rmr", metric: "RMR", unit: "kcal/d", prev: prevTest?.measuredRmrKcal ?? null, next: lastTest?.measuredRmrKcal ?? null },
    ];
    for (const r of rows) {
      const f = d.deltas[r.key];
      if (!f || r.prev == null || r.next == null) continue;
      deltas.push({ metric: r.metric, unit: r.unit, previous: r.prev, latest: r.next, delta: f.delta, tier: f.tier, technical: f.technical, practical: f.practical, comparability: word, demoted: f.demoted, rawTier: f.rawTier });
    }
    comparabilityReasons = d.comparability.reasons;
  }

  const rmr: ReportRmr[] = testsInRange.map((t) => {
    const ffmScan = ffmScanFor(t, allScans);
    const ffmKg = ffmScan?.indices.ffmKg ?? null;
    const ladder = rmrEquations({ rmrKcal: t.measuredRmrKcal, sex: t.sex, ageYears: t.ageYears, heightCm: t.heightCm, weightKg: t.weightKg, ffmKg })
      .flatMap((r) => (r.predictedKcal != null && r.ratio != null ? [{ label: r.label, predictedKcal: r.predictedKcal, ratio: r.ratio }] : []));
    return {
      date: t.testedAt,
      method: methodLabel(t.method).replace(" · ", ", "),
      measuredKcal: t.measuredRmrKcal,
      perKgFfm: rmrPerKg(t.measuredRmrKcal, ffmKg, null, null).perKgFfm,
      ladder,
      conditions: rmrConditions(t.prep),
    };
  });

  // Inclusive of the range's first day: `lifeEventDayCounts` is half-open (fromDay, toDay].
  const counts = lifeEventDayCounts(lifeEvents, dayKey(new Date(from.getTime() - DAY)), dayKey(to));
  return { scans, deltas, comparabilityReasons, rmr, lscSource: precisionLabel(precision), lifeEventDays: { illness: counts.illnessDays, travel: counts.travelDays } };
}
