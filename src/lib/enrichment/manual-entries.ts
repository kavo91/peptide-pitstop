/**
 * Manual enrichment ENTRIES layer.
 *
 * Sibling to {@link ./manual-supplement.ts}. Where the supplement layer overrides
 * only the two thin LIST fields (benefits/sideEffects) on an existing scraped
 * entry, this layer supplies WHOLE enrichment entries for peptides that the
 * scrape pipeline can't (or shouldn't) own:
 *
 *   - peptides absent from peptidedosages.com's SLUG_MAP, or
 *   - "hybrid" entries curated from more than one source, where the mix comes
 *     from one page and the titration/protocol from another.
 *
 * These entries are folded into the seed at read time (see mergeManualEntries in
 * ../peptide-enrichment.ts): a manual entry REPLACES a seed entry that shares a
 * token, otherwise it is appended. Because the merge happens on read, manual
 * entries survive BOTH the weekly re-scrape (`POST /api/enrichment/refresh`,
 * which only upserts SLUG_MAP peptides) AND a full seed regeneration
 * (`scripts/scrape-peptidedosages.mjs`, which rewrites the seed from SLUG_MAP +
 * BLEND_SLUG_MAP only). A hand-added seed JSON entry would be silently dropped by
 * either; a manual entry here is durable.
 *
 * REFERENCE ONLY — dose numbers are educational reference figures lifted from the
 * cited sources. Not medical advice, not for anyone but the operator. Every entry
 * still carries source attribution + a source URL and passes the same seed
 * integrity + template-consistency tests as the scraped entries.
 */

import type { EnrichmentEntry } from "../peptide-enrichment";

/**
 * Whole enrichment entries curated by hand. Each must satisfy the EnrichmentEntry
 * contract AND the seed-integrity tests: `source` === "peptidedosages.com",
 * `sourceUrl` under https://peptidedosages.com/, `attribution` mentions
 * peptidedosages.com, `curatedAt` an ISO timestamp, and every ramp `dose` matches
 * its `doseLabel`. `name` must match a PEPTIDE_LIBRARY entry exactly.
 */
