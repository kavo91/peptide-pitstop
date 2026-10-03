import { describe, it, expect } from "vitest";
import {
  BIOMARKER_ALIASES,
  UNIT_SPELLINGS,
  aliasKey,
  canonicalBiomarkerName,
  canonicalUnit,
  collisionMessage,
  findCanonicalCollisions,
} from "./biomarker-aliases";
import { BIOMARKER_LIBRARY } from "./biomarker-library";

describe("canonicalBiomarkerName", () => {
  it("folds a known variant onto its canonical name", () => {
    expect(canonicalBiomarkerName("Alkaline Phosphatase (ALP)")).toBe("ALP");
    expect(canonicalBiomarkerName("Alk. Phos.")).toBe("ALP");
    expect(canonicalBiomarkerName("hsCRP")).toBe("CRP (hs)");
    expect(canonicalBiomarkerName("Vitamin D3")).toBe("Vitamin D (25-OH)");
    expect(canonicalBiomarkerName("LD")).toBe("LDH");
  });

  it("ignores case and spacing", () => {
    expect(canonicalBiomarkerName("Glucose (Fasting)")).toBe("Glucose (fasting)");
    expect(canonicalBiomarkerName("  gamma   gt  ")).toBe("GGT");
    expect(canonicalBiomarkerName("GAMMA GT (GGT)")).toBe("GGT");
    expect(canonicalBiomarkerName("Free Testosterone(calc)")).toBe("Free Testosterone");
    expect(canonicalBiomarkerName("insulin (fasting)")).toBe("Insulin (fasting)");
  });

  it("returns a canonical name unchanged (trimmed)", () => {
    expect(canonicalBiomarkerName("ALP")).toBe("ALP");
    expect(canonicalBiomarkerName(" Testosterone (total) ")).toBe("Testosterone (total)");
  });

  it("passes an unknown name through trimmed, so it still becomes a custom biomarker", () => {
    expect(canonicalBiomarkerName("  Albumin ")).toBe("Albumin");
    expect(canonicalBiomarkerName("Some New Marker")).toBe("Some New Marker");
  });

  it("keeps standard CRP and hs-CRP as separate assays", () => {
    expect(canonicalBiomarkerName("CRP")).toBe("CRP");
    expect(canonicalBiomarkerName("hsCRP")).toBe("CRP (hs)");
  });

  it("never maps one alias key to two canonical names", () => {
    const owner = new Map<string, string>();
    for (const [canonical, aliases] of Object.entries(BIOMARKER_ALIASES)) {
      for (const name of [canonical, ...aliases]) {
        const k = aliasKey(name);
        expect(owner.get(k) ?? canonical, `${name} is claimed twice`).toBe(canonical);
        owner.set(k, canonical);
      }
    }
  });

  it("no canonical name is itself listed as another canonical's alias", () => {
    const canonicals = new Set(Object.keys(BIOMARKER_ALIASES));
    for (const aliases of Object.values(BIOMARKER_ALIASES)) {
      for (const a of aliases) expect(canonicals.has(a), a).toBe(false);
    }
  });
});

describe("biomarker library uses canonical spellings", () => {
  it("every library name is already canonical, so ensureBiomarkers never re-creates an old spelling", () => {
    for (const b of BIOMARKER_LIBRARY) expect(canonicalBiomarkerName(b.name), b.name).toBe(b.name);
  });

  it("renames the two library entries that used the old spelling", () => {
    const names = BIOMARKER_LIBRARY.map((b) => b.name);
    expect(names).toContain("Glucose (fasting)");
    expect(names).toContain("Testosterone (total)");
    expect(names).not.toContain("Glucose (Fasting)");
    expect(names).not.toContain("Testosterone");
  });

  it("every library default unit is already a canonical spelling", () => {
    for (const b of BIOMARKER_LIBRARY) expect(canonicalUnit(b.defaultUnit), b.name).toBe(b.defaultUnit);
  });
});

