import { describe, it, expect } from "vitest";
import { extractPdfText } from "@/lib/pdf-text";
import {
  buildReportPdf,
  formatDoseDateTime,
  summariseSideEffects,
  safe,
  buildLabComparison,
  type ReportBodyComp,
  type ReportData,
  type ReportLabPanel,
} from "./report";

const PDF_MAGIC = "%PDF";

/**
 * A defensive second attempt on a fresh buffer copy. The action itself no
 * longer retries (the pdf.js legacy extractor does not need it); this is only
 * here so a flaky first read cannot fail an unrelated PDF-content assertion.
 */
async function pdfText(buf: Buffer): Promise<string> {
  try {
    return await extractPdfText(buf);
  } catch {
    return extractPdfText(Buffer.from(buf));
  }
}

/**
 * SYNTHETIC body-composition section: two scans (the first is the comparator
 * from before the range), one RMR test. No real serial, facility or health
 * numbers — round figures only.
 */
function sampleBodyComp(): ReportBodyComp {
  const d = (s: string) => new Date(s);
  const prep = "fasted yes (12 h), no caffeine yes, no training prior day yes, active travel no, hydrated and voided unknown, illness-free 14 d unknown";
  return {
    scans: [
      { date: d("2026-03-10T09:00:00"), device: "SynthCo Model X", software: "1.0.0", fatKg: 17.0, leanKg: 61.5, bmcKg: 3.0, pctFat: 20.9, almKg: 28.5, ffmi: 20.36, almi: 8.99, vatG: 450, bmdGcm2: 1.145, bmdZ: -0.4, prepSummary: prep, reportLinked: false },
      { date: d("2026-06-10T09:00:00"), device: "SynthCo Model X", software: "1.0.0", fatKg: 16.8, leanKg: 62.0, bmcKg: 3.0, pctFat: 20.5, almKg: 28.6, ffmi: 20.51, almi: 9.03, vatG: 430, bmdGcm2: 1.150, bmdZ: -0.3, prepSummary: prep, reportLinked: true },
    ],
    deltas: [
      { metric: "Fat mass", unit: "kg", previous: 17.0, latest: 16.8, delta: -0.2, tier: "within_noise", technical: 0.37, practical: 0.7, comparability: "comparable" },
      { metric: "Lean mass", unit: "kg", previous: 61.5, latest: 62.0, delta: 0.5, tier: "within_noise", technical: 0.89, practical: 3.01, comparability: "comparable" },
      { metric: "Body fat", unit: "%", previous: 20.9, latest: 20.5, delta: -0.4, tier: "within_noise", technical: 0.5, practical: 1.7, comparability: "comparable" },
      { metric: "VAT", unit: "g", previous: 450, latest: 430, delta: -20, tier: "within_noise", technical: 32.8, practical: 65.6, comparability: "comparable" },
      { metric: "RMR", unit: "kcal/d", previous: 1750, latest: 1900, delta: 150, tier: "indeterminate", technical: 387.8, practical: null, comparability: "comparable" },
    ],
    rmr: [
      {
        date: d("2026-06-10T09:03:00"),
        method: "indirect calorimetry, VO2 only",
        measuredKcal: 1900,
        perKgFfm: 29.2,
        ladder: [
          { label: "Mifflin-St Jeor (1990)", predictedKcal: 1755, ratio: 1.08 },
          { label: "Cunningham 1980", predictedKcal: 1930, ratio: 0.98 },
          { label: "Tinsley 2019 (FFM)", predictedKcal: 1968, ratio: 0.97 },
        ],
        conditions: "fasted yes, no caffeine yes, no training prior day yes, active travel no, rested 20 min, awake and still yes, illness-free 14 d yes",
      },
    ],
    lscSource: "default LSC (device class, not this clinic's precision)",
    lifeEventDays: { illness: 3, travel: 0 },
  };
}

