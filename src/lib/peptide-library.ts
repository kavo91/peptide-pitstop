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
  /**
   * Blend composition in mg per vial, for blends whose split is fixed and known.
   * Present ⇒ the plasma chart draws one curve per component (each decaying on
   * its OWN half-life) instead of a single composite line, because a blend has no
   * meaningful single half-life — KLOW's GHK-Cu clears in ~1 h while its TB-500
   * persists for days. Component names must match a library entry by name/alias.
   * Omit unless the mg split is actually known; a guessed ratio is worse than one
   * honest composite line.
   */
  components?: { name: string; mg: number }[];
}

/**
 * Canonical library half-life lookup: case-insensitive, matching on the entry's
 * canonical name OR any of its aliases, in either direction (the query may itself
 * carry aliases, e.g. an owned Peptide row's `aliases` column).
 *
 * Returns null when the peptide is unknown OR when the library deliberately omits
 * a half-life (Epitalon, KLOW, MOTS-c) — callers must treat null as "no estimate
 * available", not "zero".
 *
 * Single source of truth: the same semantics were previously reimplemented in
 * src/lib/stacks/server.ts and src/app/settings/page.tsx. Those still hold their
 * own copies; point them here when next touched.
 */
function libraryEntry(name: string, aliases?: string | null): LibraryPeptide | null {
  const tokens = (n: string, a?: string | null) =>
    [n, ...(a ?? "").split(",")].map((s) => s.trim().toLowerCase()).filter(Boolean);

  const wanted = tokens(name, aliases);
  if (wanted.length === 0) return null;

  return (
    PEPTIDE_LIBRARY.find((e) => tokens(e.name, e.aliases).some((t) => wanted.includes(t))) ?? null
  );
}

export function libraryHalfLifeHours(name: string, aliases?: string | null): string | null {
  return libraryEntry(name, aliases)?.halfLifeHours ?? null;
}

/**
 * Blend composition (mg per vial) when the library knows it, else null.
 * Callers use this to split one blend dose into per-component doses by mass
 * fraction, so each component can decay on its own half-life.
 */
export function libraryComponents(
  name: string,
  aliases?: string | null,
): { name: string; mg: number }[] | null {
  const comps = libraryEntry(name, aliases)?.components;
  if (!comps || comps.length === 0) return null;
  // Guard the arithmetic: a non-positive total would make every fraction NaN/Inf.
  return comps.every((c) => Number.isFinite(c.mg) && c.mg > 0) ? comps : null;
}

const RECON_FRIDGE = "Lyophilised — reconstitute with BAC water; refrigerate, use within ~28 days.";
const GLP1_FRIDGE = "Refrigerate; protect from light. Reconstituted vials per label.";
const NAD_STORAGE =
  "Lyophilised — store frozen at −20 °C, protected from light. Reconstitute with BAC water; " +
  "refrigerate at 2–8 °C and use within ~14 days; avoid freeze–thaw cycles.";

