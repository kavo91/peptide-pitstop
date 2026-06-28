"use client";

/**
 * Editable manual wellness log for a single day. Sleep and weight fields are
 * hidden when Garmin already supplies that day's value (Garmin wins — see
 * WellnessDayPanel), so the manual log never competes with wearable data. Saves
 * via the same server actions JournalForm uses (string inputs; the action
 * parses/encrypts), then refreshes the route.
 *
 * Side effects are captured structurally: a chip picker over the active symptom
 * list, each selected chip gets an optional severity, plus a free-text "add
 * custom symptom" input. The action serializes + encrypts the SideEffectEntry[].
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createJournalEntry, updateJournalEntry } from "@/app/actions/journal";
import type { ManualDay } from "@/lib/wellness-log";
import { DEFAULT_SYMPTOMS, type Severity, type SideEffectEntry } from "@/lib/side-effects";

const RATINGS = [1, 2, 3, 4, 5];
const SEVERITIES: readonly Severity[] = ["mild", "moderate", "severe"];

function Segmented({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <p className="mb-1 text-xs text-muted">{label}</p>
      <div className="flex gap-1.5" role="group" aria-label={label}>
        {RATINGS.map((n) => {
          const sel = value === String(n);
          return (
            <button
              key={n}
              type="button"
              aria-pressed={sel}
              onClick={() => onChange(sel ? "" : String(n))}
              className={`h-9 flex-1 rounded-control text-sm font-medium tabular-nums ring-1 ${
                sel ? "bg-accent text-onAccent ring-transparent" : "bg-bg text-ink ring-line/15 hover:ring-line/30"
              }`}
            >
              {n}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const numInput = "w-28 rounded-control border border-line/15 bg-bg px-3 py-2 tabular-nums text-ink";

/**
 * Structured side-effect picker. Holds the selected entries by symptom name and
 * exposes them via onChange. The chip list is the union of the active symptom
 * list and any already-selected symptom (so a stored custom symptom still shows).
 */
