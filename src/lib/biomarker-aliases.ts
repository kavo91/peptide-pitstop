/**
 * Canonical biomarker names and unit spellings for lab entry. Pure, no I/O.
 *
 * Lab reports spell the same analyte many ways ("Gamma GT", "Gamma GT (GGT)",
 * "GGT"). Results resolve to a `Biomarker` row by exact name, so every new
 * spelling used to create a parallel row and split one analyte across two
 * bloodwork rows. `createLabPanel` now folds each name through this table
 * first. Naming rule: the short clinical abbreviation where it is standard on
 * AU reports, otherwise sentence-case qualifiers in parentheses.
 * `BIOMARKER_LIBRARY` must use the canonical names too, or `ensureBiomarkers`
 * re-creates the old spelling (asserted in the tests).
 *
 * Standard CRP and hs-CRP are different assays and stay separate here; they
 * share one row only at display time (see `displayGroupName` in bloodwork.ts).
 *
 * `scripts/merge-bloodwork-dedupe.cjs` carries a copy of both tables for the
 * one-off DB merge; a test keeps the copies identical.
 */

/** Canonical name → the other spellings that fold onto it. */
export const BIOMARKER_ALIASES: Readonly<Record<string, readonly string[]>> = {
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
};

/**
 * Unit spelling → the library's spelling. Pure spelling variants only, matched
 * exactly (units are case-sensitive: mU ≠ MU). Never add a pair that differs in
 * meaning or scale — eGFR's "mL/min" is not "mL/min/1.73m²", "IU/L" is not "mIU/L".
 */
export const UNIT_SPELLINGS: Readonly<Record<string, string>> = {
  "umol/L": "µmol/L",
  "\u03bcmol/L": "µmol/L", // Greek mu → micro sign
  "ug/L": "µg/L",
  "\u03bcg/L": "µg/L",
  "x10^9/L": "×10⁹/L",
  "x10^12/L": "×10¹²/L",
  "mU/L": "mIU/L",
};

const UNIT_BY_SPELLING: ReadonlyMap<string, string> = new Map(Object.entries(UNIT_SPELLINGS));

/** Case- and spacing-insensitive lookup key. */
export function aliasKey(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "");
}

const CANONICAL_BY_KEY: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [canonical, aliases] of Object.entries(BIOMARKER_ALIASES)) {
    for (const name of [canonical, ...aliases]) m.set(aliasKey(name), canonical);
  }
  return m;
})();

/**
 * The canonical name for a lab-entry biomarker name. A known spelling (any case
 * or spacing) maps to its canonical; anything else comes back trimmed and is
 * still created as a custom biomarker, as before.
 */
export function canonicalBiomarkerName(name: string): string {
  const trimmed = name.trim();
  return CANONICAL_BY_KEY.get(aliasKey(trimmed)) ?? trimmed;
}

/**
 * Rows of one submission that resolve to the same biomarker. Saving them would
 * put two results for one biomarker in one panel, so the caller rejects them.
 */
export function findCanonicalCollisions(names: string[]): { canonical: string; inputs: string[] }[] {
  const byCanonical = new Map<string, string[]>();
  for (const n of names) {
    const c = canonicalBiomarkerName(n);
    byCanonical.set(c, [...(byCanonical.get(c) ?? []), n.trim()]);
  }
  return [...byCanonical.entries()]
    .filter(([, inputs]) => inputs.length > 1)
    .map(([canonical, inputs]) => ({ canonical, inputs }));
}

/**
 * One message for every collision, e.g. "Zinc is listed twice; Gamma GT and
 * GGT are the same biomarker (GGT). Keep one row for each biomarker."
 */
export function collisionMessage(collisions: { canonical: string; inputs: string[] }[]): string {
  const parts = collisions.map(({ canonical, inputs }) =>
    new Set(inputs).size === 1
      ? `${canonical} is listed ${inputs.length === 2 ? "twice" : `${inputs.length} times`}`
      : `${[...new Set(inputs)].join(" and ")} are the same biomarker (${canonical})`,
  );
  return `${parts.join("; ")}. Keep one row for each biomarker.`;
}

/** The library spelling of a unit; blank → null; unknown units unchanged (trimmed). */
export function canonicalUnit(unit: string | null | undefined): string | null {
  const u = (unit ?? "").trim();
  if (!u) return null;
  return UNIT_BY_SPELLING.get(u) ?? u;
}
