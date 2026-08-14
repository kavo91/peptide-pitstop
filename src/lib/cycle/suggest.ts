/**
 * Cycle-length SUGGESTION from the enrichment literature.
 *
 * Answers one question for the protocol form: "how long do published sources
 * run this compound before stopping?" — so the user is offered a planned stop
 * instead of having to invent one.
 *
 * Three tiers, most trustworthy first:
 *   1. `curated`  — an operator-curated override (CURATED_CYCLE_GUIDANCE, or an
 *                   explicit opts.curated). Ships EMPTY: numbers here must be
 *                   defensible, so the table is populated by hand, never guessed.
 *   2. `explicit` — the source states a cycling cadence in weeks
 *                   ("cycled in 4–8 week blocks", "8 weeks on, 4 weeks off").
 *   3. `derived`  — no cadence published, but the titration ramp's terminal
 *                   phase is CLOSED ("Weeks 7–8"), which implies a course end.
 * Otherwise `none` — including the important open-ended case ("Weeks 9–10+"),
 * where refusing to suggest is the correct answer.
 *
 * SAFETY, mirroring ../enrichment/suggested-protocol.ts: where a source
 * publishes a RANGE the prefill is the LOW end — the shorter exposure is the
 * conservative one. Everything here is REFERENCE ONLY, carries its source
 * quote + URL for attribution, and is never a prescription. The "not medical
 * advice" framing lives with the UI that renders it.
 *
 * PURE — no I/O, no dates, no dosing maths.
 */
import type { EnrichmentEntry } from "../peptide-enrichment";

/** How a suggestion was obtained — drives how emphatically the UI states it. */
export type CycleConfidence = "curated" | "explicit" | "derived" | "none";

export interface CycleGuidance {
  /** Weeks ON to prefill (LOW end of a published range), or null for no stop. */
  onWeeks: number | null;
  /** Upper published bound when the source gives a range/ceiling, else null. */
  onWeeksMax: number | null;
  /** Weeks OFF, only when the source actually publishes a break length. */
  offWeeks: number | null;
  /** True when the source describes open-ended / continuous use. */
  continuous: boolean;
  confidence: CycleConfidence;
  /** One-line rationale for the UI chip. */
  basis: string;
  /** Verbatim sentence the figure came from, where there is one. */
  quote: string | null;
}

export interface CycleSuggestion extends CycleGuidance {
  /** Source page the entry was curated from, for the attribution link. */
  sourceUrl: string | null;
}

/** An operator-curated override: hand-entered, defensible, always with a basis. */
export interface CuratedCycle {
  onWeeks: number | null;
  offWeeks: number | null;
  /** REQUIRED — why this number, and from where. Rendered verbatim in the UI. */
  basis: string;
  quote: string | null;
}

/**
 * Operator-curated cycle guidance, keyed by lowercase peptide name.
 *
 * Deliberately EMPTY. The parser below derives what the shipped literature
 * actually says; anything beyond that would be a number we invented, and an
 * invented cycle length rendered next to a source citation reads as sourced.
 * Populate by hand — each entry needs a `basis` naming its real source.
 */
export const CURATED_CYCLE_GUIDANCE: Record<string, CuratedCycle> = {};

/** Weeks outside this band are parse noise (page numbers, dose figures), not cycles. */
const MIN_WEEKS = 1;
const MAX_WEEKS = 104;
const plausible = (n: number) => Number.isInteger(n) && n >= MIN_WEEKS && n <= MAX_WEEKS;

/** The sentence containing `index`, trimmed — used as the attribution quote. */
function sentenceAt(text: string, index: number): string {
  const start = Math.max(0, text.lastIndexOf(".", index) + 1);
  const dot = text.indexOf(".", index);
  const end = dot === -1 ? text.length : dot + 1;
  return text.slice(start, end).trim();
}