export const PEPTIDE_LIBRARY: LibraryPeptide[] = [
  { name: "BPC-157", aliases: "Body Protection Compound 157", category: "Healing / recovery", substanceClass: "mass", halfLifeHours: "7", storageNotes: RECON_FRIDGE },
  // TB-500 (synthetic Ac-LKKTETQ fragment) and Thymosin Beta-4 (full 43-aa peptide) are
  // DIFFERENT compounds, routinely conflated by vendors. As one entry, a blend's
  // TB-500 rolls up into standalone TB-4 exposure and reports their sum against a
  // compound that was never taken on its own. Separate entries; must not alias each other.
  { name: "TB-500", aliases: "Ac-LKKTETQ, thymosin beta-4 fragment", category: "Healing / recovery", substanceClass: "mass", halfLifeHours: "2.5", storageNotes: RECON_FRIDGE },
  { name: "Thymosin Beta-4", aliases: "TB-4, TB4, Tβ4", category: "Healing / recovery", substanceClass: "mass", halfLifeHours: "2.5", storageNotes: RECON_FRIDGE },
  { name: "Thymosin Alpha-1", aliases: "Tα1, Thymalfasin", category: "Immune", substanceClass: "mass", halfLifeHours: "2", storageNotes: RECON_FRIDGE },
  { name: "GHK-Cu", aliases: "Copper peptide", category: "Cosmetic / healing", substanceClass: "mass", halfLifeHours: "1", storageNotes: RECON_FRIDGE },
  { name: "KPV", aliases: "Lys-Pro-Val, alpha-MSH (11-13)", category: "Anti-inflammatory", substanceClass: "mass", storageNotes: RECON_FRIDGE },
  { name: "Ipamorelin", category: "GH secretagogue", substanceClass: "mass", halfLifeHours: "2.5", storageNotes: RECON_FRIDGE },
  { name: "CJC-1295 (no DAC)", aliases: "CJC-1295 no-DAC, Mod GRF 1-29, Modified GRF (1-29)", category: "GH secretagogue", substanceClass: "mass", halfLifeHours: "0.5", storageNotes: RECON_FRIDGE },
  { name: "CJC-1295 (with DAC)", category: "GH secretagogue", substanceClass: "mass", halfLifeHours: "144", storageNotes: RECON_FRIDGE },
  { name: "Sermorelin", category: "GH secretagogue", substanceClass: "mass", halfLifeHours: "0.2", storageNotes: RECON_FRIDGE },
  { name: "Tesamorelin", category: "GH secretagogue", substanceClass: "mass", halfLifeHours: "0.5", storageNotes: RECON_FRIDGE },
  { name: "Semaglutide", aliases: "Ozempic, Wegovy", category: "GLP-1", substanceClass: "mass", halfLifeHours: "168", storageNotes: GLP1_FRIDGE },
  { name: "Tirzepatide", aliases: "Mounjaro, Zepbound", category: "GLP-1 / GIP", substanceClass: "mass", halfLifeHours: "120", storageNotes: GLP1_FRIDGE },
  { name: "Retatrutide", category: "GLP-1 / GIP / glucagon", substanceClass: "mass", halfLifeHours: "144", storageNotes: GLP1_FRIDGE },
  { name: "PT-141", aliases: "Bremelanotide", category: "Sexual health", substanceClass: "mass", halfLifeHours: "2.7", storageNotes: RECON_FRIDGE },
  { name: "Melanotan II", aliases: "MT-II", category: "Pigmentation", substanceClass: "mass", halfLifeHours: "1", storageNotes: RECON_FRIDGE },
  { name: "MOTS-c", category: "Metabolic / mitochondrial", substanceClass: "mass", storageNotes: RECON_FRIDGE },
  { name: "SS-31", aliases: "Elamipretide, Bendavia, MTP-131", category: "Mitochondria-targeting (cardiolipin-binding)", substanceClass: "mass", halfLifeHours: "4", storageNotes: RECON_FRIDGE },
  { name: "Epitalon", aliases: "Epithalon", category: "Longevity", substanceClass: "mass", storageNotes: RECON_FRIDGE },
  { name: "Selank", category: "Nootropic", substanceClass: "mass", halfLifeHours: "0.5", storageNotes: RECON_FRIDGE },
  { name: "Semax", category: "Nootropic", substanceClass: "mass", halfLifeHours: "0.5", storageNotes: RECON_FRIDGE },
  { name: "HCG", aliases: "Human Chorionic Gonadotropin", category: "Hormonal", substanceClass: "IU", halfLifeHours: "33", storageNotes: RECON_FRIDGE },
  { name: "Somatropin (HGH)", aliases: "Human Growth Hormone", category: "Growth hormone", substanceClass: "IU", halfLifeHours: "3", storageNotes: RECON_FRIDGE },

  // Manually-curated hybrid entry (see enrichment/manual-entries.ts): the mix
  // (reconstitution) is sourced from peptidedosages.com and the titration/protocol
  // ramp from alpha-rejuvenation.com. Deliberately NOT in SLUG_MAP so the weekly
  // re-scrape can't overwrite that curated titration. Half-life "5" is an
  // APPROXIMATE reference midpoint (subQ) — human PK is formally unstudied, but
  // reference sources converge on ~4–6 h subQ / ~3.8–6.9 h plasma; consistent with
  // the whole library's "approximate reference, PK often debated" convention above.
  { name: "5-Amino-1MQ", aliases: "5-Amino-1-methylquinolinium, 5A1MQ, 5-Amino-1MQ iodide", category: "Metabolic / NAD+", substanceClass: "mass", halfLifeHours: "5", storageNotes: RECON_FRIDGE },

  // Manually-curated hybrid entry (see enrichment/manual-entries.ts): mix +
  // subQ titration ramp from peptidedosages.com, pharmacology and every
  // literature reference from PubMed-indexed sources.
  //
  // Half-life "0.25" (~15 min) is a MODELLING PLACEHOLDER, not a pharmacokinetic
  // claim. Read this before quoting it anywhere:
  //
  //   * NO human study establishes a plasma half-life, clearance or volume of
  //     distribution for exogenous NAD+ BY ANY ROUTE, and none exists for the
  //     subcutaneous route at all. Vendor/clinic half-life figures for NAD+ are
  //     unsupported by published human data. (Independently verified 3-0 against
  //     the primary literature, 2026-08-16.)
  //   * The nearest evidence is Grant 2019 (PMID 31572171): 750 mg IV over 6 h at
  //     3 µmol/min in 8 exposed males, in which plasma NAD+ and its metabolites
  //     showed no detectable rise for the first 2 h — the authors infer removal
  //     about as fast as delivery — but by 6 h plasma NAD+ was ~398% above
  //     baseline as clearance capacity saturated. Clearance is capacity-limited,
  //     not first-order, so a single scalar t½ is the wrong shape for NAD+.
  //   * That finding is also rate-specific and IV. Extrapolating it to a subQ
  //     bolus is exactly the move the verification pass flagged as unsupported.
  //
  // So this number exists only to give the plasma chart something finite to draw
  // for the intact dinucleotide, and the entry says so in dosingReference. The
  // library's own convention would be to OMIT it (as Epitalon/MOTS-c/KPV do) —
  // that remains the more honest option and is a one-line change. It is kept
  // because the value was explicitly requested; prefer omitting it to shipping it
  // anywhere it could be read as a measured PK parameter.
  { name: "NAD+", aliases: "Nicotinamide Adenine Dinucleotide, NAD, Coenzyme I, Diphosphopyridine nucleotide", category: "Metabolic / NAD+", substanceClass: "mass", halfLifeHours: "0.25", storageNotes: NAD_STORAGE },

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
  { name: "KLOW", aliases: "GHK-Cu + KPV + BPC-157 + TB-500", category: "Blends", substanceClass: "mass", storageNotes: RECON_FRIDGE,
    components: [{ name: "GHK-Cu", mg: 50 }, { name: "BPC-157", mg: 10 }, { name: "TB-500", mg: 10 }, { name: "KPV", mg: 10 }] },
  { name: "Tri-Heal", aliases: "TB-500 + BPC-157 + KPV", category: "Blends", substanceClass: "mass", storageNotes: RECON_FRIDGE },
  { name: "Neuroxelin", aliases: "Selank + Semax + others (nootropic blend)", category: "Blends", substanceClass: "mass", storageNotes: RECON_FRIDGE },
];
