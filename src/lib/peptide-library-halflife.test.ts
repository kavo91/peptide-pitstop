import { describe, it, expect } from "vitest";
import {libraryHalfLifeHours, PEPTIDE_LIBRARY} from "./peptide-library";
import { getEnrichmentSeed } from "./peptide-enrichment";

/**
 * Pins the data + name/alias match semantics of the canonical library half-life
 * lookup. Previously this test reimplemented the lookup because the only copies
 * lived in server-only modules (src/lib/stacks/server.ts, settings/page.tsx) that
 * pull in prisma; the helper is now exported from the pure library module, so
 * this exercises the real thing rather than a parallel copy that could drift.
 */
describe("libraryHalfLifeHours", () => {
  it("resolves a half-life by canonical name", () => {
    expect(libraryHalfLifeHours("BPC-157")).toBe("7");
  });

  it("is case-insensitive on the name", () => {
    expect(libraryHalfLifeHours("bpc-157")).toBe("7");
  });

  it("resolves by alias", () => {
    expect(libraryHalfLifeHours("Body Protection Compound 157")).toBe("7");
    expect(libraryHalfLifeHours("TB4")).toBe("2.5"); // alias of Thymosin Beta-4 — NOT TB-500, a different compound
  });

  it("returns null when the library entry has no half-life", () => {
    // Deliberately omitted — 'not well characterised'. Must be null, never 0.
    expect(libraryHalfLifeHours("Epitalon")).toBeNull();
    expect(libraryHalfLifeHours("KLOW")).toBeNull();
    expect(libraryHalfLifeHours("MOTS-c")).toBeNull();
  });

  it("resolves 5-Amino-1MQ's reference half-life (by name and alias)", () => {
    // The exact case that broke the chart: library has it, the DB row did not.
    expect(libraryHalfLifeHours("5-Amino-1MQ")).toBe("5");
    expect(libraryHalfLifeHours("5a1mq")).toBe("5");
  });

  it("matches when the QUERY carries the alias and the library holds the name", () => {
    // An owned Peptide row named "Thymosin Beta-4" must find the library's TB-500.
    expect(libraryHalfLifeHours("Thymosin Beta-4")).toBe("2.5");
    expect(libraryHalfLifeHours("Some Local Name", "TB-500")).toBe("2.5");
  });

  it("returns null for an unknown peptide", () => {
    expect(libraryHalfLifeHours("Not A Peptide")).toBeNull();
  });

  it("returns null for empty input rather than matching arbitrarily", () => {
    expect(libraryHalfLifeHours("")).toBeNull();
    expect(libraryHalfLifeHours("   ", "  ,  ")).toBeNull();
  });

  it("tolerates a null aliases column", () => {
    expect(libraryHalfLifeHours("BPC-157", null)).toBe("7");
  });
});

describe("CJC-1295 no-DAC name-form bridge", () => {
  it("resolves the DB peptide's exact name form (no parentheses)", () => {
    expect(libraryHalfLifeHours("CJC-1295 no-DAC")).toBe("0.5");
  });

  it("does NOT let the blend row's aliases collapse onto the single compound", () => {
    // A blend Peptide row may carry "CJC no DAC" among its aliases. The
    // blend library entry has no half-life, so a null here proves the blend
    // still resolves to the BLEND entry; "0.5" would mean it was captured by
    // the single-compound entry that precedes it in scan order.
    expect(
      libraryHalfLifeHours(
        "CJC-1295 no-DAC + Ipamorelin",
        "CJC-1295 / Ipamorelin, CJC/IPA, Mod GRF 1-29 + Ipamorelin, CJC no DAC",
      ),
    ).toBeNull();
  });
});

describe("TB-500 / Thymosin Beta-4 stay separate compounds", () => {
  it("library holds two distinct entries", () => {
    const tb500 = PEPTIDE_LIBRARY.find((e) => e.name === "TB-500");
    const tb4 = PEPTIDE_LIBRARY.find((e) => e.name === "Thymosin Beta-4");
    expect(tb500).toBeDefined();
    expect(tb4).toBeDefined();
    expect(tb500).not.toBe(tb4);
    // Neither entry may alias the other's identity TOKEN (the matcher is
    // exact-token on comma-split aliases; "thymosin beta-4 fragment" is a
    // different token and legitimate).
    const toks = (a?: string) => (a ?? "").split(",").map((t) => t.trim().toLowerCase());
    expect(toks(tb500!.aliases)).not.toContain("thymosin beta-4");
    expect(toks(tb500!.aliases)).not.toContain("tb4");
    expect(toks(tb4!.aliases)).not.toContain("tb-500");
  });

  it("enrichment: the de-conflated TB-4 row no longer inherits the TB-500 card", () => {
    // Post-alias-fix row shape: name "Thymosin Beta-4", aliases TB-4/TB4.
    const card = getEnrichmentSeed("Thymosin Beta-4", "TB-4, TB4");
    expect(card?.name === "TB-500").toBe(false);
  });

  it("enrichment: TB-500 still resolves its own card", () => {
    expect(getEnrichmentSeed("TB-500")?.name).toBe("TB-500");
  });
});

describe("SS-31 library entry", () => {
  it("carries t½ 4 h, the full alias set, and unique tokens", () => {
    const e = PEPTIDE_LIBRARY.find((x) => x.name === "SS-31")!;
    expect(e.halfLifeHours).toBe("4");
    expect(e.aliases).toBe("Elamipretide, Bendavia, MTP-131");
    expect(e.category).toContain("Mitochondria");
    // token-cross-match guard (the TB-500 lesson): no OTHER entry may carry
    // any SS-31 token, or enrichment/seed matching cross-binds.
    const tokens = ["ss-31", "elamipretide", "bendavia", "mtp-131"];
    for (const other of PEPTIDE_LIBRARY.filter((x) => x.name !== "SS-31")) {
      const hay = `${other.name}, ${other.aliases ?? ""}`.toLowerCase();
      for (const t of tokens) expect(hay.includes(t)).toBe(false);
    }
  });
});
