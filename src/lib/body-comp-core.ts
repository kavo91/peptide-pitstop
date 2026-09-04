// src/lib/body-comp-core.ts — PURE. No I/O, no Prisma, no Date.now().
export type Region = "l_arm" | "r_arm" | "trunk" | "l_leg" | "r_leg" | "head" | "android" | "gynoid";
export const LIMB_REGIONS: Region[] = ["l_arm", "r_arm", "l_leg", "r_leg"];
export const BODY_REGIONS: Region[] = ["l_arm", "r_arm", "trunk", "l_leg", "r_leg", "head"]; // sum to totals

export interface RegionValues { region: Region; bmcG: number | null; fatG: number; leanG: number; totalG: number; pctFat: number; pctFatYn?: number | null; pctFatAm?: number | null; bmdGcm2?: number | null }
export interface PrepChecklist { fasted: boolean | null; fastingHours: number | null; noCaffeine: boolean | null; noTrainingPriorDay: boolean | null; activeTravel: boolean | null; euhydratedVoided: boolean | null; illnessFree14d: boolean | null }
export interface GhsState { onGhs: boolean; daysSinceLastDose: number | null }
export interface ScanValues {
  id: string; scannedAt: Date; localDay: string; deviceSerial: string | null; softwareVersion: string | null;
  sex: "male" | "female"; ageYears: number; heightCm: number; clinicWeightKg: number | null;
  totalFatG: number; totalLeanG: number; totalBmcG: number; totalMassG: number; pctFat: number; pctFatYn: number | null; pctFatAm: number | null;
  vatMassG: number | null; vatVolumeCm3: number | null; vatAreaCm2: number | null;
  totalBmdGcm2: number | null; bmdTScore: number | null; bmdZScore: number | null; bmdCvPct: number | null;
  prep: PrepChecklist; creatineStatus: string | null; ghs: GhsState; regions: RegionValues[];
}
export function heightM2(heightCm: number): number { const m = heightCm / 100; return m * m; }
export interface Indices { ffmKg: number; ffmi: number; lmi: number; fmi: number; almKg: number | null; almi: number | null; pctFatRecomputed: number }
export function indices(s: ScanValues): Indices {
  const h2 = heightM2(s.heightCm);
  const ffmKg = (s.totalLeanG + s.totalBmcG) / 1000;
  const limbs = LIMB_REGIONS.map((r) => s.regions.find((x) => x.region === r));
  const almKg = limbs.every(Boolean) ? limbs.reduce((a, r) => a + r!.leanG, 0) / 1000 : null;
  return { ffmKg, ffmi: ffmKg / h2, lmi: s.totalLeanG / 1000 / h2, fmi: s.totalFatG / 1000 / h2, almKg, almi: almKg == null ? null : almKg / h2, pctFatRecomputed: (s.totalFatG / s.totalMassG) * 100 };
}
export interface ChecksumResult { name: string; pass: boolean; detail: string }
function sumOf(rs: RegionValues[], pick: (r: RegionValues) => number | null): number | null { let t = 0; for (const r of rs) { const v = pick(r); if (v == null) return null; t += v; } return t; }
export function checksums(s: ScanValues): ChecksumResult[] {
  const body = BODY_REGIONS.map((r) => s.regions.find((x) => x.region === r)).filter((x): x is RegionValues => !!x);
  const full = body.length === BODY_REGIONS.length;
  const cmp = (name: string, sum: number | null, total: number, tol: number): ChecksumResult =>
    !full || sum == null ? { name, pass: true, detail: "not evaluated (regions incomplete)" }
    : { name, pass: Math.abs(sum - total) <= tol, detail: `regions ${sum.toFixed(1)} vs total ${total.toFixed(1)}` };
  const out = [
    cmp("fat_sum", sumOf(body, (r) => r.fatG), s.totalFatG, 1),
    cmp("lean_sum", sumOf(body, (r) => r.leanG), s.totalLeanG, 1),
    cmp("bmc_sum", sumOf(body, (r) => r.bmcG), s.totalBmcG, 1),
    cmp("mass_sum", sumOf(body, (r) => r.totalG), s.totalMassG, 1),
  ];
  const pf = indices(s).pctFatRecomputed;
  out.push({ name: "pct_fat", pass: Math.abs(pf - s.pctFat) <= 0.15, detail: `recomputed ${pf.toFixed(2)} vs printed ${s.pctFat}` });
  return out;
}
export function limbAsymmetry(regions: RegionValues[]): { armsPct: number | null; legsPct: number | null } {
  const g = (r: Region) => regions.find((x) => x.region === r)?.leanG ?? null;
  const pct = (l: number | null, r: number | null) => l == null || r == null ? null : ((r - l) / ((r + l) / 2)) * 100;
  return { armsPct: pct(g("l_arm"), g("r_arm")), legsPct: pct(g("l_leg"), g("r_leg")) };
}
export function distributionRatios(s: ScanValues): { androidGynoidPctFat: number | null; trunkLimbFatMass: number | null } {
  const a = s.regions.find((x) => x.region === "android"), g = s.regions.find((x) => x.region === "gynoid"), t = s.regions.find((x) => x.region === "trunk");
  const limbs = LIMB_REGIONS.map((r) => s.regions.find((x) => x.region === r));
  const limbFat = limbs.every(Boolean) ? limbs.reduce((acc, r) => acc + r!.fatG, 0) : null;
  return { androidGynoidPctFat: a && g && g.pctFat > 0 ? a.pctFat / g.pctFat : null, trunkLimbFatMass: t && limbFat ? t.fatG / limbFat : null };
}

