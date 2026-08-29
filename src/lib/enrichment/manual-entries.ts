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
 * cited sources. Not medical advice and not a recommendation. Every entry
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
  {
    // Hybrid: MIX (reconstitution) and the subQ TITRATION ramp from
    // peptidedosages.com's 500 mg / 1000 mg NAD+ vial pages (both pages give the
    // same 50 → 75 → 100 mg daily ramp and the same 3.0 mL BAC water mix);
    // PHARMACOLOGY + every literature reference from PubMed-indexed sources,
    // because peptidedosages publishes no PK for NAD+.
    //
    // Evidence posture, deliberately explicit: NAD+ is the only entry in this
    // file whose ROUTE is not the route its human evidence was collected on. The
    // one published human parenteral study is a 6 h IV infusion (Grant 2019);
    // there is NO published human subcutaneous PK, and the subQ dose ladder below
    // is educational/practitioner practice, not a trial-backed protocol. The
    // benefits list therefore separates precursor-trial findings (NR / NMN /
    // nicotinamide, where human RCT data exist) from direct-NAD+ claims (where
    // they do not).
    name: "NAD+",
    aliases: "Nicotinamide Adenine Dinucleotide, NAD, Coenzyme I, Diphosphopyridine nucleotide",
    benefits: [
      "Central redox coenzyme (NAD+/NADH) in glycolysis, the TCA cycle and oxidative phosphorylation, and the substrate consumed by sirtuins, PARPs and CD38.",
      "Tissue NAD+ availability falls with age; restoring it improves glucose and lipid metabolism, attenuates hepatic steatosis and extends health span in animal models (Endocrine Reviews, 2023).",
      "The human evidence for raising NAD+ sits almost entirely with ORAL PRECURSORS, not with injected NAD+: a single 1,000 mg oral dose of nicotinamide riboside raised PBMC NAD+ from ~12 to ~18 µM (~90% higher 24 h AUC, n=12 randomised crossover), and 14 days of dosing raised whole-blood NAD+ by 22%, 51% and 142% at 100, 300 and 1,000 mg/day (n=140 randomised placebo-controlled).",
      "Oral NMN 250 mg/day for 12 weeks raised whole-blood NAD+ versus placebo in 30 healthy adults, with levels back at baseline 4 weeks after stopping — the effect does not persist once dosing ends.",
      "Reported by clinics for fatigue, mental clarity, recovery and craving reduction after IV infusion — these are practitioner reports, not findings from controlled human trials.",
      "Direct evidence for injected NAD+ in humans is one 6 h IV infusion pilot (8 exposed males) that measured metabolite handling, and one retrospective 14-client clinic chart review of tolerability. Neither measured a clinical outcome, so nothing here establishes that raising NAD+ by any route produces a health, cognitive or longevity benefit.",
      "Compartment caveat: blood/PBMC NAD+ is not tissue NAD+. Oral NR has repeatedly failed to raise skeletal-muscle NAD+ in humans, so a blood-level rise must not be read as tissue repletion.",
    ],
    sideEffects: [
      "IV NAD+ is poorly tolerated in the one published tolerability series: 6 of 6 clients given 500 mg IV reported moderate-to-severe abdominal cramping, diarrhoea, nausea, vomiting, raised heart rate, throat pain, congestion and chest pressure during the infusion, resolving immediately on completion (retrospective n=14 chart review authored by employees of the clinic that generated the data — weak evidence, disclosed).",
      "The burden appears to track infusion rate: with clients setting their own rate to tolerance, 500 mg of NAD+ took 97 ± 56 min to infuse versus 37 ± 13 min for the same dose of nicotinamide riboside (p < 0.05).",
      "Educational subcutaneous sources report insomnia, anxiety or fatigue when the dose is escalated quickly, and mild injection-site reactions (redness, itching, soreness). These are vendor reports; no trial has studied subcutaneous NAD+.",
      "Long-term human safety data for parenteral NAD+ are not established; total published human exposure is a handful of people over days.",
      "High-dose oral nicotinamide (a related NAD+ precursor) raised plasma methyl-nicotinamide more than 600-fold in a phase 2a trial, indicating a large methylation load (Alzheimer's Res Ther, 2025).",
      "Purity and endotoxin content vary by supplier; third-party-tested material is preferable for anything injected.",
    ],
    dosingReference:
      "NAD+ is dosed at 50 mg–100 mg daily by subcutaneous injection in vendor protocols, titrated 50 mg (week 1) → 75 mg (week 2) → 100 mg (weeks 3–16), escalating by roughly 25 mg per week as tolerated. Two intravenous regimens appear in the published record: 750 mg in normal saline over 6 h at ~2 mg/min (3 µmol/min) in the 2019 pilot, and 500 mg diluted into 500 mL normal saline on four consecutive days with the rate self-titrated by the client in the 2026 clinic series. Every quantitative IV finding is bound to its infusion rate and none of it transfers to faster clinic pushes or to subcutaneous injection. Oral NAD+ is hydrolysed before absorption and is poorly bioavailable as the intact dinucleotide, which is why oral regimens use precursors (NR, NMN, nicotinamide) instead. No published human study characterises subcutaneous NAD+ pharmacokinetics, dose ranges, titration schedules, reconstitution volumes or beyond-use dating — the subQ ladder below is vendor convention, not trial evidence. This information is for research and educational use only.",
    reconstitution: [
      "Vendor convention, not a published standard — no peer-reviewed source establishes reconstitution volumes, resulting concentrations or beyond-use dating for lyophilised NAD+.",
      "Allow the lyophilised vial to reach room temperature before opening (limits moisture condensation).",
      "Draw 3.0 mL bacteriostatic water with a sterile syringe.",
      "Inject slowly down the vial wall; do not aim at the powder, and avoid foaming.",
      "Gently swirl/roll until dissolved — solution should be clear (do not shake).",
      "500 mg vial + 3.0 mL yields ~166.7 mg/mL; a 1000 mg vial + 3.0 mL yields ~333.3 mg/mL.",
      "Label and refrigerate at 2–8 °C (35.6–46.4 °F), protected from light; the source gives a 14-day beyond-use date. Store the unreconstituted powder frozen at −20 °C and avoid freeze–thaw cycles.",
    ],
    reconstitutionRatio: "3 mL = ~166.7 mg/mL",
    mechanism:
      "NAD+ (nicotinamide adenine dinucleotide) is a pyridine dinucleotide with two distinct roles. As a redox cofactor it cycles between NAD+ and NADH to carry electrons through glycolysis, the TCA cycle, fatty-acid oxidation and oxidative phosphorylation. As a consumed substrate it is cleaved by sirtuins (SIRT1–7, deacetylation), PARPs (DNA repair), the ectoenzymes CD38/CD157, and SARM1 (axonal degeneration) — each of these reactions destroys an NAD+ molecule and releases nicotinamide, which the NAMPT-dependent salvage pathway recycles back to NAD+. Exogenous NAD+ is not taken up intact by most cells: cell-surface ectoenzymes (CD38, ENPP1, CD73) hydrolyse it to NMN, NR and nicotinamide, which cross the membrane and are re-synthesised into intracellular NAD+. The single human infusion study is consistent with that extracellular-first metabolism, and its shape matters: during a 750 mg / 6 h IV infusion at 3 µmol/min there was no detectable rise above baseline in plasma NAD+, nicotinamide, methylnicotinamide, ADP-ribose or NMN for the first two hours — the authors infer that the infused dinucleotide was removed from plasma about as fast as it arrived, and note the arriving dose should have added at least 18 µM every 30 min, well above their detection limit. By 6 h, however, plasma NAD+ was ~398% above baseline with parallel rises in nicotinamide (409%) and ADP-ribose (393%), which the authors read as clearance capacity saturating and as evidence that a major fate of infused NAD+ is glycosidic cleavage to nicotinamide + ADP-ribose rather than intact circulation. Clearance is therefore capacity-limited rather than first-order, and every one of these numbers is specific to that infusion rate — none of it has been shown to transfer to faster infusions or to subcutaneous injection.",
    templates: [
      {
        name: "Standard / Gradual Approach (subcutaneous titration)",
        doseBasis: "per_injection",
        targetDose: 100,
        unit: "mg",
        frequency: "Once daily subcutaneous",
        ramp: [
          { phase: "Week 1 (tolerance)", dose: 50, unit: "mg", doseLabel: "50 mg" },
          { phase: "Week 2 (step-up)", dose: 75, unit: "mg", doseLabel: "75 mg" },
          { phase: "Weeks 3–16 (standard)", dose: 100, unit: "mg", doseLabel: "100 mg" },
        ],
      },
    ],
    references: [
      {
        label:
          "Front Aging Neurosci (2019) — Grant et al.: 750 mg IV NAD+ over 6 h at 3 µmol/min in 8 exposed males; no detectable plasma rise for 2 h, then ~398% at 6 h as clearance saturates (the only published human parenteral NAD+ PK study)",
        url: "https://pubmed.ncbi.nlm.nih.gov/31572171/",
      },
      {
        label:
          "Front Aging (2026) — retrospective clinic series: 500 mg IV NAD+ vs 500 mg IV nicotinamide riboside over four consecutive days; NAD+ took 97 ± 56 min to infuse vs 37 ± 13 min, with moderate-to-severe symptoms in all six NAD+ recipients (n=14, authored by clinic employees)",
        url: "https://doi.org/10.3389/fragi.2026.1652582",
      },
      {
        label:
          "Nat Commun (2016) — Trammell et al.: nicotinamide riboside is orally bioavailable in humans; single 1,000 mg dose raised PBMC NAD+ ~12 → ~18 µM (n=12 randomised crossover)",
        url: "https://doi.org/10.1038/ncomms12948",
      },
      {
        label:
          "Sci Rep (2019) — Conze, Brenner & Kruger: 8-week randomised placebo-controlled NR trial (n=140); whole-blood NAD+ up 22 / 51 / 142% at 100 / 300 / 1,000 mg/day",
        url: "https://doi.org/10.1038/s41598-019-46120-z",
      },
      {
        label:
          "Front Nutr (2022) — oral NMN 250 mg/day for 12 weeks raised whole-blood NAD+ vs placebo in 30 healthy adults, returning to baseline 4 weeks after cessation",
        url: "https://doi.org/10.3389/fnut.2022.868640",
      },
      {
        label:
          "Endocrine Reviews (2023) — Bhasin et al.: NAD+ in aging biology — clinical pharmacology of NAD+ precursors, what human trials do and do not show",
        url: "https://doi.org/10.1210/endrev/bnad019",
      },
      {
        label: "Nutrients (2020) — Mehmel et al.: nicotinamide riboside — research state, bioavailability and safety",
        url: "https://doi.org/10.3390/nu12061616",
      },
      {
        label:
          "Free Radic Biol Med (2023) — Li et al.: head-to-head acute human comparison of NAD+ precursors (nicotinamide, niacin, NR, NMN) on the plasma metabolome",
        url: "https://doi.org/10.1016/j.freeradbiomed.2023.05.032",
      },
      {
        label:
          "Alzheimer's Res Ther (2025) — Ketron et al.: phase 2a PK/PD of high-dose oral nicotinamide — plasma nicotinamide up >130-fold, methyl-nicotinamide up >600-fold, CSF levels below quantitation in most participants",
        url: "https://doi.org/10.1186/s13195-025-01693-y",
      },
      {
        label: "Antioxidants (2021) — Rotllan et al.: NAD+-increasing strategies in cardiovascular disease",
        url: "https://doi.org/10.3390/antiox10121939",
      },
      {
        label: "Mix / reconstitution + subQ titration reference — peptidedosages.com NAD+ (500 mg vial) dosage protocol",
        url: "https://peptidedosages.com/single-peptide-dosages/nad-500-mg-10ml-vial-dosage-protocol/",
      },
      {
        label: "Mix / reconstitution reference — peptidedosages.com NAD+ (1000 mg vial) dosage protocol",
        url: "https://peptidedosages.com/single-peptide-dosages/nad-1000-mg-vial-dosage-protocol/",
      },
    ],
    source: "peptidedosages.com",
    sourceUrl: "https://peptidedosages.com/single-peptide-dosages/nad-500-mg-10ml-vial-dosage-protocol/",
    attribution:
      "Mix / reconstitution and the subcutaneous titration ramp from peptidedosages.com; pharmacology, pharmacokinetics and all literature references from PubMed-indexed sources (see references). Reference only — not medical advice.",
    curatedAt: "2026-08-16T00:00:00.000Z",
  },
];
