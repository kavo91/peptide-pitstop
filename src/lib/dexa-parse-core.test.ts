import { describe, it, expect } from "vitest";
import PDFDocument from "pdfkit";
import { parseHologicReport, normaliseReportText, isoFromPrintedDate } from "./dexa-parse-core";
import { extractPdfText, renderPageText } from "./pdf-text";

/**
 * SYNTHETIC Hologic APEX report text — the same invented subject as the phase-1
 * fixture (178 cm, 82.0 kg, fat 16 400 g, lean 61 800 g, BMC 2 800 g). Serial
 * TEST1, facility "Example Clinic", reference "NHANES-Example". Regions sum
 * exactly to subtotal + head = total; indices reconcile with the printed values.
 */
const TEMPLATE = `Example Clinic
Patient: SYNTHETIC SUBJECT
Sex: Male   Height: 178.0 cm   Weight: 82.0 kg   Age: 40
Scan Date: 10 January 2026
Scan Type: a Whole Body
Model: Horizon A (S/N TEST1)
Analysis: APEX Version 13.6
Age-matched Z-score. T-score vs. Example Male. Source: NHANES-Example
DXA Results Summary
Region BMC (g) Fat Mass (g) Lean Mass (g) Lean + BMC (g) Total Mass (g) % Fat
L Arm 200.00 1000.0 3500.0 3700.0 4700.0 21.3
R Arm 210.00 1050.0 3700.0 3910.0 4960.0 21.2
Trunk 800.00 7300.0 30000.0 30800.0 38100.0 19.2
L Leg 500.00 2900.0 10600.0 11100.0 14000.0 20.7
R Leg 510.00 2950.0 10700.0 11210.0 14160.0 20.8
Subtotal 2220.00 15200.0 58500.0 60720.0 75920.0 20.0
Head 580.00 1200.0 3300.0 3880.0 5080.0 23.6
Total 2800.00 16400.0 61800.0 64600.0 81000.0 20.2
Body Composition Results
Region Fat Mass (g) Lean + BMC (g) Total Mass (g) % Fat %Fat Percentile YN %Fat Percentile AM
L Arm 1000 3700 4700 21.3 55 45
R Arm 1050 3910 4960 21.2 54 44
Trunk 7300 30800 38100 19.2 48 40
L Leg 2900 11100 14000 20.7 52 42
R Leg 2950 11210 14160 20.8 53 43
Subtotal 15200 60720 75920 20.0 50 40
Total 16400 64600 81000 20.2 50 40
Android (A) 1200 4800 6000 20.0
Gynoid (G) 2700 10300 13000 20.8
Adipose Indices Measure Result Percentile YN Percentile AM
Total Body % Fat 20.2 50 40
Fat Mass/Height² (kg/m²) 5.18 45 38
Android/Gynoid Ratio 0.96
Est. VAT Mass (g) 500
Est. VAT Volume (cm³) 540
Est. VAT Area (cm²) 104.0
Lean Indices
Lean/Height² (kg/m²) 19.5 60 55
Appen. Lean/Height² (kg/m²) 8.99 62 58
BMD Results
Region Area (cm²) BMC (g) BMD (g/cm²) T-score Z-score
Head 290.00 580.00 2.000
L Arm 250.00 200.00 0.800
R Arm 262.50 210.00 0.800
L Ribs 100.00 80.00 0.800
R Ribs 100.00 80.00 0.800
T Spine 120.00 120.00 1.000
L Spine 60.00 60.00 1.000
Pelvis 250.00 300.00 1.200
L Leg 500.00 500.00 1.000
R Leg 510.00 510.00 1.000
Subtotal 2043.33 2220.00 1.087
Total 2333.33 2800.00 1.200 0.1 0.1
Total BMD CV 1.0%
`;

const region = (r: ReturnType<typeof parseHologicReport>["scan"], name: string) => r!.regions.find((x) => x.region === name)!;