/** A representative, fully-populated report (no DB needed — plain literal). */
function sampleData(): ReportData {
  const d = (s: string) => new Date(s);
  return {
    brand: "Peptide Tracker",
    ownerEmail: "owner@example.com",
    generatedAt: d("2026-06-23T08:00:00"),
    from: d("2026-03-25T00:00:00"),
    to: d("2026-06-23T23:59:59"),
    doses: [
      {
        takenAt: d("2026-06-20T07:30:00"),
        tz: "Australia/Brisbane",
        peptide: "BPC-157",
        doseValue: "250",
        doseUnit: "mcg",
        site: "Left abdomen",
        deltaMinutes: 12,
      },
      {
        takenAt: d("2026-06-21T07:00:00"),
        tz: null,
        peptide: "TB-500",
        doseValue: "2",
        doseUnit: "mg",
        site: null, // injection site may be null
        deltaMinutes: null,
      },
    ],
    sideEffects: [
      { symptom: "Nausea", severity: "moderate" },
      { symptom: "Nausea", severity: "mild" },
      { symptom: "Nausea", severity: "moderate" },
      { symptom: "Headache", severity: null },
      { symptom: "Fatigue", severity: "severe" },
    ],
    wellness: {
      weight: [
        { date: d("2026-04-01T00:00:00"), value: 92.4, unit: "kg" },
        { date: d("2026-05-01T00:00:00"), value: 90.1, unit: "kg" },
        { date: d("2026-06-01T00:00:00"), value: 88.6, unit: "kg" },
      ],
      avgCalories: 2100,
      avgProteinG: 140.5,
      avgWaterMl: 1800,
      hydrationTargetMl: 2500,
    },
    labs: [
      {
        collectedDate: d("2026-05-15T00:00:00"),
        source: "LabCorp",
        rows: [
          { name: "ALT", value: "32", unit: "U/L", referenceLow: "7", referenceHigh: "56", flag: "normal" },
          { name: "Testosterone", value: "8.2", unit: "nmol/L", referenceLow: "8.6", referenceHigh: "29", flag: "low" },
        ],
      },
    ],
    bodyComp: sampleBodyComp(),
  };
}

/** A fully-empty report — every section degrades to a "no data" line. */
function emptyData(): ReportData {
  return {
    brand: "Peptide Tracker",
    ownerEmail: "owner@example.com",
    generatedAt: new Date("2026-06-23T08:00:00"),
    from: new Date("2026-03-25T00:00:00"),
    to: new Date("2026-06-23T23:59:59"),
    doses: [],
    sideEffects: [],
    wellness: { weight: [], avgCalories: null, avgProteinG: null, avgWaterMl: null, hydrationTargetMl: null },
    labs: [],
    bodyComp: null,
  };
}

describe("buildReportPdf", () => {
  it("produces a non-empty PDF buffer starting with the %PDF magic bytes", async () => {
    const buf = await buildReportPdf(sampleData());
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 4).toString("ascii")).toBe(PDF_MAGIC);
  });

  it("handles the all-empty case without throwing and still emits a valid PDF", async () => {
    const buf = await buildReportPdf(emptyData());
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 4).toString("ascii")).toBe(PDF_MAGIC);
  });
});

describe("body-composition section", () => {
  it("prints the heading, the scan dates, the flag words as the page prints them, and the RMR row", async () => {
    const buf = await buildReportPdf(sampleData());
    const text = await pdfText(buf);
    expect(text).toContain("Body composition (DEXA)");
    expect(text).toContain("resting metabolic rate");
    expect(text).toContain("2026-03-10");
    expect(text).toContain("2026-06-10");
    expect(text).toContain("within noise");
    expect(text).toContain("indeterminate");
    expect(text).toContain("comparable");
    expect(text).toContain("SynthCo Model X");
    expect(text).toContain("1900");
    expect(text).toContain("illness 3, travel 0");
    // Provenance + the standing disclaimer sentence.
    expect(text).toContain("Values as printed by the scanner");
    expect(text).toContain("Differences smaller than the noise band are not changes");
  });

  it("prints the not-comparable line when a pair exists but every delta was hidden", async () => {
    const data = sampleData();
    data.bodyComp = { ...sampleBodyComp(), deltas: [] };
    const text = await pdfText(await buildReportPdf(data));
    expect(text).toContain("not comparable");
    expect(text).not.toContain("within noise");
  });

  it("degrades to the empty line when the section is null", async () => {
    const text = await pdfText(await buildReportPdf(emptyData()));
    expect(text).toContain("Body composition (DEXA)");
    expect(text).toContain("No DEXA or RMR recorded in this range.");
  });
});

describe("formatDoseDateTime", () => {
  it("renders a UTC baseline instant in the logging phone timezone", () => {
    expect(formatDoseDateTime(
      new Date("2026-07-24T05:03:00Z"),
      "America/Santiago",
    )).toBe("2026-07-24 01:03");
  });
});