export const MANUAL_ENTRIES: EnrichmentEntry[] = [
  {
    // Hybrid: MIX (reconstitution) from peptidedosages.com's 10 mg vial page;
    // TITRATION/PROTOCOL ramp from alpha-rejuvenation.com's dosing guide. The two
    // sources agree on the mix (10 mg + 2.0 mL BAC water = 5 mg/mL) but diverge on
    // the subQ dose scale; per the curation brief the titration follows the
    // alpha-rejuvenation subQ ramp (150 → 300 → 500 mcg), not the peptidedosages
    // mg-scale figure. NNMT inhibitor (NAD+ / metabolic).
    name: "5-Amino-1MQ",
    aliases: "5-Amino-1-methylquinolinium, 5A1MQ, 5-Amino-1MQ iodide",
    benefits: [
      "Selective NNMT inhibitor investigated for metabolic flexibility and mitochondrial function (preclinical).",
      "May support reductions in fat mass while preserving lean muscle in animal models.",
      "Associated with elevated NAD+ levels and SIRT1 activation in preclinical studies.",
      "Enhanced grip strength observed in aged mice when combined with exercise (animal data).",
      "Suppresses lipogenesis in adipocytes without reducing food intake in obese-mouse models (preclinical).",
    ],
    sideEffects: [
      "Generally well tolerated in educational reports; occasional mild headache, transient jitteriness, or injection-site reactions.",
      "Long-term human safety data are not established — this compound remains investigational.",
      "Educational sources list populations to avoid, including pregnancy/breastfeeding, cardiovascular disease, severe organ dysfunction, eating disorders, and age under 21.",
      "Doses above ~500 mcg subQ are associated with overstimulation in educational reports; purity varies by source, so third-party-tested material is preferable.",
    ],
    dosingReference:
      "5-Amino-1MQ is dosed at 150 mcg–500 mcg daily via subcutaneous injection in educational protocols, titrated 150 → 300 → 500 mcg over roughly 8–12 weeks; an oral capsule route (50 mg–100 mg daily) has substantially lower bioavailability. This information is for research and educational use only.",
    reconstitution: [
      "Allow the lyophilised vial to reach room temperature (~15–20 min).",
      "Draw 2.0 mL bacteriostatic water with a sterile syringe.",
      "Inject slowly down the vial wall; avoid foaming.",
      "Gently swirl/roll until dissolved — solution should be clear (do not shake).",
      "Label and refrigerate at 2–8 °C (35.6–46.4 °F), protected from light; use within 2–4 weeks.",
    ],
    reconstitutionRatio: "2 mL = ~5.0 mg/mL",
    mechanism:
      "5-Amino-1MQ (5-amino-1-methylquinolinium) is a synthetic small molecule that selectively inhibits Nicotinamide N-methyltransferase (NNMT). NNMT is a cytosolic enzyme that methylates nicotinamide (vitamin B3) using S-adenosylmethionine (SAM) as a methyl donor. By inhibiting NNMT, 5-Amino-1MQ may spare nicotinamide for NAD+ synthesis via the salvage pathway, thereby activating SIRT1 (Sirtuin 1) pathways associated with mitochondrial biogenesis, fat oxidation, and metabolic flexibility. Altered SAM/SAH ratios from reduced methylation flux may also modulate broader cellular methylation dynamics.",
    templates: [
      {
        name: "Standard / Gradual Approach (subcutaneous titration)",
        doseBasis: "per_injection",
        targetDose: 500,
        unit: "mcg",
        frequency: "Once daily subcutaneous, morning/fasted (top phase split 250 mcg AM + 250 mcg PM)",
        ramp: [
          { phase: "Weeks 1–2 (tolerance)", dose: 150, unit: "mcg", doseLabel: "150 mcg (0.15 mg)" },
          { phase: "Weeks 3–8 (standard)", dose: 300, unit: "mcg", doseLabel: "300 mcg (0.3 mg)" },
          {
            phase: "Weeks 9–12 (advanced)",
            dose: 500,
            unit: "mcg",
            doseLabel: "500 mcg (0.5 mg) — split 250 mcg AM / 250 mcg PM",
          },
        ],
      },
    ],
    references: [
      {
        label: "Nature Medicine (2014) — NNMT knockdown protects against diet-induced obesity",
        url: "https://pubmed.ncbi.nlm.nih.gov/24717514/",
      },
      {
        label: "Biochemical Pharmacology (2018) — Neelakantan et al.: selective, membrane-permeable NNMT inhibitors reverse high-fat-diet obesity in mice",
        url: "https://doi.org/10.1016/j.bcp.2018.10.012",
      },
      {
        label: "Frontiers in Pharmacology (2024) — NNMT: a novel therapeutic target for metabolic syndrome",
        url: "https://doi.org/10.3389/fphar.2024.1410479",
      },
      {
        label: "PMC (2024) — NNMT inhibition mitigates obesity-related metabolic dysfunctions",
        url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC11622326/",
      },
      {
        label: "Mix / reconstitution reference — peptidedosages.com 5-Amino-1MQ (10 mg vial) dosage protocol",
        url: "https://peptidedosages.com/single-peptide-dosages/5-amino-1mq-10-mg-vial-dosage-protocol/",
      },
      {
        label: "Titration / protocol reference — Alpha Rejuvenation 5-Amino-1MQ Dosage Guide (2025)",
        url: "https://alpha-rejuvenation.com/peptide-dosing/5-amino-1mq-dosage-guide/",
      },
      {
        label: "Overview / research guide reference — Peptide Protocol Wiki: 5-Amino-1MQ",
        url: "https://www.peptideprotocolwiki.com/peptides/5-amino-1mq",
      },
    ],
    source: "peptidedosages.com",
    sourceUrl: "https://peptidedosages.com/single-peptide-dosages/5-amino-1mq-10-mg-vial-dosage-protocol/",
    attribution:
      "Mix / reconstitution from peptidedosages.com; titration / protocol from alpha-rejuvenation.com; overview and references from peptideprotocolwiki.com. Reference only — not medical advice.",
    curatedAt: "2026-07-15T00:00:00.000Z",
  },
];
