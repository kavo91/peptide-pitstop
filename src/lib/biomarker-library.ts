/**
 * Curated reference catalog of common blood biomarkers. Static data (lives in
 * code, not the DB) — the Bloodwork feature seeds shared `Biomarker` rows from
 * these entries via `ensureBiomarkers` and uses the names to drive the manual
 * lab-entry picker.
 *
 * Units are SI / Australian-pathology conventions (g/L, mmol/L, nmol/L, etc.).
 *
 * `optimalLow` / `optimalHigh` carry a *narrower* "optimal" target than a lab's
 * standard reference interval, used only to flag in-reference-but-suboptimal
 * results as "borderline". They are set ONLY where the optimal target is
 * well-established and widely cited; otherwise left undefined (do not invent
 * ranges). Reference only — not medical advice.
 */
export interface LibraryBiomarker {
  name: string;
  defaultUnit: string;
  category: string;
  /** Decimal strings (Prisma Decimal takes strings). Omitted where not well-established. */
  optimalLow?: string;
  optimalHigh?: string;
}

export const BIOMARKER_LIBRARY: LibraryBiomarker[] = [
  // ── Full blood count / haematology ──────────────────────────────────────
  { name: "Haemoglobin", defaultUnit: "g/L", category: "Haematology" },
  { name: "White Cell Count", defaultUnit: "×10⁹/L", category: "Haematology" },
  { name: "Neutrophils", defaultUnit: "×10⁹/L", category: "Haematology" },
  { name: "Lymphocytes", defaultUnit: "×10⁹/L", category: "Haematology" },
  { name: "Platelets", defaultUnit: "×10⁹/L", category: "Haematology" },

  // ── Renal ───────────────────────────────────────────────────────────────
  { name: "eGFR", defaultUnit: "mL/min/1.73m²", category: "Renal", optimalLow: "90" },
  { name: "Creatinine", defaultUnit: "µmol/L", category: "Renal" },

  // ── Liver ───────────────────────────────────────────────────────────────
  { name: "ALT", defaultUnit: "U/L", category: "Liver" },
  { name: "AST", defaultUnit: "U/L", category: "Liver" },

  // ── Lipids ──────────────────────────────────────────────────────────────
  { name: "Total Cholesterol", defaultUnit: "mmol/L", category: "Lipids", optimalHigh: "5.2" },
  { name: "LDL Cholesterol", defaultUnit: "mmol/L", category: "Lipids", optimalHigh: "2.6" },
  { name: "HDL Cholesterol", defaultUnit: "mmol/L", category: "Lipids", optimalLow: "1.3" },
  { name: "Triglycerides", defaultUnit: "mmol/L", category: "Lipids", optimalHigh: "1.7" },

  // ── Metabolic / glycaemic ───────────────────────────────────────────────
  { name: "HbA1c", defaultUnit: "%", category: "Metabolic", optimalLow: "4.0", optimalHigh: "5.4" },
  { name: "Glucose (Fasting)", defaultUnit: "mmol/L", category: "Metabolic", optimalLow: "4.0", optimalHigh: "5.4" },

  // ── Hormones ────────────────────────────────────────────────────────────
  { name: "TSH", defaultUnit: "mIU/L", category: "Hormones", optimalLow: "0.5", optimalHigh: "2.5" },
  { name: "Testosterone", defaultUnit: "nmol/L", category: "Hormones" },

  // ── Inflammation ────────────────────────────────────────────────────────
  { name: "CRP (hs)", defaultUnit: "mg/L", category: "Inflammation", optimalHigh: "1.0" },

  // ── Vitamins & minerals ─────────────────────────────────────────────────
  { name: "Vitamin D (25-OH)", defaultUnit: "nmol/L", category: "Vitamins & Minerals", optimalLow: "75", optimalHigh: "150" },
  { name: "Ferritin", defaultUnit: "µg/L", category: "Vitamins & Minerals" },
];

/** Minimal structural type so this can run against the client OR a tx client. */
type BiomarkerUpsertClient = {
  biomarker: {
    upsert: (args: {
      where: { name: string };
      create: { name: string; defaultUnit: string; category: string; optimalLow: string | null; optimalHigh: string | null };
      update: { defaultUnit: string; category: string; optimalLow: string | null; optimalHigh: string | null };
    }) => Promise<unknown>;
  };
};

/**
 * Idempotently upsert the library into the shared `Biomarker` table (matched by
 * unique `name`). Safe to call on every write — it is a no-op once seeded and
 * keeps unit/category/optimal metadata in sync with this file.
 */
export async function ensureBiomarkers(client: BiomarkerUpsertClient): Promise<void> {
  for (const b of BIOMARKER_LIBRARY) {
    await client.biomarker.upsert({
      where: { name: b.name },
      create: {
        name: b.name,
        defaultUnit: b.defaultUnit,
        category: b.category,
        optimalLow: b.optimalLow ?? null,
        optimalHigh: b.optimalHigh ?? null,
      },
      update: {
        defaultUnit: b.defaultUnit,
        category: b.category,
        optimalLow: b.optimalLow ?? null,
        optimalHigh: b.optimalHigh ?? null,
      },
    });
  }
}
