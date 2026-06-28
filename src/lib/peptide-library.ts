/**
 * Curated reference catalog of common research peptides. Static data (lives in
 * code, not the DB) — the Settings "Add from library" picker creates a
 * user-owned Peptide row from a chosen entry via the existing savePeptide action.
 *
 * Half-lives are approximate reference values (subcutaneous, where applicable),
 * aligned to peptidejournal.org's peptide half-life quick-reference chart
 * (within-range midpoints; "not well characterised" PK is left omitted).
 * Research-peptide PK is often debated. Reference only — not medical advice.
 * No dose ranges by design (keeps this neutral reference data, not guidance).
 */
export interface LibraryPeptide {
  name: string;
  aliases?: string;
  category: string;
  substanceClass: "mass" | "IU";
  halfLifeHours?: string; // omitted where not well-characterised
  storageNotes?: string;
}

const RECON_FRIDGE = "Lyophilised — reconstitute with BAC water; refrigerate, use within ~28 days.";
const GLP1_FRIDGE = "Refrigerate; protect from light. Reconstituted vials per label.";

export const PEPTIDE_LIBRARY: LibraryPeptide[] = [
  { name: "BPC-157", aliases: "Body Protection Compound 157", category: "Healing / recovery", substanceClass: "mass", halfLifeHours: "7", storageNotes: RECON_FRIDGE },
  { name: "TB-500", aliases: "Thymosin Beta-4, TB4", category: "Healing / recovery", substanceClass: "mass", halfLifeHours: "2.5", storageNotes: RECON_FRIDGE },
  { name: "Thymosin Alpha-1", aliases: "Tα1, Thymalfasin", category: "Immune", substanceClass: "mass", halfLifeHours: "2", storageNotes: RECON_FRIDGE },
  { name: "GHK-Cu", aliases: "Copper peptide", category: "Cosmetic / healing", substanceClass: "mass", halfLifeHours: "1", storageNotes: RECON_FRIDGE },
  { name: "Ipamorelin", category: "GH secretagogue", substanceClass: "mass", halfLifeHours: "2.5", storageNotes: RECON_FRIDGE },
  { name: "CJC-1295 (no DAC)", aliases: "Mod GRF 1-29", category: "GH secretagogue", substanceClass: "mass", halfLifeHours: "0.5", storageNotes: RECON_FRIDGE },
  { name: "CJC-1295 (with DAC)", category: "GH secretagogue", substanceClass: "mass", halfLifeHours: "144", storageNotes: RECON_FRIDGE },
  { name: "Sermorelin", category: "GH secretagogue", substanceClass: "mass", halfLifeHours: "0.2", storageNotes: RECON_FRIDGE },
  { name: "Tesamorelin", category: "GH secretagogue", substanceClass: "mass", halfLifeHours: "0.5", storageNotes: RECON_FRIDGE },
  { name: "Semaglutide", aliases: "Ozempic, Wegovy", category: "GLP-1", substanceClass: "mass", halfLifeHours: "168", storageNotes: GLP1_FRIDGE },
  { name: "Tirzepatide", aliases: "Mounjaro, Zepbound", category: "GLP-1 / GIP", substanceClass: "mass", halfLifeHours: "120", storageNotes: GLP1_FRIDGE },
  { name: "Retatrutide", category: "GLP-1 / GIP / glucagon", substanceClass: "mass", halfLifeHours: "144", storageNotes: GLP1_FRIDGE },
  { name: "PT-141", aliases: "Bremelanotide", category: "Sexual health", substanceClass: "mass", halfLifeHours: "2.7", storageNotes: RECON_FRIDGE },
  { name: "Melanotan II", aliases: "MT-II", category: "Pigmentation", substanceClass: "mass", halfLifeHours: "1", storageNotes: RECON_FRIDGE },
  { name: "MOTS-c", category: "Metabolic / mitochondrial", substanceClass: "mass", storageNotes: RECON_FRIDGE },
  { name: "Epitalon", aliases: "Epithalon", category: "Longevity", substanceClass: "mass", storageNotes: RECON_FRIDGE },
  { name: "Selank", category: "Nootropic", substanceClass: "mass", halfLifeHours: "0.5", storageNotes: RECON_FRIDGE },
  { name: "Semax", category: "Nootropic", substanceClass: "mass", halfLifeHours: "0.5", storageNotes: RECON_FRIDGE },
  { name: "HCG", aliases: "Human Chorionic Gonadotropin", category: "Hormonal", substanceClass: "IU", halfLifeHours: "33", storageNotes: RECON_FRIDGE },
  { name: "Somatropin (HGH)", aliases: "Human Growth Hormone", category: "Growth hormone", substanceClass: "IU", halfLifeHours: "3", storageNotes: RECON_FRIDGE },

  // Multi-peptide blends (one vial, combined components). Enrichment scraped from
  // peptidedosages.com/peptide-blend-dosages (see BLEND_SLUG_MAP). Half-lives
  // omitted (component-dependent). Names mirror BLEND_SLUG_MAP exactly.
  { name: "BPC-157 / TB-500", aliases: "BPC-157 + TB-500, Wolverine blend, BPC-TB", category: "Blends", substanceClass: "mass", storageNotes: RECON_FRIDGE },
  { name: "CJC-1295 / Ipamorelin", aliases: "CJC-1295 (no DAC) + Ipamorelin", category: "Blends", substanceClass: "mass", storageNotes: RECON_FRIDGE },
  { name: "CJC-1295 / GHRP-2", aliases: "CJC-1295 + GHRP-2", category: "Blends", substanceClass: "mass", storageNotes: RECON_FRIDGE },
  { name: "Tesamorelin / Ipamorelin", aliases: "Tesamorelin + Ipamorelin", category: "Blends", substanceClass: "mass", storageNotes: RECON_FRIDGE },
  { name: "AOD-9604 / CJC-1295 / Ipamorelin", aliases: "AOD-9604 + CJC-1295 + Ipamorelin", category: "Blends", substanceClass: "mass", storageNotes: RECON_FRIDGE },
  { name: "Cagrilintide / Semaglutide", aliases: "CagriSema, Cagrilintide + Semaglutide", category: "Blends", substanceClass: "mass", storageNotes: GLP1_FRIDGE },
  { name: "GLOW", aliases: "GHK-Cu + BPC-157 + TB-500", category: "Blends", substanceClass: "mass", storageNotes: RECON_FRIDGE },
  { name: "KLOW", aliases: "GHK-Cu + KPV + BPC-157 + TB-500", category: "Blends", substanceClass: "mass", storageNotes: RECON_FRIDGE },
  { name: "Tri-Heal", aliases: "TB-500 + BPC-157 + KPV", category: "Blends", substanceClass: "mass", storageNotes: RECON_FRIDGE },
  { name: "Neuroxelin", aliases: "Selank + Semax + others (nootropic blend)", category: "Blends", substanceClass: "mass", storageNotes: RECON_FRIDGE },
];