describe("parseHologicReport — synthetic template", () => {
  const res = parseHologicReport(TEMPLATE);
  it("is ok with every anchor found and every check passing", () => {
    expect(res.ok).toBe(true);
    expect(res.missing).toEqual([]);
    expect(res.confidence).toBe(1);
    expect(res.checks.length).toBeGreaterThan(5);
    for (const c of res.checks) expect(c.pass, `${c.name}: ${c.detail}`).toBe(true);
  });
  it("reads the header", () => {
    expect(res.scan!.header).toEqual({
      sex: "male", heightCm: 178, clinicWeightKg: 82, ageYears: 40, scanDate: "2026-01-10", scanDateRaw: "10 January 2026",
      softwareVersion: "13.6", deviceModel: "Horizon A", deviceSerial: "TEST1", scanMode: "Whole Body", referencePopulation: "NHANES-Example Example Male",
    });
  });
  it("reads totals with percentiles from the Total row", () => {
    expect(res.scan!.totals).toEqual({ totalFatG: 16400, totalLeanG: 61800, totalBmcG: 2800, totalMassG: 81000, pctFat: 20.2, pctFatYn: 50, pctFatAm: 40 });
  });
  it("reads all eight regions as printed (strings), with percentiles and BMD where printed", () => {
    const s = res.scan!;
    expect(s.regions.map((r) => r.region)).toEqual(["l_arm", "r_arm", "trunk", "l_leg", "r_leg", "head", "android", "gynoid"]);
    expect(region(s, "l_arm")).toEqual({ region: "l_arm", bmcG: "200", fatG: "1000", leanG: "3500", totalG: "4700", pctFat: "21.3", pctFatYn: "55", pctFatAm: "45", bmdGcm2: "0.8" });
    expect(region(s, "trunk")).toEqual({ region: "trunk", bmcG: "800", fatG: "7300", leanG: "30000", totalG: "38100", pctFat: "19.2", pctFatYn: "48", pctFatAm: "40", bmdGcm2: undefined });
    expect(region(s, "head")).toEqual({ region: "head", bmcG: "580", fatG: "1200", leanG: "3300", totalG: "5080", pctFat: "23.6", pctFatYn: undefined, pctFatAm: undefined, bmdGcm2: "2" });
    expect(region(s, "r_leg").bmdGcm2).toBe("1");
    expect(region(s, "android")).toEqual({ region: "android", fatG: "1200", leanG: "4800", totalG: "6000", pctFat: "20" });
    expect(region(s, "gynoid")).toEqual({ region: "gynoid", fatG: "2700", leanG: "10300", totalG: "13000", pctFat: "20.8" });
  });
  it("reads VAT, bone and the printed indices", () => {
    const s = res.scan!;
    expect(s.vat).toEqual({ massG: 500, volumeCm3: 540, areaCm2: 104 });
    expect(s.bone).toEqual({ totalBmdGcm2: 1.2, tScore: 0.1, zScore: 0.1, cvPct: 1 });
    expect(s.indices).toEqual({ fmi: 5.18, fmiYn: 45, fmiAm: 38, lmi: 19.5, lmiYn: 60, lmiAm: 55, almi: 8.99, almiYn: 62, almiAm: 58, androidGynoid: 0.96 });
  });
  it("names the checks the review panel shows", () => {
    const names = res.checks.map((c) => c.name);
    for (const n of ["fat_sum", "lean_sum", "bmc_sum", "mass_sum", "pct_fat", "subtotal_head_fat", "subtotal_head_mass", "regions_subtotal_lean", "fmi_printed", "lmi_printed", "almi_printed", "vat_density"]) expect(names).toContain(n);
  });
});

