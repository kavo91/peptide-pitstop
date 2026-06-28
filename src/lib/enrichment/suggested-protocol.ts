/**
 * Synthesize a *suggested* protocol template from an enrichment entry's free-text
 * `dosingReference`, for the flat-dosed peptides that ship with `templates: []`
 * (GHK-Cu, CJC-1295 DAC, Epitalon, HCG, Melanotan II, Semaglutide, Somatropin,
 * Tesamorelin). Pure parsing/shaping — no I/O, no dosing maths.
 *
 * SAFETY: the synthesized dose is always the LOW end of the published range and
 * always expressed `per_injection` (never a per_week division). It is a
 * conservative, illustrative starting point lifted verbatim from the reference —
 * REFERENCE ONLY, never a prescription. The attribution / "not medical advice"
 * framing lives with the UI that renders it.
 */
import type { EnrichmentEntry, EnrichmentTemplate } from "../peptide-enrichment";

export interface ParsedDose {
  /** Low end of the published range (the conservative figure we synthesize from). */
  doseLow: number;
  /** High end of the range, or null for a single-value dose. */
  doseHigh: number | null;
  /** Unit of the LOW end (range ends can differ — we anchor on the low end). */
  unit: "mcg" | "mg" | "iu";
  /** The trailing frequency phrase, e.g. "5 days/week", "weekly", "daily". */
  frequency: string;
}

/** Normalise a unit token to the canonical mcg|mg|iu, or null if unrecognised. */
function normUnit(raw: string): "mcg" | "mg" | "iu" | null {
  const u = raw.trim().toLowerCase();
  if (u === "mcg") return "mcg";
  if (u === "mg") return "mg";
  if (u === "iu") return "iu";
  return null;
}

// A dose token: a number followed by a mcg|mg|iu unit (case-insensitive on iu).
const DOSE = "([\\d.]+)\\s*(mcg|mg|iu)";

/**
 * Parse a free-text dosing reference into a structured low/high/unit/frequency.
 *
 * Strategy: anchor on "dosed at", read the LOW dose token (value + unit), then an
 * optional range (en-dash or hyphen) + high dose token, then the frequency
 * phrase — everything up to the first of "by"/"via"/"subcutaneous"/"."/end.
 *
 *   "... dosed at 1 mg-2 mg 5 days/week by subcutaneous ..."   -> 1 mg / 2 mg / "5 days/week"
 *   "... dosed at 250 mcg-2.4 mg weekly via subcutaneous ..."  -> 250 mcg (low-end unit) / "weekly"
 *   "... dosed at 500 IU weekly via subcutaneous ..."          -> 500 iu / null / "weekly"
 *   "... dosed at 200 mcg-600 mcg daily ..."                   -> 200 mcg / 600 mcg / "daily"
 *   "... dosed at 2 mg weekly ..."                             -> 2 mg / null / "weekly"
 *
 * Returns null when no dose is parseable.
 */
export function parseDosingReference(ref: string | null): ParsedDose | null {
  if (!ref) return null;

  // Anchor on "dosed at " when present; otherwise scan from the start.
  const atIdx = ref.toLowerCase().indexOf("dosed at ");
  const tail = atIdx >= 0 ? ref.slice(atIdx + "dosed at ".length) : ref;

  // Low-end dose token.
  const low = new RegExp(`^\\s*${DOSE}`, "i").exec(tail);
  if (!low) return null;
  const doseLow = Number(low[1]);
  const unit = normUnit(low[2]);
  if (!Number.isFinite(doseLow) || unit === null) return null;

  // Everything after the low dose token.
  let rest = tail.slice(low.index + low[0].length);

  // Optional range: (en-dash | em-dash | hyphen) + a high dose token.
  let doseHigh: number | null = null;
  const range = new RegExp(`^\\s*[–—-]\\s*${DOSE}`, "i").exec(rest);
  if (range) {
    const hi = Number(range[1]);
    if (Number.isFinite(hi)) doseHigh = hi;
    rest = rest.slice(range.index + range[0].length);
  }

  // Frequency phrase: everything up to the first dosing-route / sentence boundary.
  // We cut at " by ", " via ", "subcutaneous", "intramuscular", or end-of-sentence.
  const freqRaw = rest
    .replace(/\s+(?:by|via)\b.*$/i, "")
    .replace(/\bsubcutaneous(ly)?\b.*$/i, "")
    .replace(/\bintramuscular(ly)?\b.*$/i, "")
    .replace(/[.;].*$/, "")
    .trim();
  if (!freqRaw) return null;

  return { doseLow, doseHigh, unit, frequency: freqRaw };
}

/**
 * Build ONE non-titration suggested template from an entry, but ONLY when the
 * entry has no real templates and its dosing reference parses. The dose is the
 * conservative LOW end, expressed `per_injection`. Returns null otherwise.
 */
export function synthesizedTemplate(entry: EnrichmentEntry): EnrichmentTemplate | null {
  if (entry.templates.length > 0) return null;
  const parsed = parseDosingReference(entry.dosingReference);
  if (!parsed) return null;

  return {
    name: "Suggested protocol (from reference)",
    doseBasis: "per_injection",
    targetDose: parsed.doseLow,
    unit: parsed.unit,
    frequency: parsed.frequency,
    ramp: undefined,
  };
}

/**
 * The templates the UI should actually offer for an entry: the real curated
 * templates when present, otherwise the single synthesized one (or [] when
 * neither is available).
 */
export function effectiveTemplates(entry: EnrichmentEntry): EnrichmentTemplate[] {
  if (entry.templates.length) return entry.templates;
  const synth = synthesizedTemplate(entry);
  return synth ? [synth] : [];
}
