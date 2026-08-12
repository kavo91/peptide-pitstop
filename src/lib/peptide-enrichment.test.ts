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
import { toNeutralReferenceEntry } from "./compliance";

const unitScale: Record<string, number> = { mcg: 1, ug: 1, mg: 1000 };

function normaliseUnit(unit: string) {
  return unit.toLowerCase().replace("ug", "mcg");
}

function doseFromLabel(label: string | undefined, preferredUnit: string) {
  const matches = Array.from(
    String(label ?? "").matchAll(/([0-9][0-9,]*(?:\.\d+)?)\s*(mcg|ug|mg)\b/gi),
  ).map((match) => ({
    value: Number(match[1].replace(/,/g, "")),
    unit: normaliseUnit(match[2]),
  }));
  if (matches.length === 0) return null;

  const targetUnit = normaliseUnit(preferredUnit);
  const picked = matches.find((match) => match.unit === targetUnit) ?? matches[0];
  return (picked.value * (unitScale[picked.unit] ?? 1)) / (unitScale[targetUnit] ?? 1);
}

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

  it("MOTS-c gradual template uses the labelled 1,000 mcg maintenance dose", () => {
    const e = getEnrichmentSeed("MOTS-c") as EnrichmentEntry;
    const t = e.templates.find((template) => template.name === "Standard / Gradual Approach");

    expect(t).toBeTruthy();
    expect(t?.targetDose).toBe(1000);
    expect(t?.unit).toBe("mcg");
    expect(t?.ramp?.at(-1)).toMatchObject({
      phase: "Weeks 9–10+",
      dose: 1000,
      unit: "mcg",
      doseLabel: "1,000 mcg (1.0 mg)",
    });
  });

  it("all template numeric doses are positive and match their dose labels", () => {
    for (const entry of allEnrichmentSeed()) {
      for (const template of entry.templates) {
        if (template.targetDose !== null) {
          expect(template.targetDose, `${entry.name} / ${template.name} targetDose`).toBeGreaterThan(0);
        }

        for (const row of template.ramp ?? []) {
          expect(row.dose, `${entry.name} / ${template.name} / ${row.phase} dose`).toBeGreaterThan(0);

          const labelledDose = doseFromLabel(row.doseLabel, row.unit);
          if (labelledDose !== null) {
            expect(row.dose, `${entry.name} / ${template.name} / ${row.phase} doseLabel`).toBe(labelledDose);
          }
        }
      }
    }
  });
});

describe("manual entries (5-Amino-1MQ hybrid)", () => {
  it("resolves by canonical name and by alias", () => {
    expect(getEnrichmentSeed("5-Amino-1MQ")?.name).toBe("5-Amino-1MQ");
    expect(getEnrichmentSeed("5a1mq")?.name).toBe("5-Amino-1MQ");
  });

  it("is present in the library so the picker offers it", () => {
    expect(PEPTIDE_LIBRARY.some((p) => p.name === "5-Amino-1MQ")).toBe(true);
  });

  it("carries the peptidedosages mix (reconstitution ratio → calculator)", () => {
    const e = getEnrichmentSeed("5-Amino-1MQ") as EnrichmentEntry;
    expect(e.reconstitutionRatio).toBe("2 mL = ~5.0 mg/mL");
    expect(e.reconstitution.some((s) => /2\.0 mL bacteriostatic water/i.test(s))).toBe(true);
  });

  it("carries the alpha-rejuvenation subQ titration ramp (150 → 300 → 500 mcg)", () => {
    const e = getEnrichmentSeed("5-Amino-1MQ") as EnrichmentEntry;
    expect(e.templates).toHaveLength(1);
    const ramp = e.templates[0].ramp ?? [];
    expect(ramp.map((r) => r.dose)).toEqual([150, 300, 500]);
    expect(ramp.every((r) => r.unit === "mcg")).toBe(true);
    expect(e.templates[0].targetDose).toBe(500);
  });

  it("attributes the mix to peptidedosages and names both sources", () => {
    const e = getEnrichmentSeed("5-Amino-1MQ") as EnrichmentEntry;
    expect(e.sourceUrl).toBe(
      "https://peptidedosages.com/single-peptide-dosages/5-amino-1mq-10-mg-vial-dosage-protocol/",
    );
    expect(e.attribution).toMatch(/peptidedosages\.com/i);
    expect(e.attribution).toMatch(/alpha-rejuvenation\.com/i);
  });

  it("exposes only allow-listed PubMed + DOI links through the neutral boundary", () => {
    const e = getEnrichmentSeed("5-Amino-1MQ") as EnrichmentEntry;
    const neutral = toNeutralReferenceEntry({ name: e.name, aliases: e.aliases, references: e.references });
    // PubMed 24717514 + two DOIs (BCP 2018, Frontiers 2024) survive; the
    // peptidedosages / alpha-rejuvenation / peptideprotocolwiki / PMC links are stripped.
    expect(neutral.references).toHaveLength(3);
    expect(new Set(neutral.references.map((r) => r.kind))).toEqual(new Set(["doi", "pubmed"]));
    expect(neutral.references.every((r) => /pubmed\.ncbi|doi\.org/.test(r.href))).toBe(true);
    expect(
      neutral.references.some((r) => /peptideprotocolwiki|peptidedosages|alpha-rejuvenation|pmc\.ncbi/.test(r.href)),
    ).toBe(false);
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