describe("parseHologicReport — failure modes", () => {
  it("a mis-keyed row fails a checksum: ok=false, scan still returned, confidence < 1", () => {
    const bad = TEMPLATE.replace("R Leg 510.00 2950.0 10700.0 11210.0 14160.0 20.8", "R Leg 510.00 2950.0 10800.0 11210.0 14160.0 20.8");
    const res = parseHologicReport(bad);
    expect(res.ok).toBe(false);
    expect(res.scan).not.toBeNull();
    expect(res.missing).toEqual([]);
    const failed = res.checks.filter((c) => !c.pass).map((c) => c.name).sort();
    expect(failed).toEqual(["lean_sum", "regions_subtotal_lean"]);
    expect(res.confidence).toBeLessThan(1);
    expect(res.confidence).toBeGreaterThan(0.5);
  });
  it("a truncated text is not ok and names the missing anchors", () => {
    const res = parseHologicReport(TEMPLATE.slice(0, TEMPLATE.indexOf("DXA Results Summary")));
    expect(res.ok).toBe(false);
    expect(res.scan).toBeNull();
    expect(res.checks).toEqual([]);
    for (const m of ["summary:L Arm", "summary:Head", "summary:Total", "percentile:Total", "indices:Est. VAT Mass", "bmd:Total"]) expect(res.missing).toContain(m);
    expect(res.missing).not.toContain("header:Sex");
    expect(res.confidence).toBeLessThan(0.5);
  });
  it("a printed scan date that cannot be interpreted is a failed check: not ok, not 100 %, scanDate null", () => {
    for (const bad of ["10 Enero 2026", "32 January 2026"]) {
      const res = parseHologicReport(TEMPLATE.replace("10 January 2026", bad));
      expect(res.ok).toBe(false);
      expect(res.scan).not.toBeNull();
      expect(res.scan!.header.scanDate).toBeNull();
      expect(res.scan!.header.scanDateRaw).toBe(bad);
      expect(res.missing).not.toContain("header:Scan Date");
      const check = res.checks.find((c) => c.name === "scan_date");
      expect(check?.pass).toBe(false);
      expect(check?.detail).toContain(bad);
      expect(res.confidence).toBeLessThan(1);
    }
  });
  it("a checksum failure fails the pct_fat check when the printed %fat disagrees with fat/total", () => {
    const res = parseHologicReport(TEMPLATE.replace("81000.0 20.2", "81000.0 25.2"));
    expect(res.ok).toBe(false);
    expect(res.checks.find((c) => c.name === "pct_fat")!.pass).toBe(false);
  });
  it("optional sections missing → still ok, listed in missing[]", () => {
    const res = parseHologicReport(TEMPLATE.slice(0, TEMPLATE.indexOf("BMD Results")));
    expect(res.ok).toBe(true);
    expect(res.missing).toEqual(["bmd:L Arm", "bmd:R Arm", "bmd:L Leg", "bmd:R Leg", "bmd:Head", "bmd:Total", "bmd:Total BMD CV"]);
    expect(res.scan!.bone).toEqual({ totalBmdGcm2: null, tScore: null, zScore: null, cvPct: null });
    expect(region(res.scan, "l_arm").bmdGcm2).toBeUndefined();
    expect(res.confidence).toBeLessThan(1);
  });
  it("android/gynoid rows missing → six regions, still ok", () => {
    const res = parseHologicReport(TEMPLATE.replace(/Android \(A\).*\n/, "").replace(/Gynoid \(G\).*\n/, ""));
    expect(res.ok).toBe(true);
    expect(res.scan!.regions).toHaveLength(6);
    expect(res.missing).toEqual(["percentile:Android", "percentile:Gynoid"]);
  });
  it("empty text", () => {
    const res = parseHologicReport("");
    expect(res.ok).toBe(false); expect(res.scan).toBeNull(); expect(res.confidence).toBe(0);
    expect(res.missing.length).toBeGreaterThan(30);
  });
});

