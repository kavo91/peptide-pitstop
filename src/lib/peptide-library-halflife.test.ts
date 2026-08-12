import { describe, it, expect } from "vitest";
import { libraryHalfLifeHours } from "./peptide-library";

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
    expect(libraryHalfLifeHours("TB4")).toBe("2.5"); // alias of TB-500
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