export type PrecisionSource = "device_class_default" | "clinic_supplied" | "measured_own" | "iscd_min";
export interface Precision { source: PrecisionSource; fatCvPct: number; leanCvPct: number; pctFatLscAbs: number; almCvPct: number | null; vatCvPct: number | null; bmdCvPct: number | null; rmrCvPct: number; practicalFatMultiplier: number; practicalLeanMultiplier: number }
/** Hologic Horizon A same-day precision (Nowitz 2017) + consecutive-day multipliers (Zemski 2019). RMR 8% CV ≈ VO2-only device class. */
export const DEFAULT_PRECISION: Precision = { source: "device_class_default", fatCvPct: 0.78, leanCvPct: 0.52, pctFatLscAbs: 0.5, almCvPct: 1.0, vatCvPct: 2.63, bmdCvPct: 1.0, rmrCvPct: 8.0, practicalFatMultiplier: 1.9, practicalLeanMultiplier: 3.4 };
export const LSC_K = 2.77;
export interface LscBand { technical: number; practical: number | null }
const lscAbs = (value: number, cvPct: number) => (value * cvPct) / 100 * LSC_K;
export function fatLsc(fatKg: number, p: Precision): LscBand { const t = lscAbs(fatKg, p.fatCvPct); return { technical: t, practical: t * p.practicalFatMultiplier }; }
export function leanLsc(leanKg: number, p: Precision): LscBand { const t = lscAbs(leanKg, p.leanCvPct); return { technical: t, practical: t * p.practicalLeanMultiplier }; }
export function pctFatLsc(p: Precision): LscBand { return { technical: p.pctFatLscAbs, practical: p.pctFatLscAbs * p.practicalLeanMultiplier }; }
export function almLsc(almKg: number, p: Precision): LscBand { return { technical: lscAbs(almKg, p.almCvPct ?? 1.0), practical: null }; }
export function vatLsc(vatG: number, p: Precision): LscBand { const t = lscAbs(vatG, p.vatCvPct ?? 2.63); return { technical: t, practical: t * 2 }; }
export function bmdLsc(bmd: number, cvPct: number): number { return lscAbs(bmd, cvPct); }
export function rmrLsc(rmrKcal: number, p: Precision): number { return lscAbs(rmrKcal, p.rmrCvPct); }
export type ChangeTier = "within_noise" | "indeterminate" | "exceeds_lsc";
export interface DeltaFlag {
  delta: number; multipleOfTechnical: number; tier: ChangeTier; technical: number; practical: number | null;
  /** Set by `demoteFlag`: `tier` was lowered one step for reduced comparability; `rawTier` is the tier the numbers alone give. */
  demoted?: boolean; rawTier?: ChangeTier;
}
/**
 * Boundary tolerance for the tier thresholds. The tiers are defined as inclusive
 * on the band edge (|Δ| = technical → indeterminate; |Δ| = practical → exceeds),
 * but `next - prev` on decimal inputs lands a few ULPs under the edge
 * (16.4 − 16.1 = 0.29999999999999716), so a bare `>=` would misclassify an
 * exact-boundary change. 1e-9 is far below any measurement resolution.
 */
