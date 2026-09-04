// src/lib/dexa-parse-core.ts — PURE. No I/O, no Prisma, no Date.now().
//
// Hologic APEX whole-body report text → the values the scan form needs, plus
// checksums and a confidence score. Every anchor is a regex over the text layer
// (`extractPdfText`) that tolerates any whitespace, including newlines, between
// fields. Numbers are read exactly as printed; nothing derived is emitted except
// the checks that compare printed values with each other.
import {
  checksums,
  indices,
  BODY_REGIONS,
  type ChecksumResult,
  type Region,
  type RegionValues,
  type ScanValues,
} from "./body-comp-core";
import type { RegionInput } from "@/app/actions/bodycomp";

export interface ParsedScanHeader {
  sex: "male" | "female";
  heightCm: number;
  clinicWeightKg: number | null;
  ageYears: number;
  /** `YYYY-MM-DD` when the printed "Scan Date" parses; null otherwise. */
  scanDate: string | null;
  /** The "Scan Date" exactly as printed (kept so nothing is lost when it does not parse). */
  scanDateRaw: string | null;
  softwareVersion: string | null;
  deviceModel: string | null;
  deviceSerial: string | null;
  scanMode: string | null;
  referencePopulation: string | null;
}
export interface ParsedScan {
  header: ParsedScanHeader;
  totals: { totalFatG: number; totalLeanG: number; totalBmcG: number; totalMassG: number; pctFat: number; pctFatYn: number | null; pctFatAm: number | null };
  /** Up to all eight regions (l_arm r_arm trunk l_leg r_leg head android gynoid); android/gynoid only when printed. */
  regions: RegionInput[];
  vat: { massG: number | null; volumeCm3: number | null; areaCm2: number | null };
  bone: { totalBmdGcm2: number | null; tScore: number | null; zScore: number | null; cvPct: number | null };
  indices: { fmi: number | null; fmiYn: number | null; fmiAm: number | null; lmi: number | null; lmiYn: number | null; lmiAm: number | null; almi: number | null; almiYn: number | null; almiAm: number | null; androidGynoid: number | null };
}
export interface ParseResult {
  /** Every required anchor found AND every check passed. */
  ok: boolean;
  /** Present whenever the required anchors were found — even when a check failed, so the review panel can show what was read. */
  scan: ParsedScan | null;
  checks: ChecksumResult[];
  /** 0..1 = fraction of expected anchors found × checksum pass rate. */
  confidence: number;
  /** Anchor names not found (required and optional alike). */
  missing: string[];
}

/** Superscripts and non-breaking spaces as pdf.js emits them → plain ASCII; thousands separators dropped. */
export function normaliseReportText(text: string): string {
  return text
    .replace(/²/g, "2")
    .replace(/³/g, "3")
    .replace(/ /g, " ")
    .replace(/(\d),(?=\d{3}(?!\d))/g, "$1");
}

// ---------------------------------------------------------------------------
// Anchors
// ---------------------------------------------------------------------------
const SUMMARY_LABELS = ["L Arm", "R Arm", "Trunk", "L Leg", "R Leg", "Subtotal", "Head", "Total"] as const;
const PERCENTILE_LABELS = ["L Arm", "R Arm", "Trunk", "L Leg", "R Leg", "Subtotal", "Total"] as const;
const BMD_LABELS = ["L Arm", "R Arm", "L Leg", "R Leg", "Head"] as const;
const REGION_BY_LABEL: Record<string, Region> = { "L Arm": "l_arm", "R Arm": "r_arm", Trunk: "trunk", "L Leg": "l_leg", "R Leg": "r_leg", Head: "head" };

const D1 = "(\\d+\\.\\d)"; // one decimal
const D2 = "(\\d+\\.\\d\\d)"; // two decimals
const INT = "(\\d+)";
const S = "\\s+";
/** A row label: words may be split by any whitespace; must not be the tail of a longer word (Subtotal ≠ Total). */
const label = (l: string) => `(?<![A-Za-z])${l.split(" ").join("\\s+")}`;

const summaryRe = (l: string) => new RegExp(`${label(l)}${S}${D2}${S}${D1}${S}${D1}${S}${D1}${S}${D1}${S}${D1}`);
const percentileRe = (l: string) => new RegExp(`${label(l)}${S}${INT}${S}${INT}${S}${INT}${S}${D1}${S}${INT}${S}${INT}`);
const bmdRe = (l: string) => new RegExp(`${label(l)}${S}${D2}${S}${D2}${S}(\\d\\.\\d{3})`);
const androidRe = new RegExp(`Android\\s*\\(A\\)${S}${INT}${S}${INT}${S}${INT}${S}${D1}`);
const gynoidRe = new RegExp(`Gynoid\\s*\\(G\\)${S}${INT}${S}${INT}${S}${INT}${S}${D1}`);

