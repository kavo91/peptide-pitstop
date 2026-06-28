/**
 * Pure mapping from an enrichment EXAMPLE template (peptidedosages.com) to the
 * app's ProtocolInput shape, plus a derivation of titration RampParams.
 *
 * REFERENCE ONLY — these are illustrative starting points, never a prescription.
 * Applying a template is always an explicit user action; this module just shapes
 * the data, it never persists anything.
 *
 * No I/O, no framework, no dosing maths beyond reading the source's published
 * numbers. The titration ramp is fed to `generateRamp` (the existing engine);
 * we do NOT reimplement ramp generation here.
 */
import type { EnrichmentTemplate } from "./peptide-enrichment";
import type { ProtocolInput } from "@/app/actions/protocols";
import type { DayPattern, Schedule } from "./schedule/entries";
import { evenlySpacedDays, DEFAULT_DOSE_TIME } from "./schedule/entries";
import type { RampParams } from "./titration/generate-ramp";
import type { DoseUnit } from "./dosing/types";

/** Template units are mcg|mg|iu; ProtocolInput accepts mcg|mg|ml|units. Map iu→units. */
function mapUnit(unit: string): DoseUnit {
  const u = (unit ?? "").trim().toLowerCase();
  if (u === "iu") return "units";
  if (u === "mg") return "mg";
  if (u === "ml") return "ml";
  if (u === "units") return "units";
  return "mcg";
}

/** Strip trailing zeros / format a source number as a plain dose string ("2.50" → "2.5"). */
function doseStr(n: number): string {
  return String(n);
}

const WORD_COUNTS: Record<string, number> = {
  once: 1,
  twice: 2,
  thrice: 3,
  daily: 1, // "daily" alone is handled before this map is consulted
};

/**
 * Best-effort parse of a free-text frequency hint into a DayPattern. Returns
 * null when nothing resolvable is found — the caller picks a safe default.
 *
 *   "Once daily ..."          → { daily }
 *   "Once weekly ..."         → { weekly, 1 evenly-spaced day }
 *   "Twice weekly"            → { weekly, 2 evenly-spaced days }
 *   "3x per week" / "3 times" → { weekly, 3 evenly-spaced days }
 *   "Every 3 days"            → { interval, everyDays: 3 }
 */
export function frequencyToDayPattern(frequency: string | null | undefined): DayPattern | null {
  const f = (frequency ?? "").trim().toLowerCase();
  if (!f) return null;

  // "every N days" → interval
  const everyN = f.match(/every\s+(\d+)\s*day/);
  if (everyN) {
    const n = parseInt(everyN[1], 10);
    if (n > 0) return { kind: "interval", everyDays: n };
  }

  // "N days/week" / "N days per week" → weekly on N evenly-spaced days. Handled
  // explicitly (before the generic weekly path) so the synthesized reference
  // protocols (e.g. GHK-Cu "5 days/week") resolve to a real weekly schedule.
  const daysPerWeek = f.match(/(\d+)\s*days?\s*(?:\/|per)\s*week/);
  if (daysPerWeek) {
    const n = parseInt(daysPerWeek[1], 10);
    if (n > 0) return { kind: "weekly", byDays: evenlySpacedDays(Math.min(7, n)) };
  }

  const weekly = /week/.test(f);
  const daily = /\bdaily\b|\bper day\b|\beach day\b|\bevery day\b/.test(f);

  // Resolve a per-week count from "Nx", "N times", or the leading word ("once"/"twice").
  let perWeekCount: number | null = null;
  const numTimes = f.match(/(\d+)\s*(?:x|times|×|\/)/);
  if (numTimes) {
    perWeekCount = parseInt(numTimes[1], 10);
  } else {
    for (const [word, n] of Object.entries(WORD_COUNTS)) {
      if (word === "daily") continue;
      if (new RegExp(`\\b${word}\\b`).test(f)) {
        perWeekCount = n;
        break;
      }
    }
  }

  if (weekly) {
    const n = perWeekCount && perWeekCount > 0 ? Math.min(7, perWeekCount) : 1;
    return { kind: "weekly", byDays: evenlySpacedDays(n) };
  }
  if (daily) return { kind: "daily" };
  return null;
}