describe("summariseSideEffects", () => {
  it("aggregates counts and surfaces the most common severity", () => {
    const lines = summariseSideEffects(sampleData().sideEffects);
    // Nausea is most frequent (3), with "moderate" the most common severity (2 vs 1 mild).
    expect(lines[0]).toBe("Nausea ×3 (moderate)");
    expect(lines).toContain("Headache ×1");
    expect(lines).toContain("Fatigue ×1 (severe)");
  });

  it("returns an empty array for no entries", () => {
    expect(summariseSideEffects([])).toEqual([]);
  });
});

describe("buildLabComparison", () => {
  const d = (s: string) => new Date(s);
  const panels: ReportLabPanel[] = [
    { collectedDate: d("2026-03-01"), source: "Old Lab", rows: [
      { name: "ALT", value: "45", unit: "U/L", referenceLow: "7", referenceHigh: "56", flag: "normal" },
      { name: "Vitamin D", value: "45", unit: "nmol/L", referenceLow: "50", referenceHigh: null, flag: "low" },
    ] },
    { collectedDate: d("2026-06-10"), source: "QML", rows: [
      { name: "ALT", value: "62", unit: "U/L", referenceLow: "7", referenceHigh: "56", flag: "high" },
      { name: "TSH", value: ">100", unit: "mIU/L", referenceLow: "0.4", referenceHigh: "4.0", flag: "high" },
    ] },
    { collectedDate: d("2026-05-15"), source: "LabCorp", rows: [
      { name: "ALT", value: "48", unit: "U/L", referenceLow: "7", referenceHigh: "56", flag: "normal" },
      { name: "Ferritin", value: "410", unit: "ug/L", referenceLow: "30", referenceHigh: "400", flag: "high" },
    ] },
    { collectedDate: d("2026-01-01"), source: "Ancient", rows: [
      { name: "Foo", value: "1", unit: null, referenceLow: null, referenceHigh: null, flag: null },
    ] },
  ];

  it("keeps only the 3 most recent panels as date columns, newest first", () => {
    const cmp = buildLabComparison(panels, 3);
    expect(cmp.dates.map((x) => x.toISOString().slice(0, 10))).toEqual(["2026-06-10", "2026-05-15", "2026-03-01"]);
    expect(cmp.sources).toEqual(["QML", "LabCorp", "Old Lab"]);
  });

  it("pivots biomarkers into rows (union, alphabetical) with cells aligned to dates", () => {
    const cmp = buildLabComparison(panels, 3);
    expect(cmp.rows.map((r) => r.name)).toEqual(["ALT", "Ferritin", "TSH", "Vitamin D"]); // "Foo" excluded (4th panel)
    const alt = cmp.rows.find((r) => r.name === "ALT")!;
    expect(alt.cells).toEqual(["62 (H)", "48", "45"]); // normal → no flag marker
    expect(alt.reference).toMatch(/^7.56$/); // en-dash range from the most-recent panel
    // markers present only in some panels show "—" elsewhere
    expect(cmp.rows.find((r) => r.name === "Ferritin")!.cells).toEqual(["—", "410 (H)", "—"]);
    expect(cmp.rows.find((r) => r.name === "TSH")!.cells).toEqual([">100 (H)", "—", "—"]);
    expect(cmp.rows.find((r) => r.name === "Vitamin D")!.cells).toEqual(["—", "—", "45 (L)"]);
  });

  it("returns empty rows when there are no panels", () => {
    expect(buildLabComparison([], 3).rows).toEqual([]);
  });
});

describe("safe (WinAnsi sanitiser)", () => {
  it("maps the Helvetica-incompatible glyphs to ASCII", () => {
    expect(safe("2026-03-25 → 2026-06-23")).toBe("2026-03-25 to 2026-06-23");
    expect(safe("≤ 4")).toBe("<= 4");
    expect(safe("≥ 49")).toBe(">= 49");
    expect(safe("+12m / −5m")).toBe("+12m / -5m"); // U+2212 minus sign
    expect(safe("Δ sched")).toBe("delta sched");
  });
  it("leaves ASCII + Latin-1 (accents) untouched", () => {
    expect(safe("José 92.4 kg µg")).toBe("José 92.4 kg µg");
  });
  it("replaces out-of-range codepoints (emoji/CJK in user data) with '?'", () => {
    expect(safe("Nausea 🤢")).toBe("Nausea ?");
    expect(safe("注射")).toBe("??");
  });
});