// "8 weeks on, 4 weeks off" — the only pattern that yields BOTH halves.
const ON_OFF = /(\d{1,3})\s*weeks?\s+on\b[\s,;/]{0,4}(?:and\s+)?(\d{1,3})\s*weeks?\s+off/i;
// "cycled in 4–8 week blocks" / "cycled in 6-12 week cycles".
const RANGE_BLOCKS = /\bcycl(?:ed|es|ing)\b[^.]{0,40}?(\d{1,3})\s*[–—-]\s*(\d{1,3})\s*[- ]?weeks?\s*(?:blocks?|cycles?|courses?)/i;
// "cycled for 12 weeks" / "cycled over 8–12 weeks".
const CYCLED_FOR = /\bcycl(?:ed|es|ing)\s+(?:for|over|in)\s+(?:about\s+|roughly\s+|approximately\s+|~)?(\d{1,3})\s*(?:[–—-]\s*(\d{1,3})\s*)?weeks?/i;
// "continuous use up to 52 weeks".
const CONTINUOUS_WEEKS = /continuous(?:ly)?\s+(?:use|dosing|administration)\s+(?:up\s+to\s+)?(\d{1,3})\s*weeks?/i;
// "a 14-day continuous course".
const CONTINUOUS_DAYS = /(\d{1,3})[-\s]day\s+continuous\s+(?:course|use|dosing)/i;
// Bare continuous-use language with no figure attached.
const CONTINUOUS_BARE = /\bcontinuous(?:ly)?\s+(?:use|dosing|administration)\b/i;

/**
 * Parse ONE block of free text for a published cycling cadence.
 *
 * Returns null when the text says nothing about dosing cycles — including for
 * the several biological senses of the word ("folate cycle", "cell cycle",
 * "post-cycle"), which never carry an adjacent week count in a cycling clause
 * and so cannot match any pattern here.
 */
export function parseCycleGuidance(text: string | null | undefined): CycleGuidance | null {
  if (!text || !text.trim()) return null;

  const onOff = ON_OFF.exec(text);
  if (onOff) {
    const on = Number(onOff[1]);
    const off = Number(onOff[2]);
    if (plausible(on) && plausible(off)) {
      return {
        onWeeks: on,
        onWeeksMax: null,
        offWeeks: off,
        continuous: false,
        confidence: "explicit",
        basis: `Source publishes ${on} weeks on / ${off} weeks off.`,
        quote: sentenceAt(text, onOff.index),
      };
    }
    return null;
  }

  const block = RANGE_BLOCKS.exec(text);
  if (block) {
    const low = Number(block[1]);
    const high = Number(block[2]);
    // A reversed or implausible range is parse noise — suggest nothing rather
    // than a negative or absurd window.
    if (!plausible(low) || !plausible(high) || low > high) return null;
    return {
      onWeeks: low,
      onWeeksMax: high,
      offWeeks: null,
      continuous: false,
      confidence: "explicit",
      basis: `Source cycles this in ${low}–${high} week blocks; prefilled at the conservative ${low}.`,
      quote: sentenceAt(text, block.index),
    };
  }

  const forWeeks = CYCLED_FOR.exec(text);
  if (forWeeks) {
    const low = Number(forWeeks[1]);
    const high = forWeeks[2] ? Number(forWeeks[2]) : null;
    if (!plausible(low)) return null;
    if (high !== null && (!plausible(high) || low > high)) return null;
    return {
      onWeeks: low,
      onWeeksMax: high,
      offWeeks: null,
      continuous: false,
      confidence: "explicit",
      basis: high
        ? `Source cycles this over ${low}–${high} weeks; prefilled at the conservative ${low}.`
        : `Source cycles this for ${low} weeks.`,
      quote: sentenceAt(text, forWeeks.index),
    };
  }

  // Continuous-use language: an explicit statement that NO stop is indicated.
  // We surface the ceiling as context but never prefill a stop from it.
  const contWeeks = CONTINUOUS_WEEKS.exec(text);
  if (contWeeks && plausible(Number(contWeeks[1]))) {
    const weeks = Number(contWeeks[1]);
    return {
      onWeeks: null,
      onWeeksMax: weeks,
      offWeeks: null,
      continuous: true,
      confidence: "explicit",
      basis: `Source reports continuous use up to ${weeks} weeks — no cycle break published.`,
      quote: sentenceAt(text, contWeeks.index),
    };
  }

  const contDays = CONTINUOUS_DAYS.exec(text);
  if (contDays) {
    const days = Number(contDays[1]);
    const weeks = Math.round(days / 7);
    if (plausible(weeks)) {
      return {
        onWeeks: null,
        onWeeksMax: weeks,
        offWeeks: null,
        continuous: true,
        confidence: "explicit",
        basis: `Source reports a ${days}-day continuous course (~${weeks} weeks) — no cycle break published.`,
        quote: sentenceAt(text, contDays.index),
      };
    }
  }

  if (CONTINUOUS_BARE.test(text)) {
    const m = CONTINUOUS_BARE.exec(text)!;
    return {
      onWeeks: null,
      onWeeksMax: null,
      offWeeks: null,
      continuous: true,
      confidence: "explicit",
      basis: "Source describes continuous use — no cycle break published.",
      quote: sentenceAt(text, m.index),
    };
  }

  return null;
}

