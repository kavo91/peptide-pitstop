/**
 * Maps PEPTIDE_LIBRARY names to peptidedosages.com single-peptide page slugs.
 *
 * URL pattern (verified June 2026):
 *   https://peptidedosages.com/single-peptide-dosages/<slug>/
 *
 * Slugs are vial-size-specific (e.g. `bpc-157-5-mg-vial-dosage-protocol`). We
 * pick a representative standard vial per peptide and list fallbacks so the
 * scraper can try the next candidate if a slug 404s. Blend/stack pages are
 * deliberately excluded (single-peptide only).
 *
 * `name` matches PEPTIDE_LIBRARY exactly. `slugs[0]` is preferred; the rest are
 * tried in order. Peptides with no published single-peptide page are omitted.
 */

export const ENRICHMENT_BASE_URL = "https://peptidedosages.com/single-peptide-dosages";
/** Base for two-or-more-peptide blend pages (see BLEND_SLUG_MAP). */
export const BLEND_BASE_URL = "https://peptidedosages.com/peptide-blend-dosages";

export interface SlugTarget {
  /** PEPTIDE_LIBRARY name. */
  name: string;
  /** Candidate slugs (preferred first); the scraper tries each until one works. */
  slugs: string[];
  /**
   * Page base URL. Defaults to ENRICHMENT_BASE_URL (single-peptide pages). Blend
   * targets set this to BLEND_BASE_URL; the scraper also skips the blend/stack
   * guard for those (the page IS expected to be a blend).
   */
  base?: string;
}

export const SLUG_MAP: SlugTarget[] = [
  { name: "BPC-157", slugs: ["bpc-157-5-mg-vial-dosage-protocol", "bpc-157-10-mg-vial-dosage-protocol"] },
  { name: "TB-500", slugs: ["tb-500-5-mg-vial-dosage-protocol", "tb-500-10-mg-vial-dosage-protocol"] },
  {
    name: "Thymosin Alpha-1",
    slugs: ["thymosin-alpha-1-5-mg-vial-dosage-protocol", "thymosin-alpha-1-10-mg-vial-dosage-protocol"],
  },
  { name: "Ipamorelin", slugs: ["ipamorelin-5-mg-vial-dosage-protocol", "ipamorelin-10-mg-vial-dosage-protocol"] },
  {
    name: "CJC-1295 (no DAC)",
    slugs: ["cjc-1295-no-dac-5-mg-vial-dosage-protocol"],
  },
  {
    name: "CJC-1295 (with DAC)",
    slugs: ["cjc-1295-dac-2-mg-vial-dosage-protocol", "cjc-1295-dac-5-mg-vial-dosage-protocol"],
  },
  { name: "Sermorelin", slugs: ["sermorelin-5-mg-vial-dosage-protocol", "sermorelin-10-mg-vial-dosage-protocol"] },
  {
    name: "Tesamorelin",
    slugs: [
      "tesamorelin-5-mg-vial-dosage-protocol",
      "tesamorelin-10-mg-vial-dosage-protocol",
      "tesamorelin-20-mg-vial-dosage-protocol",
    ],
  },
  {
    name: "Semaglutide",
    slugs: [
      "semaglutide-5-mg-vial-dosage-protocol",
      "semaglutide-10-mg-vial-dosage-protocol",
      "semaglutide-20-mg-vial-dosage-protocol",
    ],
  },
  {
    name: "Tirzepatide",
    slugs: [
      "tirzepatide-10-mg-vial-dosage-protocol",
      "tirzepatide-5-mg-vial-dosage-protocol",
      "tirzepatide-15-mg-vial-dosage-protocol",
      "tirzepatide-30-mg-vial-dosage-protocol",
    ],
  },
  { name: "Retatrutide", slugs: ["retatrutide-20-mg-vial-dosage-protocol"] },
  { name: "PT-141", slugs: ["pt-141-10-mg-vial-dosage-protocol"] },
  { name: "Melanotan II", slugs: ["melanotan-ii-10-mg-vial-dosage-protocol"] },
  {
    name: "MOTS-c",
    slugs: [
      "mots-c-10-mg-vial-dosage-protocol",
      "mots-c-5-mg-vial-dosage-protocol",
      "mots-c-20-mg-vial-dosage-protocol",
    ],
  },
  { name: "Epitalon", slugs: ["epitalon-epithalon-10-mg-vial-dosage-protocol"] },
  { name: "Selank", slugs: ["selank-5-mg-vial-dosage-protocol", "selank-10-mg-vial-dosage-protocol"] },
  { name: "Semax", slugs: ["semax-5-mg-vial-dosage-protocol", "semax-10-mg-vial-dosage-protocol"] },
  { name: "HCG", slugs: ["hcg-5000-iu-vial-dosage-protocol"] },
  { name: "Somatropin (HGH)", slugs: ["hgh-191aa-10-iu-vial-dosage-protocol"] },
  { name: "GHK-Cu", slugs: ["ghk-cu-50-mg-vial-dosage-protocol", "ghk-cu-100-mg-vial-dosage-protocol"] },
];

/** Full URL for a slug under the given base (defaults to single-peptide pages). */
export function slugUrl(slug: string, base: string = ENRICHMENT_BASE_URL): string {
  return `${base}/${slug}/`;
}

/**
 * Multi-peptide blend pages (peptidedosages.com/peptide-blend-dosages/...).
 * `name` matches PEPTIDE_LIBRARY exactly (the "Blends" category). Vial-size
 * variants of the same blend are listed as fallback slugs under one entry.
 */
export const BLEND_SLUG_MAP: SlugTarget[] = [
  {
    name: "BPC-157 / TB-500",
    base: BLEND_BASE_URL,
    slugs: ["bpc-157-tb-500-10mg-blend-dosage-protocol", "bpc-157-tb-500-20mg-blend-dosage-protocol"],
  },
  {
    name: "CJC-1295 / Ipamorelin",
    base: BLEND_BASE_URL,
    slugs: ["cjc-1295-no-dac-ipamorelin-10-mg-blend-dosage-protocol"],
  },
  {
    name: "CJC-1295 / GHRP-2",
    base: BLEND_BASE_URL,
    slugs: ["cjc-1295-ghrp-2-10mg-blend-dosage-protocol"],
  },
  {
    name: "Tesamorelin / Ipamorelin",
    base: BLEND_BASE_URL,
    slugs: ["tesamorelin-5-mg-ipamorelin-5-mg-10-mg-blend-dosage-protocol"],
  },
  {
    name: "AOD-9604 / CJC-1295 / Ipamorelin",
    base: BLEND_BASE_URL,
    slugs: ["aod-9604-cjc-1295-ipamorelin-12mg-blend"],
  },
  {
    name: "Cagrilintide / Semaglutide",
    base: BLEND_BASE_URL,
    slugs: ["cagrilintide-glp-1s-10-mg-blend-dosage-protocol"],
  },
  {
    name: "GLOW",
    base: BLEND_BASE_URL,
    slugs: ["glow-peptide-blend-70-mg-vial-dosage-protocol"],
  },
  {
    name: "KLOW",
    base: BLEND_BASE_URL,
    slugs: ["klow-80-mg-vial-dosage-protocol"],
  },
  {
    name: "Tri-Heal",
    base: BLEND_BASE_URL,
    slugs: ["tri-heal-tb-500-25-mg-bpc-157-10-mg-kpv-10-mg-vial-dosage-protocol"],
  },
  {
    name: "Neuroxelin",
    base: BLEND_BASE_URL,
    slugs: ["neuroxelin-48-mg-vial-dosage-protocol"],
  },
];