describe("findCanonicalCollisions", () => {
  it("is empty when every row resolves to a different biomarker", () => {
    expect(findCanonicalCollisions(["ALT", "AST", "CRP", "hsCRP"])).toEqual([]);
  });

  it("reports two rows that fold onto one canonical name in the same panel", () => {
    expect(findCanonicalCollisions(["Glucose (Fasting)", "ALT", "Glucose (fasting)"])).toEqual([
      { canonical: "Glucose (fasting)", inputs: ["Glucose (Fasting)", "Glucose (fasting)"] },
    ]);
    expect(findCanonicalCollisions(["Gamma GT", "Gamma GT (GGT)"])).toEqual([
      { canonical: "GGT", inputs: ["Gamma GT", "Gamma GT (GGT)"] },
    ]);
  });

  it("reports an exact repeated name too", () => {
    expect(findCanonicalCollisions(["Zinc", "Zinc"])).toEqual([{ canonical: "Zinc", inputs: ["Zinc", "Zinc"] }]);
  });

  it("words every collision for the form", () => {
    expect(collisionMessage(findCanonicalCollisions(["Zinc", "Gamma GT", "Zinc", "GGT"]))).toBe(
      "Zinc is listed twice; Gamma GT and GGT are the same biomarker (GGT). Keep one row for each biomarker.",
    );
    expect(collisionMessage(findCanonicalCollisions(["ALT", "ALT", "ALT"]))).toBe(
      "ALT is listed 3 times. Keep one row for each biomarker.",
    );
  });
});

describe("the fold table is the agreed table", () => {
  it("matches the agreed table exactly, so an edit to both copies still needs a deliberate test change", () => {
    expect(BIOMARKER_ALIASES).toEqual({
      ALP: ["Alk. Phos.", "Alkaline Phosphatase (ALP)"],
      "Calcium (corrected)": ["Corrected Calcium", "Calcium (adjusted for albumin)"],
      "Chol/HDL Ratio": ["Total:HDL Ratio"],
      CK: ["Creatine Kinase (CK)"],
      "Cortisol (AM)": ["Cortisol"],
      "CRP (hs)": ["hsCRP"],
      "DHEA-S": ["DHEA-Sulphate"],
      "Free Testosterone": ["Free Testosterone (calc)"],
      FSH: ["Follicle Stimulating Hormone (FSH)"],
      GGT: ["Gamma GT", "Gamma GT (GGT)"],
      Globulin: ["Globulins"],
      "Glucose (fasting)": ["Glucose (Fasting)"],
      "Insulin (fasting)": ["Insulin (Fasting)"],
      LDH: ["LD"],
      LH: ["Luteinising Hormone (LH)"],
      MPV: ["Mean Platelet Volume (MPV)"],
      Oestradiol: ["Oestradiol (E2)"],
      RDW: ["Red Cell Distribution Width (RDW)"],
      "Testosterone (total)": ["Testosterone"],
      "Vitamin D (25-OH)": ["Vitamin D3"],
    });
  });
});

describe("canonicalUnit", () => {
  it("folds pure spelling variants onto the library spelling", () => {
    expect(canonicalUnit("umol/L")).toBe("µmol/L");
    expect(canonicalUnit("ug/L")).toBe("µg/L");
    expect(canonicalUnit("x10^9/L")).toBe("×10⁹/L");
    expect(canonicalUnit("x10^12/L")).toBe("×10¹²/L");
    expect(canonicalUnit("mU/L")).toBe("mIU/L");
  });

  it("folds the Greek mu (U+03BC) onto the micro sign (U+00B5)", () => {
    expect(canonicalUnit("\u03bcmol/L")).toBe("\u00b5mol/L");
    expect(canonicalUnit("\u03bcg/L")).toBe("\u00b5g/L");
  });

  it("trims, and maps blank to null", () => {
    expect(canonicalUnit("  umol/L ")).toBe("µmol/L");
    expect(canonicalUnit("")).toBeNull();
    expect(canonicalUnit("   ")).toBeNull();
    expect(canonicalUnit(null)).toBeNull();
    expect(canonicalUnit(undefined)).toBeNull();
  });

  it("leaves canonical and unknown units unchanged", () => {
    for (const u of ["µmol/L", "×10⁹/L", "mIU/L", "nmol/L", "pmol/L", "U/L", "%", "ratio"]) {
      expect(canonicalUnit(u)).toBe(u);
    }
  });

  it("never folds units that differ in meaning or scale", () => {
    expect(canonicalUnit("mL/min")).toBe("mL/min"); // not eGFR's mL/min/1.73m²
    expect(canonicalUnit("nmol/L")).toBe("nmol/L");
    expect(canonicalUnit("IU/L")).toBe("IU/L"); // not mIU/L
    expect(canonicalUnit("umol/l")).toBe("umol/l"); // case-sensitive: only exact spellings fold
  });

  it("every fold target is itself canonical (no chains)", () => {
    for (const to of Object.values(UNIT_SPELLINGS)) expect(canonicalUnit(to)).toBe(to);
  });
});

describe("lookups ignore inherited object keys", () => {
  it("does not treat built-in property names as known spellings", () => {
    expect(canonicalUnit("constructor")).toBe("constructor");
    expect(canonicalUnit("toString")).toBe("toString");
    expect(canonicalBiomarkerName("constructor")).toBe("constructor");
  });
});
