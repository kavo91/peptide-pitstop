import { describe, it, expect } from "vitest";
import { assertNoDirectiveAdvice, isCitedReference, toNeutralLiteratureLink, toNeutralReferenceEntry } from "./compliance";

describe("compliance guardrails", () => {
  it("passes neutral, cited literature language unchanged", () => {
    const t =
      "A 2021 RCT (n=20) reported reduced resting heart rate over 8 weeks; no human " +
      "combination data exists for this pair.";
    expect(assertNoDirectiveAdvice(t)).toBe(t);
  });

  it("throws on directive / advice language", () => {
    const bad = [
      "You should take 250mcg each morning",
      "We recommend stacking this with BPC-157",
      "Recommended dose: 5mg twice weekly",
      "Safe to combine with tesamorelin",
      "Your optimal protocol is a 12-week cycle",
    ];
    for (const t of bad) {
      expect(() => assertNoDirectiveAdvice(t)).toThrow(/compliance/);
    }
  });

  it("requires a citation on a reference card", () => {
    expect(isCitedReference({ citation: { pmid: "12345678" } })).toBe(true);
    expect(isCitedReference({ citation: { doi: "10.1000/xyz" } })).toBe(true);
    expect(isCitedReference({ citation: { pmid: "not-a-pmid" } })).toBe(false);
    expect(isCitedReference({ citation: { doi: "example.com/nope" } })).toBe(false);
    expect(isCitedReference({ citation: null })).toBe(false);
    expect(isCitedReference({})).toBe(false);
  });

  it("allow-lists canonical HTTPS PubMed and DOI links with neutral labels", () => {
    expect(toNeutralLiteratureLink({ url: "https://pubmed.ncbi.nlm.nih.gov/12345678/" })).toEqual({
      kind: "pubmed", label: "PubMed PMID 12345678", href: "https://pubmed.ncbi.nlm.nih.gov/12345678/",
    });
    expect(toNeutralLiteratureLink({ url: "https://doi.org/10.1000/xyz-123" })).toEqual({
      kind: "doi", label: "DOI 10.1000/xyz-123", href: "https://doi.org/10.1000/xyz-123",
    });
  });

  it("excludes uncited, insecure, and non-PubMed/DOI references", () => {
    for (const url of [null, "http://pubmed.ncbi.nlm.nih.gov/1234/", "https://example.com/paper", "https://pubmed.ncbi.nlm.nih.gov/search?q=peptide", "https://doi.org/not-a-doi"]) {
      expect(toNeutralLiteratureLink({ url })).toBeNull();
    }
  });

  it("strips therapeutic and dosing fields before UI serialization", () => {
    const safe = toNeutralReferenceEntry({
      name: "Example",
      aliases: "EX",
      references: [{ url: "https://pubmed.ncbi.nlm.nih.gov/12345678/" }, { url: "https://example.com/claim" }],
      benefits: ["claim"],
      dosingReference: "suggested dose",
      templates: [{ targetDose: 1 }],
    } as never);
    expect(safe).toEqual({
      name: "Example",
      aliases: "EX",
      references: [{ kind: "pubmed", label: "PubMed PMID 12345678", href: "https://pubmed.ncbi.nlm.nih.gov/12345678/" }],
    });
    expect(JSON.stringify(safe)).not.toMatch(/benefit|dose|template/i);
  });
});
