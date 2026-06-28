import { describe, it, expect } from "vitest";
import type { EnrichmentEntry, EnrichmentTemplate } from "../peptide-enrichment";
import {
  parseDosingReference,
  synthesizedTemplate,
  effectiveTemplates,
} from "./suggested-protocol";

/** Minimal EnrichmentEntry factory — only the fields these functions read matter. */
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

describe("parseDosingReference", () => {
  it("parses a 'N mg–M mg D days/week' range (GHK-Cu) using the LOW end's value/unit", () => {
    const r = parseDosingReference(
      "GHK-Cu is dosed at 1 mg–2 mg 5 days/week by subcutaneous injection in educational protocols.",
    );
    expect(r).not.toBeNull();
    expect(r!.doseLow).toBe(1);
    expect(r!.doseHigh).toBe(2);
    expect(r!.unit).toBe("mg");
    expect(r!.frequency).toContain("5 days/week");
  });

  it("parses a mixed-unit range '250 mcg–2.4 mg weekly' using the LOW end's value/unit (mcg)", () => {
    const r = parseDosingReference(
      "Semaglutide is dosed at 250 mcg–2.4 mg weekly via subcutaneous injection in educational protocols.",
    );
    expect(r).not.toBeNull();
    expect(r!.doseLow).toBe(250);
    expect(r!.unit).toBe("mcg");
    expect(r!.frequency).toBe("weekly");
  });

  it("parses a single dose with IU unit '500 IU weekly'", () => {
    const r = parseDosingReference(
      "HCG is dosed at 500 IU weekly via subcutaneous injection in educational protocols.",
    );
    expect(r).not.toBeNull();
    expect(r!.doseLow).toBe(500);
    expect(r!.doseHigh).toBeNull();
    expect(r!.unit).toBe("iu");
    expect(r!.frequency).toBe("weekly");
  });

  it("parses a mcg–mcg daily range '200 mcg–900 mcg daily' (HGH)", () => {
    const r = parseDosingReference(
      "HGH 191AA is dosed at 200 mcg–900 mcg daily by subcutaneous injection in educational protocols.",
    );
    expect(r).not.toBeNull();
    expect(r!.doseLow).toBe(200);
    expect(r!.doseHigh).toBe(900);
    expect(r!.unit).toBe("mcg");
    expect(r!.frequency).toBe("daily");
  });

  it("parses a single dose '2 mg weekly' (CJC-1295 DAC)", () => {
    const r = parseDosingReference(
      "CJC-1295 DAC is dosed at 2 mg weekly via subcutaneous injection in educational protocols.",
    );
    expect(r).not.toBeNull();
    expect(r!.doseLow).toBe(2);
    expect(r!.doseHigh).toBeNull();
    expect(r!.unit).toBe("mg");
    expect(r!.frequency).toBe("weekly");
  });

  it("parses a single dose '5 mg daily' (Epitalon)", () => {
    const r = parseDosingReference(
      "Epitalon is dosed at 5 mg daily via subcutaneous injection in educational protocols.",
    );
    expect(r).not.toBeNull();
    expect(r!.doseLow).toBe(5);
    expect(r!.unit).toBe("mg");
    expect(r!.frequency).toBe("daily");
  });

  it("parses a hyphen (not en-dash) range '1 mg-2 mg daily' (Tesamorelin style)", () => {
    const r = parseDosingReference(
      "Tesamorelin is dosed at 1 mg-2 mg daily by subcutaneous injection in educational protocols.",
    );
    expect(r).not.toBeNull();
    expect(r!.doseLow).toBe(1);
    expect(r!.doseHigh).toBe(2);
    expect(r!.unit).toBe("mg");
    expect(r!.frequency).toBe("daily");
  });

  it("handles a decimal low end '0.25 mg weekly'", () => {
    const r = parseDosingReference("Foo is dosed at 0.25 mg weekly via subcutaneous injection.");
    expect(r).not.toBeNull();
    expect(r!.doseLow).toBe(0.25);
    expect(r!.unit).toBe("mg");
    expect(r!.frequency).toBe("weekly");
  });

  it("strips the frequency at 'by/via/subcutaneous'", () => {
    const r = parseDosingReference("X is dosed at 250 mcg–1 mg daily via subcutaneous injection.");
    expect(r!.frequency).toBe("daily");
  });

  it("returns null for null input", () => {
    expect(parseDosingReference(null)).toBeNull();
  });

  it("returns null when no dose is parseable", () => {
    expect(parseDosingReference("This information is for research and educational use only.")).toBeNull();
  });
});