/**
 * Map a template → the app's ProtocolInput.
 *
 * - name / peptideId carried straight through.
 * - targetDose: the headline figure as a string; null → left blank (no NaN).
 * - doseInputUnit / doseBasis from the template (iu→units).
 * - scheduleRule: a Schedule JSON built from the frequency. For per_week we
 *   guarantee a frequency-resolvable schedule (fallback once-weekly) so
 *   ProtocolForm's `perWeekBlocked` guard won't trip; per_injection falls back
 *   to daily. A single default time keeps the dose inside the 06:00–20:00 window.
 * - scheduleType: "titration" when the template has a usable (≥2 phase) ramp,
 *   else "fixed_times".
 */
export function protocolTemplateToInput(t: EnrichmentTemplate, peptideId: string): ProtocolInput {
  const perWeek = t.doseBasis === "per_week";

  let pattern = frequencyToDayPattern(t.frequency);
  if (!pattern) {
    // Safe default: per-week MUST resolve to a frequency, so once-weekly; otherwise daily.
    pattern = perWeek ? { kind: "weekly", byDays: evenlySpacedDays(1) } : { kind: "daily" };
  } else if (perWeek && pattern.kind === "interval") {
    // A per-week dose needs a weekly-resolvable cadence to divide by; coerce an
    // interval to a single weekly day rather than risk an unresolved frequency.
    pattern = { kind: "weekly", byDays: evenlySpacedDays(1) };
  }

  const schedule: Schedule = [{ dayPattern: pattern, times: [DEFAULT_DOSE_TIME] }];
  const hasRamp = templateToRampSteps(t) !== null;

  return {
    peptideId,
    name: t.name,
    source: "manual",
    scheduleType: hasRamp ? "titration" : "fixed_times",
    scheduleRule: JSON.stringify(schedule),
    rebaseMode: "fixed_anchor",
    doseInputUnit: mapUnit(t.unit),
    doseBasis: perWeek ? "per_week" : "per_injection",
    ...(t.targetDose != null ? { targetDose: doseStr(t.targetDose) } : {}),
    status: "active",
  };
}

/**
 * Derive RampParams for `generateRamp` from a template's ramp. Returns null when
 * there's no ramp, fewer than 2 usable (non-null) phases, or the start/target
 * can't be read — in those cases there is no titration to generate.
 *
 * The increment is the first positive delta between consecutive distinct doses;
 * `generateRamp` clamps a non-multiple final jump exactly onto the target, so an
 * irregular last phase is handled by the engine, not here.
 */
export function templateToRampSteps(t: EnrichmentTemplate): RampParams | null {
  const ramp = t.ramp ?? [];
  const doses = ramp.map((r) => r.dose).filter((d): d is number => d != null && Number.isFinite(d));
  if (doses.length < 2) return null;

  const start = doses[0];
  const target = doses[doses.length - 1];
  if (target <= start) return null;

  // First positive step between consecutive distinct doses → the increment.
  let increment = target - start;
  for (let i = 1; i < doses.length; i++) {
    const delta = doses[i] - doses[i - 1];
    if (delta > 0) {
      increment = delta;
      break;
    }
  }
  if (!(increment > 0)) return null;

  // Phase length in weeks, parsed from the first ramp label ("Weeks 1–4" → 4,
  // "Weeks 1-2" → 2). Falls back to 4 weeks when unparseable.
  const weeksPerStep = phaseWeeks(ramp[0]?.phase) ?? 4;

  return {
    startDose: doseStr(start),
    targetDose: doseStr(target),
    increment: doseStr(increment),
    weeksPerStep,
    doseInputUnit: mapUnit(ramp[0]?.unit ?? t.unit),
  };
}

/**
 * Number of weeks a phase label spans. "Weeks 1–4" / "Weeks 1-4" → 4 (the span
 * length, inclusive: end − start + 1). A single "Week 3" → 1. Returns null when
 * no week numbers are present.
 */
function phaseWeeks(label: string | undefined): number | null {
  if (!label) return null;
  // Normalise en/em dashes to a plain hyphen, then pull the week numbers.
  const norm = label.replace(/[–—]/g, "-");
  const range = norm.match(/weeks?\s*(\d+)\s*-\s*(\d+)/i);
  if (range) {
    const a = parseInt(range[1], 10);
    const b = parseInt(range[2], 10);
    if (Number.isFinite(a) && Number.isFinite(b) && b >= a) return b - a + 1;
  }
  const single = norm.match(/weeks?\s*(\d+)/i);
  if (single) return 1;
  return null;
}