const TIER_EPS = 1e-9;
const atLeast = (a: number, threshold: number) => a >= threshold - TIER_EPS;
export function deltaFlag(prev: number, next: number, band: LscBand): DeltaFlag {
  const delta = next - prev, a = Math.abs(delta);
  const tier: ChangeTier = band.practical != null && atLeast(a, band.practical) ? "exceeds_lsc" : atLeast(a, band.technical) ? "indeterminate" : "within_noise";
  return { delta, multipleOfTechnical: band.technical > 0 ? a / band.technical : 0, tier, technical: band.technical, practical: band.practical };
}
export function demoteTier(t: ChangeTier): ChangeTier { return t === "exceeds_lsc" ? "indeterminate" : "within_noise"; }
/** One-step demotion that keeps the undemoted tier, so every surface can label the flag as demoted instead of printing a tier its own numbers contradict. */
export function demoteFlag(f: DeltaFlag): DeltaFlag { return { ...f, tier: demoteTier(f.tier), rawTier: f.rawTier ?? f.tier, demoted: true }; }
export function ratePer30d(delta: number, days: number, band: LscBand): number | null { return days < 28 || Math.abs(delta) < band.technical ? null : (delta / days) * 30; }
export interface Comparability { comparable: boolean; hidden: boolean; demote: boolean; reasons: string[] }
export function comparability(a: ScanValues, b: ScanValues): Comparability {
  const reasons: string[] = []; let hidden = false;
  if (a.deviceSerial && b.deviceSerial && a.deviceSerial !== b.deviceSerial) { hidden = true; reasons.push("different scanner serial"); }
  if (a.softwareVersion && b.softwareVersion && a.softwareVersion !== b.softwareVersion) { hidden = true; reasons.push("different analysis software"); }
  const keys: (keyof PrepChecklist)[] = ["fasted", "noCaffeine", "noTrainingPriorDay", "activeTravel", "euhydratedVoided", "illnessFree14d"];
  for (const k of keys) { const x = a.prep[k], y = b.prep[k]; if (x == null || y == null) reasons.push(`${k}: not recorded on one scan`); else if (x !== y) reasons.push(`${k}: differs`); }
  if ((a.creatineStatus ?? "unknown") !== (b.creatineStatus ?? "unknown")) reasons.push("creatine status differs");
  if (a.ghs.onGhs !== b.ghs.onGhs) reasons.push("GH-secretagogue state differs — lean is unreadable across a secretagogue change");
  return { comparable: !hidden && reasons.length === 0, hidden, demote: !hidden && reasons.length > 0, reasons };
}
const DAY = 86_400_000;
export interface NextDue { dueStart: Date; dueEnd: Date; daysToStart: number; status: "upcoming" | "in_window" | "window_passed" }
export function nextScanDue(latest: Date, now: Date): NextDue {
  const dueStart = new Date(latest.getTime() + 84 * DAY), dueEnd = new Date(latest.getTime() + 112 * DAY);
  const daysToStart = Math.ceil((dueStart.getTime() - now.getTime()) / DAY);
  return { dueStart, dueEnd, daysToStart, status: now < dueStart ? "upcoming" : now <= dueEnd ? "in_window" : "window_passed" };
}
export function intervalCompleteness(x: { prepMatched: boolean; intakeLoggedPct: number; weightDaysPct: number; trainingDaysPct: number; lifeEventsTagged: boolean }): { score: number; attributionBlocked: boolean } {
  const score = Math.round(((x.prepMatched ? 25 : 0) + Math.min(x.intakeLoggedPct, 100) * 0.35 + Math.min(x.weightDaysPct, 100) * 0.15 + Math.min(x.trainingDaysPct, 100) * 0.15 + (x.lifeEventsTagged ? 10 : 0)));
  return { score, attributionBlocked: x.intakeLoggedPct < 80 };
}

