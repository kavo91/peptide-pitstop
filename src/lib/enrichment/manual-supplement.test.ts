import { describe, it, expect } from "vitest";
import type { EnrichmentEntry } from "../peptide-enrichment";
import { applySupplement, MANUAL_SUPPLEMENT } from "./manual-supplement";

/** Minimal EnrichmentEntry factory — mirrors the one in suggested-protocol.test.ts. */
function entry(over: Partial<EnrichmentEntry>): EnrichmentEntry {
  return {
    name: "Test",
    benefits: [],
    sideEffects: [],
    dosingReference: null,
    reconstitution: [],
    reconstitutionRatio: null,
    mechanism: null,
    templates: [],
    references: [],
    source: "peptidedosages.com",
    sourceUrl: "https://example.com",
    attribution: "",
    curatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("MANUAL_SUPPLEMENT", () => {
  it("curates BPC-157 with a full benefits + cautions list", () => {
    const s = MANUAL_SUPPLEMENT["BPC-157"];
    expect(s).toBeDefined();
    expect(s.benefits!.length).toBeGreaterThanOrEqual(6);
    expect(s.benefits!.length).toBeLessThanOrEqual(8);
    expect(s.sideEffects!.length).toBeGreaterThanOrEqual(4);
    expect(s.sideEffects!.length).toBeLessThanOrEqual(6);
  });

  it("curates TB-500 with a full benefits + cautions list", () => {
    const s = MANUAL_SUPPLEMENT["TB-500"];
    expect(s).toBeDefined();
    expect(s.benefits!.length).toBeGreaterThanOrEqual(6);
    expect(s.benefits!.length).toBeLessThanOrEqual(8);
    expect(s.sideEffects!.length).toBeGreaterThanOrEqual(4);
    expect(s.sideEffects!.length).toBeLessThanOrEqual(6);
  });
});

describe("applySupplement", () => {
  it("replaces benefits + sideEffects for a supplemented peptide (BPC-157) and keeps every other field verbatim", () => {
    const original = entry({
      name: "BPC-157",
      aliases: "Body Protection Compound 157",
      benefits: ["thin scraped benefit 1", "thin scraped benefit 2"],
      sideEffects: ["thin scraped caution 1"],
      dosingReference: "BPC-157 is dosed at 200 mcg–600 mcg daily.",
      mechanism: "Synthetic peptide mechanism summary.",
      reconstitution: ["step 1"],
      reconstitutionRatio: "3 mL = ~1.67 mg/mL",
      templates: [
        {
          name: "Standard",
          doseBasis: "per_injection",
          targetDose: 400,
          unit: "mcg",
          frequency: "Daily subcutaneous",
        },
      ],
      references: [{ label: "Some study", url: "https://example.com/study" }],
    });

    const merged = applySupplement(original);

    // benefits/sideEffects come from the curated supplement (the "full" version)
    expect(merged.benefits).toEqual(MANUAL_SUPPLEMENT["BPC-157"].benefits);
    expect(merged.sideEffects).toEqual(MANUAL_SUPPLEMENT["BPC-157"].sideEffects);
    expect(merged.benefits).not.toEqual(original.benefits);

    // every other scraped field is preserved verbatim
    expect(merged.dosingReference).toBe(original.dosingReference);
    expect(merged.mechanism).toBe(original.mechanism);
    expect(merged.templates).toBe(original.templates);
    expect(merged.references).toBe(original.references);
    expect(merged.reconstitution).toBe(original.reconstitution);
    expect(merged.reconstitutionRatio).toBe(original.reconstitutionRatio);
    expect(merged.source).toBe(original.source);
    expect(merged.attribution).toBe(original.attribution);
    expect(merged.aliases).toBe(original.aliases);

    // returns a NEW object, not the same reference
    expect(merged).not.toBe(original);
  });

  it("replaces benefits + sideEffects for TB-500", () => {
    const original = entry({ name: "TB-500", benefits: ["thin"], sideEffects: ["thin"] });
    const merged = applySupplement(original);
    expect(merged.benefits).toEqual(MANUAL_SUPPLEMENT["TB-500"].benefits);
    expect(merged.sideEffects).toEqual(MANUAL_SUPPLEMENT["TB-500"].sideEffects);
  });

  it("matches the supplement key case-insensitively", () => {
    const original = entry({ name: "bpc-157", benefits: ["thin"], sideEffects: ["thin"] });
    const merged = applySupplement(original);
    expect(merged.benefits).toEqual(MANUAL_SUPPLEMENT["BPC-157"].benefits);
    expect(merged.sideEffects).toEqual(MANUAL_SUPPLEMENT["BPC-157"].sideEffects);
  });

  it("returns an un-supplemented entry unchanged (same reference)", () => {
    const original = entry({
      name: "Semaglutide",
      benefits: ["scraped benefit"],
      sideEffects: ["scraped caution"],
    });
    const merged = applySupplement(original);
    expect(merged).toBe(original);
  });
});
