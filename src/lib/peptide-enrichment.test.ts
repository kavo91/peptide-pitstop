import { describe, it, expect } from "vitest";
import {
  getEnrichmentSeed,
  getEnrichment,
  allEnrichmentSeed,
  enrichmentSeedMeta,
  tokens,
  ENRICHMENT_SOURCE,
  type EnrichmentEntry,
} from "./peptide-enrichment";
import { PEPTIDE_LIBRARY } from "./peptide-library";

describe("tokens", () => {
  it("lowercases and splits name + comma aliases (mirrors settings tokens())", () => {
    expect(tokens("Retatrutide")).toEqual(["retatrutide"]);
    expect(tokens("Semaglutide", "Ozempic, Wegovy")).toEqual(["semaglutide", "ozempic", "wegovy"]);
  });
});

describe("seed integrity", () => {
  it("has a meaningful subset of the library scraped", () => {
    const meta = enrichmentSeedMeta();
    expect(meta.source).toBe("peptidedosages.com");
    // 19 of 20 library peptides (GHK-Cu has no source page).
    expect(meta.count).toBeGreaterThanOrEqual(15);
    expect(allEnrichmentSeed()).toHaveLength(meta.count);
  });

  it("every entry carries source attribution + a source URL", () => {
    for (const e of allEnrichmentSeed()) {
      expect(e.source).toBe(ENRICHMENT_SOURCE);
      expect(e.sourceUrl).toMatch(/^https:\/\/peptidedosages\.com\//);
      expect(e.attribution).toMatch(/peptidedosages\.com/i);
      expect(e.curatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(e.name.length).toBeGreaterThan(0);
    }
  });

  it("entry names all correspond to PEPTIDE_LIBRARY names", () => {
    const libNames = new Set(PEPTIDE_LIBRARY.map((p) => p.name));
    for (const e of allEnrichmentSeed()) {
      expect(libNames.has(e.name)).toBe(true);
    }
  });
});

describe("getEnrichmentSeed lookup", () => {
  it("matches by exact name (case-insensitive)", () => {
    const e = getEnrichmentSeed("retatrutide");
    expect(e?.name).toBe("Retatrutide");
  });

  it("matches by alias", () => {
    // Semaglutide aliases include Ozempic / Wegovy in the library.
    const lib = PEPTIDE_LIBRARY.find((p) => p.name === "Semaglutide");
    expect(lib?.aliases).toBeTruthy();
    const e = getEnrichmentSeed("Ozempic", lib?.aliases);
    expect(e?.name).toBe("Semaglutide");
  });

  it("returns undefined for an unknown peptide", () => {
    expect(getEnrichmentSeed("Nonexistent-Peptide-X")).toBeUndefined();
    expect(getEnrichmentSeed("")).toBeUndefined();
  });
});

describe("entry + template shape", () => {
  it("Retatrutide entry has well-formed templates with titration ramps", () => {
    const e = getEnrichmentSeed("Retatrutide") as EnrichmentEntry;
    expect(e).toBeTruthy();
    expect(Array.isArray(e.benefits)).toBe(true);
    expect(Array.isArray(e.sideEffects)).toBe(true);
    expect(e.dosingReference).toMatch(/weekly/i);
    expect(e.reconstitutionRatio).toMatch(/mg\/mL/);
    expect(e.templates.length).toBeGreaterThanOrEqual(1);

    const t = e.templates[0];
    expect(["per_injection", "per_week"]).toContain(t.doseBasis);
    expect(typeof t.name).toBe("string");
    expect(t.unit.length).toBeGreaterThan(0);
    expect(typeof t.targetDose === "number" || t.targetDose === null).toBe(true);
    expect(Array.isArray(t.ramp)).toBe(true);
    if (t.ramp && t.ramp.length) {
      expect(t.ramp[0].phase.length).toBeGreaterThan(0);
      expect(typeof t.ramp[0].doseLabel).toBe("string");
    }
  });

  it("references carry a label and a nullable url", () => {
    const e = getEnrichmentSeed("Retatrutide") as EnrichmentEntry;
    expect(e.references.length).toBeGreaterThan(0);
    for (const r of e.references) {
      expect(typeof r.label).toBe("string");
      expect(r.url === null || /^https?:\/\//.test(r.url)).toBe(true);
    }
  });
});

describe("getEnrichment (async, DB-then-seed)", () => {
  it("falls back to the seed when the DB is unavailable", async () => {
    // In the vitest node env there is no NEXT_RUNTIME/migrated DB; the dynamic
    // import + query throws and the helper must fall back to the seed.
    const e = await getEnrichment("Retatrutide");
    expect(e?.name).toBe("Retatrutide");
    expect(e?.source).toBe(ENRICHMENT_SOURCE);
  });

  it("returns undefined for unknown peptide via the async path too", async () => {
    expect(await getEnrichment("Nonexistent-Peptide-X")).toBeUndefined();
  });
});
