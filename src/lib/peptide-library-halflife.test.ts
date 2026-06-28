import { describe, it, expect } from "vitest";
import { PEPTIDE_LIBRARY } from "./peptide-library";

/**
 * Pins the data + name/alias match semantics that the stack half-life fallback
 * relies on (libHalfLifeHours in src/lib/stacks/server.ts). That helper lives in
 * a server-only module and pulls in prisma, so it isn't unit-testable
 * without heavy mocking; this mock-free test exercises the identical lookup
 * (case-insensitive, name OR alias → halfLifeHours) directly against the library
 * so a library edit can't silently break the stack display parity.
 */
function lookup(query: string): string | null {
  const q = query.trim().toLowerCase();
  const hit = PEPTIDE_LIBRARY.find((e) =>
    [e.name, ...(e.aliases ?? "").split(",")]
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .includes(q),
  );
  return hit?.halfLifeHours ?? null;
}

describe("library half-life fallback (stack display parity)", () => {
  it("resolves a half-life by canonical name", () => {
    expect(lookup("BPC-157")).toBe("7");
  });

  it("is case-insensitive on the name", () => {
    expect(lookup("bpc-157")).toBe("7");
  });

  it("resolves by alias", () => {
    expect(lookup("Body Protection Compound 157")).toBe("7");
    expect(lookup("TB4")).toBe("2.5"); // alias of TB-500
  });

  it("returns null when the library entry has no half-life", () => {
    expect(lookup("Epitalon")).toBeNull(); // present in library, halfLifeHours omitted
  });

  it("returns null for an unknown peptide", () => {
    expect(lookup("Not A Peptide")).toBeNull();
  });
});
