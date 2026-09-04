import { describe, it, expect } from "vitest";
import { BIOMARKER_LIBRARY } from "./biomarker-library";
import { LAB_SUBSET, labAliasRank, matchesLabAlias, normaliseLabName } from "./bodycomp-labs";

const def = (label: string) => {
  const d = LAB_SUBSET.find((x) => x.label === label);
  if (!d) throw new Error(`no subset row ${label}`);
  return d;
};
/** Subset labels that claim a given name — should be at most one. */
const claimants = (name: string) => LAB_SUBSET.filter((d) => matchesLabAlias(name, d)).map((d) => d.label);

describe("bodycomp lab alias matcher", () => {
  it("normalises on non-alphanumeric runs", () => {
    expect(normaliseLabName("Vitamin D (25-OH)")).toBe("vitamin d 25 oh");
    expect(normaliseLabName("  CRP (hs) ")).toBe("crp hs");
  });

  it("maps every library name to at most one subset row, and the right one", () => {
    const expected: Record<string, string> = {
      ALT: "ALT",
      AST: "AST",
      HbA1c: "HbA1c",
      TSH: "TSH",
      Testosterone: "Total testosterone",
      "CRP (hs)": "hsCRP",
      Ferritin: "Ferritin",
      "Vitamin D (25-OH)": "Vitamin D",
    };
    for (const b of BIOMARKER_LIBRARY) {
      const got = claimants(b.name);
      expect(got.length, `${b.name} → ${got.join(", ")}`).toBeLessThanOrEqual(1);
      expect(got[0] ?? null, b.name).toBe(expected[b.name] ?? null);
    }
  });

  it("ranks the most specific alias first: hsCRP beats a plain CRP in the same panel, CRP alone still maps", () => {
    // A panel holding both "CRP" and "hsCRP" must show the hsCRP result under the hsCRP label.
    const hs = def("hsCRP");
    expect(labAliasRank("hsCRP", hs)).toBe(0);
    expect(labAliasRank("hs-CRP", hs)).toBe(1);
    expect(labAliasRank("CRP (hs)", hs)!).toBeLessThan(labAliasRank("CRP", hs)!);
    expect(labAliasRank("CRP", hs)).toBe(hs.aliases.indexOf("crp"));
    expect(labAliasRank("Ferritin", hs)).toBeNull();
    const panel = ["CRP", "hsCRP"];
    const best = panel.reduce<{ name: string; rank: number } | null>((b, name) => {
      const rank = labAliasRank(name, hs);
      return rank != null && (!b || rank < b.rank) ? { name, rank } : b;
    }, null);
    expect(best?.name).toBe("hsCRP");
  });

  it("'ast' does not match Glucose (Fasting)", () => {
    expect(matchesLabAlias("Glucose (Fasting)", def("AST"))).toBe(false);
    expect(matchesLabAlias("Fasting glucose", def("AST"))).toBe(false);
    expect(matchesLabAlias("AST", def("AST"))).toBe(true);
    expect(matchesLabAlias("AST (SGOT)", def("AST"))).toBe(true);
  });

  it("'free t' does not match the thyroid rows", () => {
    const ft = def("Free testosterone");
    expect(matchesLabAlias("Free T4", ft)).toBe(false);
    expect(matchesLabAlias("Free T3", ft)).toBe(false);
    expect(matchesLabAlias("FT4", ft)).toBe(false);
    expect(matchesLabAlias("Free Testosterone", ft)).toBe(true);
    expect(matchesLabAlias("Free T (calculated)", ft)).toBe(true);
    expect(claimants("Free T4")).toEqual(["Free T4"]);
    expect(claimants("Free T3")).toEqual(["Free T3"]);
  });

  it("total testosterone excludes the free variant", () => {
    expect(matchesLabAlias("Free Testosterone", def("Total testosterone"))).toBe(false);
    expect(matchesLabAlias("Testosterone, Total", def("Total testosterone"))).toBe(true);
  });

  it("hyphenated aliases match on tokens", () => {
    expect(matchesLabAlias("IGF-1", def("IGF-1"))).toBe(true);
    expect(matchesLabAlias("IGF1", def("IGF-1"))).toBe(true);
    expect(matchesLabAlias("25-OH Vitamin D", def("Vitamin D"))).toBe(true);
    expect(matchesLabAlias("ALT", def("Vitamin D"))).toBe(false);
  });
});

describe("bodycomp lab alias matcher — pathology naming variants", () => {
  const def = (label: string) => LAB_SUBSET.find((x) => x.label === label)!;
  it("matches the name forms Australian pathology labs print", () => {
    expect(matchesLabAlias("Vitamin D3", def("Vitamin D"))).toBe(true);
    expect(matchesLabAlias("hsCRP", def("hsCRP"))).toBe(true);
    expect(matchesLabAlias("CRP", def("hsCRP"))).toBe(true);
    expect(matchesLabAlias("Testosterone (total)", def("Total testosterone"))).toBe(true);
    expect(matchesLabAlias("Free Testosterone", def("Total testosterone"))).toBe(false);
    expect(matchesLabAlias("Insulin (fasting)", def("Insulin"))).toBe(true);
    expect(matchesLabAlias("Glucose (fasting)", def("AST"))).toBe(false);
  });
});
