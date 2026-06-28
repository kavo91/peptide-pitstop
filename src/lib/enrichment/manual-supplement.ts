/**
 * Manual enrichment supplement layer.
 *
 * The scraped peptidedosages.com data is genuinely thin for a couple of peptides
 * (the source section lists only ~2 benefits each). This module supplies a
 * curated, reference-framed override for the two LIST fields that are thin —
 * `benefits` and `sideEffects` — merged at READ TIME over BOTH the seed JSON and
 * any refreshed DB row (PeptideReference). Because the merge happens on read, the
 * curated content survives the weekly re-scrape (`POST /api/enrichment/refresh`),
 * which would otherwise overwrite an edited seed.
 *
 * REFERENCE ONLY — observational, preclinical/early-research framing. No dose
 * numbers live here (the existing `dosingReference` + `templates` own dosing).
 * Nothing here is medical advice; the UI disclaimer/attribution is unchanged.
 *
 * Keyed by the canonical PEPTIDE_LIBRARY name; matched case-insensitively by the
 * entry's own `name` (see {@link applySupplement}).
 */

import type { EnrichmentEntry } from "../peptide-enrichment";

/**
 * Curated override for the two thin list fields. Only the fields present here are
 * replaced; everything else on the entry is kept verbatim.
 */
export interface ManualSupplement {
  /** Full curated benefits — reference observations, NOT promises. */
  benefits?: string[];
  /** Full curated side-effects / cautions — "to watch" framing. */
  sideEffects?: string[];
}

/**
 * Curated supplements keyed by canonical PEPTIDE_LIBRARY name.
 *
 * All entries are framed as reference/observational findings from
 * preclinical/early-research literature — never therapeutic claims.
 */
export const MANUAL_SUPPLEMENT: Record<string, ManualSupplement> = {
  "BPC-157": {
    benefits: [
      "Promotes healing of tendon, ligament, and muscle injuries in animal models.",
      "Supports gastrointestinal mucosal protection and ulcer healing (preclinical).",
      "Accelerates angiogenesis and blood-vessel formation around injury sites (preclinical).",
      "Modulates the nitric-oxide system and growth-factor signalling involved in repair.",
      "Shows cytoprotective and anti-inflammatory effects across preclinical models.",
      "May support tendon-to-bone and rotator-cuff healing (animal / early-research data).",
      "Investigated for gut-brain axis and neuroprotective effects in animal studies.",
    ],
    sideEffects: [
      "Mild injection-site reactions (redness, itch, swelling) can occur.",
      "Long-term human safety is not established — it remains a research peptide.",
      "Theoretical concern around promoting angiogenesis where unwanted (e.g. tumours) — caution with a cancer history.",
      "Not approved for human therapeutic use in most jurisdictions.",
      "Quality and purity vary by source — use third-party-tested material.",
    ],
  },
  "TB-500": {
    benefits: [
      "Promotes cell migration and tissue repair via actin regulation (preclinical).",
      "Supports wound healing and angiogenesis in injury models (preclinical).",
      "May reduce inflammation and fibrosis / scarring in animal injury studies.",
      "Improves flexibility and recovery of muscle and tendon injuries (animal data).",
      "Investigated for cardiac tissue repair after ischaemic injury (preclinical).",
      "Supports hair-follicle and skin-repair pathways in preclinical research.",
      "May aid corneal and dermal wound healing in early-research models.",
    ],
    sideEffects: [
      "Limited human clinical data — veterinary / animal evidence dominates.",
      "Possible mild lethargy or head-rush reported anecdotally.",
      "Pro-angiogenic — theoretical caution with active malignancy.",
      "Banned in competitive sport (WADA prohibited list).",
      "Injection-site reactions are possible.",
      "Research peptide — not an approved human therapeutic.",
    ],
  },
};

/**
 * Apply the curated supplement (if any) over a resolved enrichment entry.
 *
 * Pure. Matches by the entry's own `name`, case-insensitively (supplements are
 * keyed by canonical name). When a supplement exists, returns a NEW entry whose
 * `benefits` / `sideEffects` are REPLACED by the supplement's arrays when
 * provided — the curated list is the "full" version and subsumes the thin
 * scraped two. All other fields (dosingReference, mechanism, templates,
 * references, reconstitution, source, attribution, …) are kept verbatim.
 *
 * No supplement for the entry → the entry is returned unchanged (same reference).
 */
export function applySupplement(entry: EnrichmentEntry): EnrichmentEntry {
  const want = entry.name.trim().toLowerCase();
  const key = Object.keys(MANUAL_SUPPLEMENT).find((k) => k.toLowerCase() === want);
  if (!key) return entry;

  const supplement = MANUAL_SUPPLEMENT[key];
  return {
    ...entry,
    benefits: supplement.benefits ?? entry.benefits,
    sideEffects: supplement.sideEffects ?? entry.sideEffects,
  };
}