export interface RmrInputs { rmrKcal: number; sex: "male" | "female"; ageYears: number; heightCm: number; weightKg: number; ffmKg: number | null }
export interface EquationRow { key: string; label: string; basis: "weight" | "ffm"; predictedKcal: number | null; ratio: number | null; primary: boolean; note: string }
export function rmrEquations(i: RmrInputs): EquationRow[] {
  const { sex: s, ageYears: a, heightCm: h, weightKg: w, ffmKg: f } = i; const hm = h / 100; const male = s === "male";
  const rows: Omit<EquationRow, "ratio" | "primary">[] = [
    { key: "mifflin", label: "Mifflin-St Jeor (1990)", basis: "weight", predictedKcal: 10 * w + 6.25 * h - 5 * a + (male ? 5 : -161), note: "General population; under-predicts trained subjects." },
    { key: "harris_benedict_roza", label: "Harris-Benedict (Roza 1984)", basis: "weight", predictedKcal: male ? 88.362 + 13.397 * w + 4.799 * h - 5.677 * a : 447.593 + 9.247 * w + 3.098 * h - 4.330 * a, note: "Basal, not resting." },
    { key: "ten_haaf_weight", label: "ten Haaf & Weijs 2014 (weight)", basis: "weight", predictedKcal: (49.94 * w + 2459.053 * hm - 34.014 * a + 799.257 * (male ? 1 : 0) + 122.502) / 4.184, note: "Recreational athletes." },
    { key: "tinsley_2019_weight", label: "Tinsley 2019 (weight)", basis: "weight", predictedKcal: 24.8 * w + 10, note: "Muscular athletes." },
    { key: "katch_mcardle", label: "Katch-McArdle / Cunningham 1991", basis: "ffm", predictedKcal: f == null ? null : 370 + 21.6 * f, note: "Lowest intercept; sits ~155 kcal under Cunningham-1980." },
    { key: "cunningham_1980", label: "Cunningham 1980", basis: "ffm", predictedKcal: f == null ? null : 500 + 22 * f, note: "Basal; re-analysis of Harris-Benedict data." },
    { key: "ten_haaf_ffm", label: "ten Haaf & Weijs 2014 (FFM)", basis: "ffm", predictedKcal: f == null ? null : (95.272 * f + 2026.161) / 4.184, note: "FFM by air-displacement plethysmography." },
    { key: "tinsley_2019_ffm", label: "Tinsley 2019 (FFM)", basis: "ffm", predictedKcal: f == null ? null : 25.9 * f + 284, note: "FFM by DXA — the method-matched reference." },
  ];
  const primaryKey = f == null ? "mifflin" : "tinsley_2019_ffm";
  return rows.map((r) => ({ ...r, ratio: r.predictedKcal ? i.rmrKcal / r.predictedKcal : null, primary: r.key === primaryKey }));
}
export function rmrPerKg(rmrKcal: number, ffmKg: number | null, leanKg: number | null, bodyMassKg: number | null) {
  return { perKgFfm: ffmKg ? rmrKcal / ffmKg : null, perKgLean: leanKg ? rmrKcal / leanKg : null, perKgBodyMass: bodyMassKg ? rmrKcal / bodyMassKg : null };
}
export function vo2FromRmr(rmrKcal: number, kcalPerLitreO2: number, weightKg: number | null) {
  const litresPerDay = rmrKcal / kcalPerLitreO2, mlPerMin = (litresPerDay * 1000) / 1440;
  return { litresPerDay, mlPerMin, mets: weightKg ? mlPerMin / weightKg / 3.5 : null };
}
export interface ScaleReading { day: string; bodyFatPct: number | null; weightKg: number | null }
const dayDiff = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / DAY);
export function biaOffset(scanPctFat: number, scale: ScaleReading[], localDay: string): { offsetPts: number; scaleDay: string; anchorWeightKg: number | null } | null {
  const cands = scale.filter((s) => s.bodyFatPct != null && Math.abs(dayDiff(s.day, localDay)) <= 1).sort((x, y) => Math.abs(dayDiff(x.day, localDay)) - Math.abs(dayDiff(y.day, localDay)));
  const s = cands[0]; if (!s) return null;
  return { offsetPts: Math.round((scanPctFat - s.bodyFatPct!) * 10) / 10, scaleDay: s.day, anchorWeightKg: s.weightKg };
}
export function calibrateBia(series: ScaleReading[], offsetPts: number, anchorWeightKg: number | null) {
  return series.map((s) => ({ day: s.day, calibratedPct: s.bodyFatPct == null || (anchorWeightKg != null && s.weightKg != null && Math.abs(s.weightKg - anchorWeightKg) > 3) ? null : s.bodyFatPct + offsetPts }));
}
export function cleanWeightSeries(rows: { day: string; weightKg: number | null }[]) {
  const sorted = rows.filter((r) => r.weightKg != null).sort((a, b) => a.day.localeCompare(b.day)) as { day: string; weightKg: number }[];
  const kept: typeof sorted = [], excluded: typeof sorted = [];
  sorted.forEach((r, i) => {
    const lo = Math.max(0, i - 3), hi = Math.min(sorted.length, i + 4);
    const win = sorted.slice(lo, hi).filter((_, j) => lo + j !== i).map((x) => x.weightKg).sort((a, b) => a - b);
    const med = win.length ? win[Math.floor(win.length / 2)] : r.weightKg;
    (Math.abs(r.weightKg - med) > 3 ? excluded : kept).push(r);
  });
  return { kept, excluded };
}
