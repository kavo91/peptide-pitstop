import { describe, it, expect } from "vitest";
import {
  parseNumeric,
  classifyFlag,
  trendSeries,
  panelSummary,
  displayGroupName,
  pickPerDisplayGroup,
  assayNote,
  CRP_GROUP,
  HS_CRP_NOTE,
} from "./bloodwork";

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
      { biomarkerName: "HDL", collectedDate: new Date("2026-03-01"), value: "1.2", flag: "borderline", panelId: "mar" },
      { biomarkerName: "HDL", collectedDate: new Date("2026-01-01"), value: "<1.0", flag: "low", panelId: "jan" },
      { biomarkerName: "CRP (hs)", collectedDate: new Date("2026-02-01"), value: "Positive", panelId: "feb" }, // skipped
      { biomarkerName: "CRP (hs)", collectedDate: new Date("2026-02-01"), value: "0.4", flag: "normal", panelId: "feb" },
    ]);

    // hs-CRP trends under the shared "CRP" display row, which
    // sorts before HDL by name; the non-numeric CRP value is skipped.
    expect(series.map((s) => s.biomarkerName)).toEqual(["CRP", "HDL"]);

    const hdl = series.find((s) => s.biomarkerName === "HDL")!;
    expect(hdl.points.map((p) => p.value)).toEqual([1.0, 1.2]); // oldest first, "<1.0" → 1.0
    expect(hdl.points[0].flag).toBe("low");

    const crp = series.find((s) => s.biomarkerName === "CRP")!;
    expect(crp.points).toHaveLength(1);
    expect(crp.points[0].value).toBe(0.4);
  });

  it("drops biomarkers with no numeric points", () => {
    const series = trendSeries([
      { biomarkerName: "Blood Group", collectedDate: new Date("2026-01-01"), value: "O+", panelId: "jan" },
    ]);
    expect(series).toEqual([]);
  });
});