/** A ramp's implied course end: the largest terminal week, and whether it's open. */
export interface RampTerminal {
  week: number;
  /** True when the phase carries a trailing "+" — the course does not close. */
  open: boolean;
}

const PHASE = /weeks?\s*(\d{1,3})\s*(?:[–—-]\s*(\d{1,3}))?\s*(\+)?/i;

/**
 * The course length implied by a titration ramp's phase labels.
 *
 * "Weeks 7–8" (closed) → the protocol has a published end at week 8.
 * "Weeks 5–8+" / "Weeks 13+" → open-ended; the caller must NOT suggest a stop.
 * Takes the LARGEST terminal week, not the last array element, so an
 * out-of-order ramp can't under-report the course.
 */
export function rampTerminalWeek(phases: readonly string[]): RampTerminal | null {
  let best: RampTerminal | null = null;
  for (const label of phases) {
    const m = PHASE.exec(label ?? "");
    if (!m) continue;
    const start = Number(m[1]);
    const end = m[2] ? Number(m[2]) : start;
    if (!plausible(end)) continue;
    if (best === null || end > best.week) best = { week: end, open: Boolean(m[3]) };
  }
  return best;
}

/** Every free-text field on an entry worth scanning, in priority order. */
function textFields(entry: EnrichmentEntry): string[] {
  return [
    entry.dosingReference ?? "",
    ...entry.benefits,
    ...entry.sideEffects,
    entry.mechanism ?? "",
    ...entry.templates.map((t) => t.frequency ?? ""),
  ].filter(Boolean);
}

const NONE = (basis: string): CycleGuidance => ({
  onWeeks: null,
  onWeeksMax: null,
  offWeeks: null,
  continuous: false,
  confidence: "none",
  basis,
  quote: null,
});

/**
 * The cycle suggestion to offer for a peptide's enrichment entry.
 *
 * Never throws and always returns a usable object — an entry with nothing to go
 * on yields a `none` suggestion whose `basis` explains the silence, which the
 * form renders as "no published cycle length; set your own".
 */
export function suggestCycle(
  entry: EnrichmentEntry | undefined,
  opts: { curated?: CuratedCycle } = {},
): CycleSuggestion {
  if (!entry) {
    return { ...NONE("No reference data for this peptide — set a cycle length yourself."), sourceUrl: null };
  }
  const sourceUrl = entry.sourceUrl ?? null;

  const curated = opts.curated ?? CURATED_CYCLE_GUIDANCE[entry.name.trim().toLowerCase()];
  if (curated) {
    return {
      onWeeks: curated.onWeeks,
      onWeeksMax: null,
      offWeeks: curated.offWeeks,
      continuous: false,
      confidence: "curated",
      basis: curated.basis,
      quote: curated.quote,
      sourceUrl,
    };
  }

  // Scan every text field; a cadence that names an actual stop beats a bare
  // continuous-use note, whichever field each happened to appear in.
  let continuousHit: CycleGuidance | null = null;
  for (const field of textFields(entry)) {
    const hit = parseCycleGuidance(field);
    if (!hit) continue;
    if (hit.onWeeks !== null) return { ...hit, sourceUrl };
    if (!continuousHit) continuousHit = hit;
  }
  if (continuousHit) return { ...continuousHit, sourceUrl };

  // Nothing published — fall back to what the titration ramp implies.
  const phases = entry.templates.flatMap((t) => (t.ramp ?? []).map((r) => r.phase));
  const terminal = rampTerminalWeek(phases);
  if (terminal && !terminal.open) {
    return {
      onWeeks: terminal.week,
      onWeeksMax: null,
      offWeeks: null,
      continuous: false,
      confidence: "derived",
      basis: `No cycle length published; the source's titration ramp ends at week ${terminal.week}.`,
      quote: null,
      sourceUrl,
    };
  }
  if (terminal && terminal.open) {
    return {
      ...NONE(
        `The source's titration ramp is open-ended from week ${terminal.week} — no course end is published. Set your own cycle length.`,
      ),
      sourceUrl,
    };
  }

  return { ...NONE("No cycle length published for this peptide — set your own."), sourceUrl };
}
