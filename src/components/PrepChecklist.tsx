"use client";

import { useId } from "react";

/**
 * Tri-state pre-visit checklist shared by the DEXA and RMR entry forms.
 *
 * Every item is Yes / No / Unknown (default Unknown). Nothing here is judged —
 * "active travel = Yes" is recorded as a confound, not scored. Items can carry
 * a numeric follow-up that only shows when the answer is Yes (fasting hours,
 * rest minutes).
 */

export type PrepValue = Record<string, boolean | null>;

export interface PrepItem {
  key: string;
  label: string;
  help: string;
  /** Optional numeric follow-up shown only when the answer is Yes. */
  whenYes?: { key: string; label: string; placeholder?: string };
}

/** Items shared by the scan and the RMR test (order matters — printed as-is). */
export const SHARED_PREP_ITEMS: PrepItem[] = [
  { key: "fasted", label: "Fasted", help: "No food before the visit (aim for 12 h).", whenYes: { key: "fastingHours", label: "Hours fasted", placeholder: "e.g. 12" } },
  { key: "noCaffeine", label: "No caffeine", help: "None on the morning of the visit." },
  { key: "noTrainingPriorDay", label: "No training in the prior 24 h", help: "Rest day before the visit — exercise shifts water and glycogen." },
  { key: "activeTravel", label: "Active travel to the clinic", help: "Cycled or walked there. true = a confound, recorded not judged." },
];

/** Scan-only items (appended after the shared list). */
export const SCAN_PREP_ITEMS: PrepItem[] = [
  ...SHARED_PREP_ITEMS,
  { key: "euhydratedVoided", label: "Hydrated and voided", help: "Normal fluids the day before; bladder emptied before the scan." },
  { key: "illnessFree14d", label: "Illness-free for 14 days", help: "No fever, infection or gut illness in the last two weeks." },
];

/** RMR-only items: rest before the test (minutes) and stillness during it. */
export const RMR_PREP_ITEMS: PrepItem[] = [
  ...SHARED_PREP_ITEMS,
  { key: "illnessFree14d", label: "Illness-free for 14 days", help: "No fever, infection or gut illness in the last two weeks." },
  { key: "rested", label: "Rested ≥ 15 min before the test", help: "Seated or lying quietly before the mask went on.", whenYes: { key: "restMinBeforeTest", label: "Minutes rested", placeholder: "e.g. 20" } },
  { key: "awakeQuiet", label: "Awake and still", help: "No talking, reading or dozing during the measurement." },
];

const OPTIONS: { label: string; value: boolean | null }[] = [
  { label: "Yes", value: true },
  { label: "No", value: false },
  { label: "Unknown", value: null },
];

export function PrepChecklist({
  value,
  onChange,
  items,
  numbers = {},
  onNumbersChange,
  idPrefix,
}: {
  value: PrepValue;
  onChange: (next: PrepValue) => void;
  items: PrepItem[];
  /** Numeric follow-ups keyed by `whenYes.key` (strings straight from the inputs). */
  numbers?: Record<string, string>;
  onNumbersChange?: (next: Record<string, string>) => void;
  /** Stable prefix for the follow-up input ids (defaults to a React-generated one, so two lists on one page never collide). */
  idPrefix?: string;
}) {
  const inputCls = "rounded-control border border-line/15 bg-bg px-3 py-2 text-sm";
  const reactId = useId();
  const prefix = idPrefix ?? `prep${reactId}`;
  return (
    <ul className="space-y-2">
      {items.map((it) => {
        const cur = it.key in value ? value[it.key] : null;
        return (
          <li key={it.key} className="rounded-control bg-bg/40 p-2 ring-1 ring-line/10">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink">{it.label}</p>
                <p className="text-xs text-muted">{it.help}</p>
              </div>
              <div className="flex gap-1" role="group" aria-label={it.label}>
                {OPTIONS.map((o) => {
                  const sel = cur === o.value;
                  return (
                    <button
                      key={o.label}
                      type="button"
                      aria-pressed={sel}
                      aria-label={`${it.label}: ${o.label.toLowerCase()}`}
                      onClick={() => onChange({ ...value, [it.key]: o.value })}
                      className={`min-h-[40px] min-w-[44px] rounded-control px-2.5 text-xs font-medium ring-1 transition-colors ${
                        sel ? "bg-accent text-onAccent ring-transparent" : "bg-bg text-ink ring-line/15 hover:ring-line/30"
                      }`}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </div>
            {it.whenYes && cur === true && (
              <label htmlFor={`${prefix}-${it.whenYes.key}`} className="mt-2 block w-40 text-xs text-muted">
                {it.whenYes.label}
                <input
                  id={`${prefix}-${it.whenYes.key}`}
                  inputMode="decimal"
                  value={numbers[it.whenYes.key] ?? ""}
                  placeholder={it.whenYes.placeholder}
                  onChange={(e) => onNumbersChange?.({ ...numbers, [it.whenYes!.key]: e.target.value })}
                  className={`mt-1 w-full tabular-nums ${inputCls}`}
                />
              </label>
            )}
          </li>
        );
      })}
    </ul>
  );
}