describe("CRP display group", () => {
  it("shows standard CRP and hs-CRP under one CRP row; every other name is its own row", () => {
    expect(CRP_GROUP).toBe("CRP");
    expect(displayGroupName("CRP")).toBe("CRP");
    expect(displayGroupName("CRP (hs)")).toBe("CRP");
    expect(displayGroupName("Ferritin")).toBe("Ferritin");
    expect(displayGroupName("hsCRP")).toBe("hsCRP"); // fold-table names are merged in the DB, not at display
  });

  it("picks one result per display group, preferring hs-CRP over standard CRP in the same panel", () => {
    const panel = [
      { biomarkerName: "CRP", value: "<5" },
      { biomarkerName: "ALT", value: "30" },
      { biomarkerName: "CRP (hs)", value: "0.6" },
    ];
    const picked = pickPerDisplayGroup(panel, (r) => r.biomarkerName);
    expect([...picked.keys()]).toEqual(["CRP", "ALT"]);
    expect(picked.get("CRP")!.item.value).toBe("0.6");
    expect(picked.get("CRP")!.alternates.map((r) => r.value)).toEqual(["<5"]);
    expect(picked.get("ALT")!.alternates).toEqual([]);
  });

  it("keeps a lone standard CRP result", () => {
    const picked = pickPerDisplayGroup([{ biomarkerName: "CRP", value: "3" }], (r) => r.biomarkerName);
    expect(picked.get("CRP")!.item.value).toBe("3");
  });

  it("notes the hs assay on hover, and lists the standard result when the panel has both", () => {
    expect(HS_CRP_NOTE).toBe("hs-CRP — high-sensitivity assay");
    expect(assayNote("CRP (hs)", [])).toBe(HS_CRP_NOTE);
    expect(assayNote("CRP (hs)", [{ biomarkerName: "CRP", value: "<5", unit: "mg/L" }])).toBe(
      "hs-CRP — high-sensitivity assay · standard CRP: <5 mg/L",
    );
    expect(assayNote("CRP", [])).toBeNull();
    expect(assayNote("ALT", [])).toBeNull();
  });

  it("trends both assays as one CRP series, one point per panel, hs preferred and noted", () => {
    const series = trendSeries([
      { biomarkerName: "CRP", collectedDate: new Date("2027-01-11"), value: "<5", panelId: "p1", unit: "mg/L" },
      { biomarkerName: "CRP (hs)", collectedDate: new Date("2027-01-11"), value: "0.7", panelId: "p1" },
      { biomarkerName: "CRP (hs)", collectedDate: new Date("2027-02-08"), value: "0.3", panelId: "p2" },
      { biomarkerName: "CRP", collectedDate: new Date("2027-03-08"), value: "2.5", panelId: "p3" },
    ]);
    expect(series.map((s) => s.biomarkerName)).toEqual(["CRP"]);
    const pts = series[0].points;
    expect(pts.map((p) => p.value)).toEqual([0.7, 0.3, 2.5]);
    expect(pts[0].note).toBe("hs-CRP — high-sensitivity assay · standard CRP: <5 mg/L");
    expect(pts[1].note).toBe(HS_CRP_NOTE);
    expect(pts[2].note).toBeNull();
  });

  it("panel deltas compare the CRP row across assays and count it once", () => {
    const latest = [
      { biomarkerName: "CRP (hs)", value: "0.5", referenceLow: null, referenceHigh: 1, flag: "normal" },
      { biomarkerName: "CRP", value: "<5", referenceLow: null, referenceHigh: 5, flag: "normal" },
    ];
    const prior = [{ biomarkerName: "CRP", value: "3", referenceLow: null, referenceHigh: 1, flag: "high" }];
    // One CRP row (not two), in range, and improved from 3 (2 above 1) to 0.5 (inside).
    expect(panelSummary(latest, prior)).toEqual({ inRange: 1, total: 1, improving: 1 });
  });

  it("panel deltas prefer hs-CRP on the prior side too", () => {
    const latest = [{ biomarkerName: "CRP (hs)", value: "0.8", referenceLow: null, referenceHigh: 1, flag: "normal" }];
    const prior = [
      { biomarkerName: "CRP", value: "0.5", referenceLow: null, referenceHigh: 1, flag: "normal" },
      { biomarkerName: "CRP (hs)", value: "1.6", referenceLow: null, referenceHigh: 1, flag: "high" },
    ];
    // Against the prior hs 1.6 (0.6 above 1) the latest 0.8 improved; against the standard 0.5 it would not.
    expect(panelSummary(latest, prior).improving).toBe(1);
  });

  it("deltas compare against the prior panel's numeric CRP when its hs result is non-numeric", () => {
    const latest = [{ biomarkerName: "CRP (hs)", value: "0.5", referenceLow: null, referenceHigh: 1, flag: "normal" }];
    const prior = [
      { biomarkerName: "CRP (hs)", value: "Not done", referenceLow: null, referenceHigh: 1, flag: null },
      { biomarkerName: "CRP", value: "3", referenceLow: null, referenceHigh: 1, flag: "high" },
    ];
    // Prior falls back to standard 3 (2 above 1); latest 0.5 is inside → improving.
    expect(panelSummary(latest, prior).improving).toBe(1);
  });

  it("a non-numeric hs result falls back to the numeric standard one in trends and deltas alike", () => {
    const latest = [
      { biomarkerName: "CRP (hs)", value: "Not done", referenceLow: null, referenceHigh: 1, flag: null },
      { biomarkerName: "CRP", value: "3", referenceLow: null, referenceHigh: 5, flag: "normal" },
    ];
    expect(panelSummary(latest, null)).toEqual({ inRange: 1, total: 1, improving: 0 });
    const series = trendSeries(
      latest.map((r) => ({ ...r, collectedDate: new Date("2027-03-08"), panelId: "p3" })),
    );
    expect(series[0].points.map((p) => p.value)).toEqual([3]);
  });
});
