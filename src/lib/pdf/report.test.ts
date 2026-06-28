import { describe, it, expect } from "vitest";
import { buildReportPdf, summariseSideEffects, safe, buildLabComparison, type ReportData, type ReportLabPanel } from "./report";

const PDF_MAGIC = "%PDF";

/** A representative, fully-populated report (no DB needed — plain literal). */
function sampleData(): ReportData {
  const d = (s: string) => new Date(s);
  return {
    brand: "Peptide Pitstop",
    ownerEmail: "owner@example.com",
    generatedAt: d("2026-06-23T08:00:00"),
    from: d("2026-03-25T00:00:00"),
    to: d("2026-06-23T23:59:59"),
    doses: [
      {
        takenAt: d("2026-06-20T07:30:00"),
        peptide: "BPC-157",
        doseValue: "250",
        doseUnit: "mcg",
        site: "Left abdomen",
        deltaMinutes: 12,
      },
      {
        takenAt: d("2026-06-21T07:00:00"),
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
  };
}

/** A fully-empty report — every section degrades to a "no data" line. */
function emptyData(): ReportData {
  return {
    brand: "Peptide Pitstop",
    ownerEmail: "owner@example.com",
    generatedAt: new Date("2026-06-23T08:00:00"),
    from: new Date("2026-03-25T00:00:00"),
    to: new Date("2026-06-23T23:59:59"),
    doses: [],
    sideEffects: [],
    wellness: { weight: [], avgCalories: null, avgProteinG: null, avgWaterMl: null, hydrationTargetMl: null },
    labs: [],
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