const HEADER = {
  sex: /Sex:\s*(Male|Female)/,
  height: /Height:\s*([\d.]+)\s*cm/,
  weight: /Weight:\s*([\d.]+)\s*kg/,
  age: /Age:\s*(\d+)/,
  scanDate: /Scan\s+Date:\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})/,
  version: /Version\s+([\d.]+)/,
  model: /Model:\s*([A-Za-z ]+?)\s*\(S\/N\s*([A-Za-z0-9]+)\)/,
  scanType: /Scan\s+Type:\s*a?\s*(Whole\s+Body)/,
  reference: /T-score\s+vs\.\s*([A-Za-z ]+?)\.\s*Source:\s*(\S+)/,
} as const;

const INDICES = {
  totalBodyPctFat: new RegExp(`Total\\s+Body\\s+%\\s*Fat${S}${D1}${S}${INT}${S}${INT}`),
  fmi: new RegExp(`Fat\\s+Mass/Height2\\s*\\(kg/m2\\)${S}${D2}${S}${INT}${S}${INT}`),
  agRatio: new RegExp(`Android/Gynoid\\s+Ratio${S}${D2}`),
  vatMass: new RegExp(`Est\\.\\s*VAT\\s+Mass\\s*\\(g\\)${S}${INT}`),
  vatVolume: new RegExp(`Est\\.\\s*VAT\\s+Volume\\s*\\(cm3\\)${S}${INT}`),
  vatArea: new RegExp(`Est\\.\\s*VAT\\s+Area\\s*\\(cm2\\)${S}${D1}`),
  lmi: new RegExp(`(?<!Appen\\.\\s{0,3})Lean/Height2\\s*\\(kg/m2\\)${S}${D1}${S}${INT}${S}${INT}`),
  almi: new RegExp(`Appen\\.\\s*Lean/Height2\\s*\\(kg/m2\\)${S}${D2}${S}${INT}${S}${INT}`),
} as const;
const BMD_TOTAL = new RegExp(`${label("Total")}${S}${D2}${S}${D2}${S}(\\d\\.\\d{3})${S}(-?\\d+\\.\\d)${S}(-?\\d+\\.\\d)`);
const BMD_CV = new RegExp(`Total\\s+BMD\\s+CV${S}${D1}\\s*%`);

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
/** "2 September 2026" / "02 Sep 2026" → "2026-09-02"; null when the month is not an English month name. */
export function isoFromPrintedDate(printed: string): string | null {
  const m = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(printed.trim());
  if (!m) return null;
  const mi = MONTHS.findIndex((name) => name === m[2].toLowerCase() || name.slice(0, 3) === m[2].toLowerCase().slice(0, 3));
  if (mi < 0) return null;
  const day = Number(m[1]);
  if (day < 1 || day > 31) return null;
  return `${m[3]}-${String(mi + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------
interface SummaryRow { bmcG: number; fatG: number; leanG: number; leanBmcG: number; totalG: number; pctFat: number }
interface PercentileRow { fatG: number; leanBmcG: number; totalG: number; pctFat: number; pctFatYn: number; pctFatAm: number }
interface BmdRow { areaCm2: number; bmcG: number; bmdGcm2: number }

const num = (s: string | undefined): number | null => { if (s == null) return null; const n = Number(s); return Number.isFinite(n) ? n : null; };
const str = (n: number | null | undefined): string | undefined => (n == null ? undefined : String(n));

export function parseHologicReport(rawText: string): ParseResult {
  const text = normaliseReportText(rawText);
  const found: string[] = []; const missing: string[] = [];
  const mark = (name: string, hit: boolean) => (hit ? found : missing).push(name);
  const grab = <T,>(name: string, re: RegExp, pick: (m: RegExpExecArray) => T): T | null => {
    const m = re.exec(text); mark(name, !!m); return m ? pick(m) : null;
  };

  // Header
  const sexRaw = grab("header:Sex", HEADER.sex, (m) => m[1]);
  const heightCm = grab("header:Height", HEADER.height, (m) => num(m[1]));
  const clinicWeightKg = grab("header:Weight", HEADER.weight, (m) => num(m[1]));
  const ageYears = grab("header:Age", HEADER.age, (m) => num(m[1]));
  const scanDateRaw = grab("header:Scan Date", HEADER.scanDate, (m) => m[1].replace(/\s+/g, " "));
  const softwareVersion = grab("header:Version", HEADER.version, (m) => m[1]);
  const model = grab("header:Model", HEADER.model, (m) => ({ model: m[1].trim(), serial: m[2] }));
  const scanMode = grab("header:Scan Type", HEADER.scanType, (m) => m[1].replace(/\s+/g, " "));
  const reference = grab("header:Reference", HEADER.reference, (m) => `${m[2]} ${m[1].trim()}`);

  // Summary table (BMC two decimals, the rest one)
  const summary: Partial<Record<(typeof SUMMARY_LABELS)[number], SummaryRow>> = {};
  for (const l of SUMMARY_LABELS) {
    const row = grab(`summary:${l}`, summaryRe(l), (m) => ({ bmcG: Number(m[1]), fatG: Number(m[2]), leanG: Number(m[3]), leanBmcG: Number(m[4]), totalG: Number(m[5]), pctFat: Number(m[6]) }));
    if (row) summary[l] = row;
  }
  // Percentile table (integers + %fat + YN + AM)
  const pct: Partial<Record<(typeof PERCENTILE_LABELS)[number], PercentileRow>> = {};
  for (const l of PERCENTILE_LABELS) {
    const row = grab(`percentile:${l}`, percentileRe(l), (m) => ({ fatG: Number(m[1]), leanBmcG: Number(m[2]), totalG: Number(m[3]), pctFat: Number(m[4]), pctFatYn: Number(m[5]), pctFatAm: Number(m[6]) }));
    if (row) pct[l] = row;
  }
  const android = grab("percentile:Android", androidRe, (m) => ({ fatG: Number(m[1]), leanG: Number(m[2]), totalG: Number(m[3]), pctFat: Number(m[4]) }));
  const gynoid = grab("percentile:Gynoid", gynoidRe, (m) => ({ fatG: Number(m[1]), leanG: Number(m[2]), totalG: Number(m[3]), pctFat: Number(m[4]) }));

  // Adipose / lean indices
  const totalBodyPctFat = grab("indices:Total Body % Fat", INDICES.totalBodyPctFat, (m) => ({ pctFat: Number(m[1]), yn: Number(m[2]), am: Number(m[3]) }));
  const fmi = grab("indices:Fat Mass/Height2", INDICES.fmi, (m) => ({ value: Number(m[1]), yn: Number(m[2]), am: Number(m[3]) }));
  const agRatio = grab("indices:Android/Gynoid Ratio", INDICES.agRatio, (m) => Number(m[1]));
  const vatMass = grab("indices:Est. VAT Mass", INDICES.vatMass, (m) => Number(m[1]));
  const vatVolume = grab("indices:Est. VAT Volume", INDICES.vatVolume, (m) => Number(m[1]));
  const vatArea = grab("indices:Est. VAT Area", INDICES.vatArea, (m) => Number(m[1]));
  const lmi = grab("indices:Lean/Height2", INDICES.lmi, (m) => ({ value: Number(m[1]), yn: Number(m[2]), am: Number(m[3]) }));
  const almi = grab("indices:Appen. Lean/Height2", INDICES.almi, (m) => ({ value: Number(m[1]), yn: Number(m[2]), am: Number(m[3]) }));

  // BMD table
  const bmd: Partial<Record<(typeof BMD_LABELS)[number], BmdRow>> = {};
  for (const l of BMD_LABELS) {
    const row = grab(`bmd:${l}`, bmdRe(l), (m) => ({ areaCm2: Number(m[1]), bmcG: Number(m[2]), bmdGcm2: Number(m[3]) }));
    if (row) bmd[l] = row;
  }
  const bmdTotal = grab("bmd:Total", BMD_TOTAL, (m) => ({ areaCm2: Number(m[1]), bmcG: Number(m[2]), bmdGcm2: Number(m[3]), tScore: Number(m[4]), zScore: Number(m[5]) }));
  const bmdCv = grab("bmd:Total BMD CV", BMD_CV, (m) => Number(m[1]));

  const anchorsExpected = found.length + missing.length;
  const anchorFraction = anchorsExpected ? found.length / anchorsExpected : 0;

  // Required: header sex/height/age, the six body regions of the summary table, totals + %fat (summary Total row).
  const total = summary.Total;
  const bodyRows = BODY_REGIONS.map((r) => summary[labelOf(r)]);
  const required = sexRaw != null && heightCm != null && ageYears != null && total != null && bodyRows.every(Boolean);
  if (!required) {
    return { ok: false, scan: null, checks: [], confidence: round3(anchorFraction * 1), missing };
  }

  // Regions (RegionInput strings, exactly as printed)
  const regionValues: RegionValues[] = [];
  const regions: RegionInput[] = [];
  for (const r of BODY_REGIONS) {
    const l = labelOf(r); const s = summary[l]!; const p = l === "Head" ? undefined : pct[l as (typeof PERCENTILE_LABELS)[number]]; const b = l === "Trunk" ? undefined : bmd[l as (typeof BMD_LABELS)[number]];
    regionValues.push({ region: r, bmcG: s.bmcG, fatG: s.fatG, leanG: s.leanG, totalG: s.totalG, pctFat: s.pctFat, pctFatYn: p?.pctFatYn ?? null, pctFatAm: p?.pctFatAm ?? null, bmdGcm2: b?.bmdGcm2 ?? null });
    regions.push({ region: r, bmcG: str(s.bmcG), fatG: String(s.fatG), leanG: String(s.leanG), totalG: String(s.totalG), pctFat: String(s.pctFat), pctFatYn: str(p?.pctFatYn), pctFatAm: str(p?.pctFatAm), bmdGcm2: str(b?.bmdGcm2) });
  }
  if (android) {
    regionValues.push({ region: "android", bmcG: null, fatG: android.fatG, leanG: android.leanG, totalG: android.totalG, pctFat: android.pctFat });
    regions.push({ region: "android", fatG: String(android.fatG), leanG: String(android.leanG), totalG: String(android.totalG), pctFat: String(android.pctFat) });
  }
  if (gynoid) {
    regionValues.push({ region: "gynoid", bmcG: null, fatG: gynoid.fatG, leanG: gynoid.leanG, totalG: gynoid.totalG, pctFat: gynoid.pctFat });
    regions.push({ region: "gynoid", fatG: String(gynoid.fatG), leanG: String(gynoid.leanG), totalG: String(gynoid.totalG), pctFat: String(gynoid.pctFat) });
  }

  const scanDate = scanDateRaw ? isoFromPrintedDate(scanDateRaw) : null;
  const pctFatYn = pct.Total?.pctFatYn ?? totalBodyPctFat?.yn ?? null;
  const pctFatAm = pct.Total?.pctFatAm ?? totalBodyPctFat?.am ?? null;

  const values: ScanValues = {
    id: "parsed", scannedAt: new Date(0), localDay: scanDate ?? "", deviceSerial: model?.serial ?? null, softwareVersion,
    sex: sexRaw === "Female" ? "female" : "male", ageYears: ageYears, heightCm: heightCm, clinicWeightKg,
    totalFatG: total.fatG, totalLeanG: total.leanG, totalBmcG: total.bmcG, totalMassG: total.totalG, pctFat: total.pctFat, pctFatYn, pctFatAm,
    vatMassG: vatMass, vatVolumeCm3: vatVolume, vatAreaCm2: vatArea,
    totalBmdGcm2: bmdTotal?.bmdGcm2 ?? null, bmdTScore: bmdTotal?.tScore ?? null, bmdZScore: bmdTotal?.zScore ?? null, bmdCvPct: bmdCv,
    prep: { fasted: null, fastingHours: null, noCaffeine: null, noTrainingPriorDay: null, activeTravel: null, euhydratedVoided: null, illnessFree14d: null },
    creatineStatus: null, ghs: { onGhs: false, daysSinceLastDose: null }, regions: regionValues,
  };

  const checks: ChecksumResult[] = [...checksums(values), ...parserChecks(summary, values, { fmi: fmi?.value ?? null, lmi: lmi?.value ?? null, almi: almi?.value ?? null })];
  // The Scan Date anchor was found but its text is not a date ("32 January 2026", "10 Enero 2026"):
  // a failed check, so the report is never "read · 100 %" with the scan date silently absent.
  if (scanDateRaw != null && scanDate == null) checks.push({ name: "scan_date", pass: false, detail: `printed "${scanDateRaw}" could not be interpreted as a date` });
  const passRate = checks.length ? checks.filter((c) => c.pass).length / checks.length : 1;
  const scan: ParsedScan = {
    header: { sex: values.sex, heightCm, clinicWeightKg, ageYears, scanDate, scanDateRaw, softwareVersion, deviceModel: model?.model ?? null, deviceSerial: model?.serial ?? null, scanMode, referencePopulation: reference },
    totals: { totalFatG: total.fatG, totalLeanG: total.leanG, totalBmcG: total.bmcG, totalMassG: total.totalG, pctFat: total.pctFat, pctFatYn, pctFatAm },
    regions,
    vat: { massG: vatMass, volumeCm3: vatVolume, areaCm2: vatArea },
    bone: { totalBmdGcm2: bmdTotal?.bmdGcm2 ?? null, tScore: bmdTotal?.tScore ?? null, zScore: bmdTotal?.zScore ?? null, cvPct: bmdCv },
    indices: { fmi: fmi?.value ?? null, fmiYn: fmi?.yn ?? null, fmiAm: fmi?.am ?? null, lmi: lmi?.value ?? null, lmiYn: lmi?.yn ?? null, lmiAm: lmi?.am ?? null, almi: almi?.value ?? null, almiYn: almi?.yn ?? null, almiAm: almi?.am ?? null, androidGynoid: agRatio },
  };
  return { ok: checks.every((c) => c.pass), scan, checks, confidence: round3(anchorFraction * passRate), missing };
}

function labelOf(r: Region): (typeof SUMMARY_LABELS)[number] {
  const entry = Object.entries(REGION_BY_LABEL).find(([, v]) => v === r);
  return (entry ? entry[0] : "Total") as (typeof SUMMARY_LABELS)[number];
}
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Parser-specific checks over printed values: subtotal + head = total; the five body regions = subtotal; printed indices; VAT density. */
function parserChecks(summary: Partial<Record<(typeof SUMMARY_LABELS)[number], SummaryRow>>, v: ScanValues, printed: { fmi: number | null; lmi: number | null; almi: number | null }): ChecksumResult[] {
  const out: ChecksumResult[] = [];
  const sub = summary.Subtotal, head = summary.Head, total = summary.Total;
  const metrics: { key: keyof SummaryRow; name: string }[] = [{ key: "fatG", name: "fat" }, { key: "leanG", name: "lean" }, { key: "bmcG", name: "bmc" }, { key: "totalG", name: "mass" }];
  for (const { key, name } of metrics) {
    if (sub && head && total) {
      const s = sub[key] + head[key];
      out.push({ name: `subtotal_head_${name}`, pass: Math.abs(s - total[key]) <= 1, detail: `subtotal + head ${s.toFixed(1)} vs total ${total[key].toFixed(1)}` });
    } else out.push({ name: `subtotal_head_${name}`, pass: true, detail: "not evaluated (subtotal or head row missing)" });
    const five = (["L Arm", "R Arm", "Trunk", "L Leg", "R Leg"] as const).map((l) => summary[l]);
    if (sub && five.every(Boolean)) {
      const s = five.reduce((a, r) => a + r![key], 0);
      out.push({ name: `regions_subtotal_${name}`, pass: Math.abs(s - sub[key]) <= 0.5, detail: `five regions ${s.toFixed(1)} vs subtotal ${sub[key].toFixed(1)}` });
    } else out.push({ name: `regions_subtotal_${name}`, pass: true, detail: "not evaluated (subtotal row missing)" });
  }
  const idx = indices(v);
  const cmpIndex = (name: string, recomputed: number | null, p: number | null) =>
    out.push(p == null || recomputed == null ? { name, pass: true, detail: "not evaluated (not printed)" } : { name, pass: Math.abs(recomputed - p) <= 0.05, detail: `recomputed ${recomputed.toFixed(3)} vs printed ${p}` });
  cmpIndex("fmi_printed", idx.fmi, printed.fmi);
  cmpIndex("lmi_printed", idx.lmi, printed.lmi);
  cmpIndex("almi_printed", idx.almi, printed.almi);
  if (v.vatMassG != null && v.vatVolumeCm3 != null && v.vatVolumeCm3 > 0) {
    const d = v.vatMassG / v.vatVolumeCm3;
    out.push({ name: "vat_density", pass: d >= 0.9 && d <= 0.95, detail: `${d.toFixed(3)} g/cm3 (expected 0.90–0.95)` });
  } else out.push({ name: "vat_density", pass: true, detail: "not evaluated (VAT mass or volume missing)" });
  return out;
}