describe("parseHologicReport — text normalisation", () => {
  it("normalises ², ³ and non-breaking spaces; strips thousands separators", () => {
    expect(normaliseReportText("Fat Mass/Height² (kg/m²) 5.18 1,234.5 12,345,678")).toBe("Fat Mass/Height2 (kg/m2) 5.18 1234.5 12345678");
  });
  it("ASCII variant (2/3 already plain) parses identically", () => {
    const ascii = TEMPLATE.replace(/²/g, "2").replace(/³/g, "3");
    expect(parseHologicReport(ascii)).toEqual(parseHologicReport(TEMPLATE));
  });
  it("non-breaking spaces everywhere still parse", () => {
    const nb = TEMPLATE.replace(/ /g, " ");
    expect(parseHologicReport(nb)).toEqual(parseHologicReport(TEMPLATE));
  });
  it("extra whitespace and newlines between fields still parse", () => {
    const spread = TEMPLATE.replace(/(\d)\s+(?=[-\d])/g, "$1\n\t   ").replace(/: /g, ":\n ").replace(/L Arm/g, "L  Arm").replace(/Scan Date/g, "Scan\nDate");
    expect(parseHologicReport(spread)).toEqual(parseHologicReport(TEMPLATE));
  });
  it("printed dates", () => {
    expect(isoFromPrintedDate("2 September 2026")).toBe("2026-09-02");
    expect(isoFromPrintedDate("02 Sep 2026")).toBe("2026-09-02");
    expect(isoFromPrintedDate("10 Brumaire 2026")).toBeNull();
  });
});

describe("pdf-text row layout", () => {
  it("separates same-row cells by a space when the gap is wide, keeps adjacent glyph runs joined", () => {
    const it10 = (str: string, x: number, y: number, width: number) => ({ str, transform: [10, 0, 0, 10, x, y], width, height: 10 });
    const text = renderPageText([
      it10("L Arm", 40, 700, 27), it10("200.00", 120, 700, 30), it10("1000.0", 180, 700, 30),
      it10("Sc", 40, 720, 10), it10("an", 50.2, 720, 9), // kerned run of one word, gap 0.2
      it10("Header", 40, 740, 30),
    ]);
    expect(text).toBe("Header\nScan\nL Arm 200.00 1000.0");
  });
});

/** Build a PDF with pdfkit: table rows are laid out as SEPARATE positioned cells (like the scanner's report). */
async function buildSyntheticPdf(): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve) => doc.on("end", () => resolve()));
  doc.font("Helvetica").fontSize(9);
  let y = 40;
  const cellRow = /^(L Arm|R Arm|Trunk|L Leg|R Leg|Subtotal|Head|Total|Android \(A\)|Gynoid \(G\)|L Ribs|R Ribs|T Spine|L Spine|Pelvis) ((?:-?[\d.]+ ?)+)$/;
  for (const line of TEMPLATE.split("\n")) {
    if (!line) continue;
    if (line === "Body Composition Results") { doc.addPage(); y = 40; }
    const m = cellRow.exec(line);
    if (m) {
      const cells = [m[1], ...m[2].trim().split(" ")];
      cells.forEach((c, i) => doc.text(c, 40 + i * 70, y, { lineBreak: false }));
    } else doc.text(line, 40, y, { lineBreak: false });
    y += 13;
  }
  doc.end();
  await done;
  return Buffer.concat(chunks);
}

describe("end to end: pdfkit → extractPdfText → parseHologicReport", () => {
  it("parses a synthetic PDF with positioned table cells across two pages", async () => {
    const buf = await buildSyntheticPdf();
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    const text = await extractPdfText(buf);
    expect(text).toContain("L Arm 200.00 1000.0 3500.0 3700.0 4700.0 21.3");
    const res = parseHologicReport(text);
    expect(res.missing).toEqual([]);
    expect(res.ok).toBe(true);
    expect(res.scan).toEqual(parseHologicReport(TEMPLATE).scan);
  }, 30_000);
});
