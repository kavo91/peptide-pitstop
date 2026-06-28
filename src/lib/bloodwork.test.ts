import { describe, it, expect } from "vitest";
import { parseNumeric, classifyFlag, trendSeries } from "./bloodwork";

describe("parseNumeric", () => {
  it("parses plain numbers", () => {
    expect(parseNumeric("5.2")).toBe(5.2);
  });
  it("parses censored '<3' as 3", () => {
    expect(parseNumeric("<3")).toBe(3);
  });
  it("parses censored '>90' as 90", () => {
    expect(parseNumeric(">90")).toBe(90);
  });
  it("strips thousands separators", () => {
    expect(parseNumeric("1,200")).toBe(1200);
  });
  it("returns null for non-numeric values", () => {
    expect(parseNumeric("Positive")).toBeNull();
    expect(parseNumeric("")).toBeNull();
    expect(parseNumeric(null)).toBeNull();
  });
});

describe("classifyFlag", () => {
  it("flags below reference low as 'low' (censored '<3')", () => {
    // "<3" → 3, reference 3.5–10 → below low
    expect(classifyFlag("<3", 3.5, 10)).toBe("low");
  });
  it("flags above reference high as 'high' (censored '>90')", () => {
    // ">90" → 90, reference high 60 → above high
    expect(classifyFlag(">90", null, 60)).toBe("high");
  });
  it("returns 'normal' when inside both reference and optimal", () => {
    expect(classifyFlag("5.0", 3.5, 10, 4.0, 6.0)).toBe("normal");
  });
  it("returns 'borderline' when inside reference but below optimal low", () => {
    // HDL 1.1: within reference (≥1.0) but below optimal 1.3
    expect(classifyFlag("1.1", 1.0, null, 1.3, null)).toBe("borderline");
  });
  it("returns 'borderline' when inside reference but above optimal high", () => {
    // HbA1c 5.6: within reference (<6.0) but above optimal 5.4
    expect(classifyFlag("5.6", null, 6.0, 4.0, 5.4)).toBe("borderline");
  });
  it("returns 'normal' for non-numeric values (cannot compare)", () => {
    expect(classifyFlag("Positive", 0, 1)).toBe("normal");
  });
  it("reference breach wins over optimal breach", () => {
    // 2.0 is below both reference low (3.0) and optimal low (4.0) → 'low' not 'borderline'
    expect(classifyFlag("2.0", 3.0, 10, 4.0, 8.0)).toBe("low");
  });
});

describe("trendSeries", () => {
  it("groups per biomarker, parses censored values, sorts by date, skips non-numeric", () => {
    const series = trendSeries([
      { biomarkerName: "HDL", collectedDate: new Date("2026-03-01"), value: "1.2", flag: "borderline" },
      { biomarkerName: "HDL", collectedDate: new Date("2026-01-01"), value: "<1.0", flag: "low" },
      { biomarkerName: "CRP (hs)", collectedDate: new Date("2026-02-01"), value: "Positive" }, // skipped
      { biomarkerName: "CRP (hs)", collectedDate: new Date("2026-02-01"), value: "0.4", flag: "normal" },
    ]);

    // CRP (hs) sorts before HDL by name; the non-numeric CRP value is skipped.
    expect(series.map((s) => s.biomarkerName)).toEqual(["CRP (hs)", "HDL"]);

    const hdl = series.find((s) => s.biomarkerName === "HDL")!;
    expect(hdl.points.map((p) => p.value)).toEqual([1.0, 1.2]); // oldest first, "<1.0" → 1.0
    expect(hdl.points[0].flag).toBe("low");

    const crp = series.find((s) => s.biomarkerName === "CRP (hs)")!;
    expect(crp.points).toHaveLength(1);
    expect(crp.points[0].value).toBe(0.4);
  });

  it("drops biomarkers with no numeric points", () => {
    const series = trendSeries([
      { biomarkerName: "Blood Group", collectedDate: new Date("2026-01-01"), value: "O+" },
    ]);
    expect(series).toEqual([]);
  });
});