function SideEffectPicker({
  symptoms,
  value,
  onChange,
}: {
  symptoms: readonly string[];
  value: SideEffectEntry[];
  onChange: (v: SideEffectEntry[]) => void;
}) {
  const [custom, setCustom] = useState("");
  const selectedByName = new Map(value.map((e) => [e.symptom.toLowerCase(), e]));

  // Union of the configured list + any selected symptom not in it (e.g. custom).
  const known = new Set(symptoms.map((s) => s.toLowerCase()));
  const extras = value.map((e) => e.symptom).filter((s) => !known.has(s.toLowerCase()));
  const chips = [...symptoms, ...extras];

  function toggle(symptom: string) {
    const key = symptom.toLowerCase();
    if (selectedByName.has(key)) {
      onChange(value.filter((e) => e.symptom.toLowerCase() !== key));
    } else {
      onChange([...value, { symptom, severity: null }]);
    }
  }

  function setSeverity(symptom: string, severity: Severity | null) {
    const key = symptom.toLowerCase();
    onChange(value.map((e) => (e.symptom.toLowerCase() === key ? { ...e, severity } : e)));
  }

  function addCustom() {
    const name = custom.trim();
    if (!name) return;
    if (!selectedByName.has(name.toLowerCase())) {
      onChange([...value, { symptom: name, severity: null }]);
    }
    setCustom("");
  }

  return (
    <div>
      <p className="mb-1 text-xs text-muted">Side effects (encrypted)</p>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((symptom) => {
          const entry = selectedByName.get(symptom.toLowerCase());
          const sel = !!entry;
          return (
            <button
              key={symptom}
              type="button"
              aria-pressed={sel}
              onClick={() => toggle(symptom)}
              className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ${
                sel ? "bg-accent text-onAccent ring-transparent" : "bg-bg text-ink ring-line/15 hover:ring-line/30"
              }`}
            >
              {symptom}
            </button>
          );
        })}
      </div>

      {value.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {value.map((e) => (
            <li key={e.symptom} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">{e.symptom}</span>
              <div className="flex gap-1" role="group" aria-label={`${e.symptom} severity`}>
                {SEVERITIES.map((sev) => {
                  const sel = e.severity === sev;
                  return (
                    <button
                      key={sev}
                      type="button"
                      aria-pressed={sel}
                      onClick={() => setSeverity(e.symptom, sel ? null : sev)}
                      className={`rounded-control px-2 py-1 text-xs font-medium capitalize ring-1 ${
                        sel ? "bg-accent2 text-onAccent ring-transparent" : "bg-bg text-muted ring-line/15 hover:ring-line/30"
                      }`}
                    >
                      {sev}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex gap-2">
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addCustom();
            }
          }}
          placeholder="Add custom symptom"
          aria-label="Add custom symptom"
          className="w-full rounded-control border border-line/15 bg-bg px-3 py-2 text-sm text-ink"
        />
        <button
          type="button"
          onClick={addCustom}
          className="rounded-control bg-bg px-3 py-2 text-sm font-medium ring-1 ring-line/15 hover:ring-line/30"
        >
          Add
        </button>
      </div>
    </div>
  );
}

export function WellnessDayForm({
  day,
  existing,
  hideSleep,
  hideWeight,
  symptoms = DEFAULT_SYMPTOMS,
  onSaved,
  onCancel,
}: {
  day: string;
  existing?: ManualDay;
  hideSleep?: boolean;
  hideWeight?: boolean;
  symptoms?: readonly string[];
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const [weight, setWeight] = useState(existing?.weight != null ? String(existing.weight) : "");
  const [weightUnit, setWeightUnit] = useState(existing?.weightUnit ?? "kg");
  const [mood, setMood] = useState(existing?.mood != null ? String(existing.mood) : "");
  const [energy, setEnergy] = useState(existing?.energy != null ? String(existing.energy) : "");
  const [sleep, setSleep] = useState(existing?.sleep != null ? String(existing.sleep) : "");
  const [calories, setCalories] = useState(existing?.calories != null ? String(existing.calories) : "");
  const [proteinG, setProteinG] = useState(existing?.proteinG != null ? String(existing.proteinG) : "");
  const [waterMl, setWaterMl] = useState(existing?.waterMl != null ? String(existing.waterMl) : "");
  const [sideEffects, setSideEffects] = useState<SideEffectEntry[]>(existing?.sideEffectEntries ?? []);
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    // Garmin owns sleep/weight when present — never send a manual value for them.
    const effWeight = hideWeight ? "" : weight;
    const effSleep = hideSleep ? "" : sleep;
    if (
      !effWeight && !mood && !energy && !effSleep &&
      !calories && !proteinG && !waterMl &&
      sideEffects.length === 0 && !notes.trim()
    ) {
      setError("Log at least one value before saving.");
      return;
    }
    setBusy(true);
    setError(null);
    const input = {
      dateISO: day,
      weight: effWeight || undefined,
      weightUnit,
      mood: mood || undefined,
      energy: energy || undefined,
      sleep: effSleep || undefined,
      calories: calories || undefined,
      proteinG: proteinG || undefined,
      waterMl: waterMl || undefined,
      sideEffects: sideEffects.length ? sideEffects : undefined,
      notes: notes || undefined,
    };
    const res = existing?.id
      ? await updateJournalEntry({ id: existing.id, ...input })
      : await createJournalEntry(input);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Could not save the entry.");
      return;
    }
    router.refresh();
    onSaved?.();
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="mt-3 space-y-3"
    >
      {!hideWeight && (
        <div>
          <p className="mb-1 text-xs text-muted">Weight</p>
          <div className="flex gap-2">
            <input inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="e.g. 78.5" aria-label="Weight"
              className={numInput} />
            <select value={weightUnit} onChange={(e) => setWeightUnit(e.target.value)} aria-label="Weight unit"
              className="rounded-control border border-line/15 bg-bg px-3 py-2 text-ink">
              <option value="kg">kg</option>
              <option value="lb">lb</option>
            </select>
          </div>
        </div>
      )}
      <Segmented label="Mood (1–5)" value={mood} onChange={setMood} />
      <Segmented label="Energy (1–5)" value={energy} onChange={setEnergy} />
      {!hideSleep && (
        <div>
          <p className="mb-1 text-xs text-muted">Sleep (hours)</p>
          <input inputMode="decimal" value={sleep} onChange={(e) => setSleep(e.target.value)} placeholder="e.g. 7.5" aria-label="Sleep hours"
            className={numInput} />
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div>
          <p className="mb-1 text-xs text-muted">Calories (kcal)</p>
          <input inputMode="numeric" value={calories} onChange={(e) => setCalories(e.target.value)} placeholder="e.g. 2100" aria-label="Calories"
            className="w-full rounded-control border border-line/15 bg-bg px-3 py-2 tabular-nums text-ink" />
        </div>
        <div>
          <p className="mb-1 text-xs text-muted">Protein (g)</p>
          <input inputMode="decimal" value={proteinG} onChange={(e) => setProteinG(e.target.value)} placeholder="e.g. 150" aria-label="Protein grams"
            className="w-full rounded-control border border-line/15 bg-bg px-3 py-2 tabular-nums text-ink" />
        </div>
        <div>
          <p className="mb-1 text-xs text-muted">Water (mL)</p>
          <input inputMode="numeric" value={waterMl} onChange={(e) => setWaterMl(e.target.value)} placeholder="e.g. 2000" aria-label="Water mL"
            className="w-full rounded-control border border-line/15 bg-bg px-3 py-2 tabular-nums text-ink" />
        </div>
      </div>
      <SideEffectPicker symptoms={symptoms} value={sideEffects} onChange={setSideEffects} />
      <div>
        <p className="mb-1 text-xs text-muted">Notes</p>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="(encrypted)" aria-label="Notes"
          className="w-full rounded-control border border-line/15 bg-bg px-3 py-2 text-sm text-ink" />
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className="flex-1 rounded-control bg-bg px-4 py-2.5 text-sm font-medium ring-1 ring-line/15">
            Cancel
          </button>
        )}
        <button type="submit" disabled={busy}
          className="flex-1 rounded-control bg-accent px-4 py-2.5 text-sm font-medium text-onAccent disabled:opacity-40">
          {busy ? "Saving…" : existing?.id ? "Save changes" : "Save log"}
        </button>
      </div>
    </form>
  );
}