describe("synthesizedTemplate", () => {
  it("builds ONE per_injection template from a flat-dosed entry (GHK-Cu), using the LOW end", () => {
    const t = synthesizedTemplate(
      entry({
        name: "GHK-Cu",
        templates: [],
        dosingReference: "GHK-Cu is dosed at 1 mg–2 mg 5 days/week by subcutaneous injection in educational protocols.",
      }),
    );
    expect(t).not.toBeNull();
    expect(t!.name).toBe("Suggested protocol (from reference)");
    expect(t!.doseBasis).toBe("per_injection");
    expect(t!.targetDose).toBe(1);
    expect(t!.unit).toBe("mg");
    expect(t!.frequency).toContain("5 days/week");
    expect(t!.ramp).toBeUndefined();
  });

  it("builds a weekly per_injection template for Semaglutide (low end 250 mcg)", () => {
    const t = synthesizedTemplate(
      entry({
        name: "Semaglutide",
        templates: [],
        dosingReference: "Semaglutide is dosed at 250 mcg–2.4 mg weekly via subcutaneous injection in educational protocols.",
      }),
    );
    expect(t).not.toBeNull();
    expect(t!.doseBasis).toBe("per_injection");
    expect(t!.targetDose).toBe(250);
    expect(t!.unit).toBe("mcg");
    expect(t!.frequency).toBe("weekly");
  });

  it("returns null when the entry already has templates", () => {
    const real: EnrichmentTemplate = { name: "Real", doseBasis: "per_week", targetDose: 5, unit: "mg", frequency: "weekly" };
    const t = synthesizedTemplate(
      entry({ templates: [real], dosingReference: "Foo is dosed at 1 mg weekly via subcutaneous." }),
    );
    expect(t).toBeNull();
  });

  it("returns null when the dosingReference is unparseable", () => {
    expect(synthesizedTemplate(entry({ templates: [], dosingReference: "no dose here" }))).toBeNull();
  });

  it("returns null when there is no dosingReference", () => {
    expect(synthesizedTemplate(entry({ templates: [], dosingReference: null }))).toBeNull();
  });
});

describe("effectiveTemplates", () => {
  it("returns the real templates when the entry has them (synthesizedTemplate is NOT consulted)", () => {
    const real: EnrichmentTemplate = { name: "Real", doseBasis: "per_week", targetDose: 5, unit: "mg", frequency: "weekly" };
    const out = effectiveTemplates(entry({ templates: [real], dosingReference: "Foo is dosed at 1 mg weekly via subcutaneous." }));
    expect(out).toEqual([real]);
  });

  it("returns the synthesized template when the entry is flat-dosed (GHK-Cu)", () => {
    const out = effectiveTemplates(
      entry({
        name: "GHK-Cu",
        templates: [],
        dosingReference: "GHK-Cu is dosed at 1 mg–2 mg 5 days/week by subcutaneous injection.",
      }),
    );
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Suggested protocol (from reference)");
    expect(out[0].targetDose).toBe(1);
  });

  it("returns [] when there are no templates and no parseable dose", () => {
    expect(effectiveTemplates(entry({ templates: [], dosingReference: "no dose" }))).toEqual([]);
  });
});
