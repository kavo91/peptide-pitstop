"use client";

import { Save } from "lucide-react";

import { useEffect, useState } from "react";
import { createJournalEntry } from "@/app/actions/journal";
import { type SideEffectEntry } from "@/lib/side-effects";

/** Split a free-text side-effects field into structured entries (no severity). */
function parseFreeTextSideEffects(text: string): SideEffectEntry[] {
  return text
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((symptom) => ({ symptom, severity: null }));
}

/** Local "yyyy-MM-dd" for a sensible default, computed client-side. */
function todayLocal(): string {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

const RATINGS = [1, 2, 3, 4, 5];

function Segmented({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <p className="mb-1 text-sm text-muted">{label}</p>
      <div className="flex gap-2" role="group" aria-label={label}>
        {RATINGS.map((n) => {
          const sel = value === String(n);
          return (
            <button
              key={n}
              type="button"
              aria-pressed={sel}
              // Click the selected value again to clear it (leaves the field unset).
              onClick={() => onChange(sel ? "" : String(n))}
              className={`h-10 flex-1 rounded-control text-sm font-medium tabular-nums ring-1 transition-colors ${
                sel
                  ? "bg-accent text-onAccent ring-transparent"
                  : "bg-bg text-ink ring-line/15 hover:ring-line/30"
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

export function JournalForm() {
  const [date, setDate] = useState("");
  const [weight, setWeight] = useState("");
  const [weightUnit, setWeightUnit] = useState("kg");
  const [mood, setMood] = useState("");
  const [energy, setEnergy] = useState("");
  const [sleep, setSleep] = useState("");
  const [sideEffects, setSideEffects] = useState("");
  const [notes, setNotes] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default the date on mount to avoid an SSR/client timezone hydration mismatch.
  useEffect(() => {
    setDate(todayLocal());
  }, []);

  async function submit() {
    if (!date) {
      setError("Pick a date.");
      return;
    }
    // Require at least one tracked value so we don't store empty rows.
    if (!weight && !mood && !energy && !sleep && !sideEffects.trim() && !notes.trim()) {
      setError("Log at least one value before saving.");
      return;
    }
    setBusy(true);
    setError(null);
    const effects = parseFreeTextSideEffects(sideEffects);
    const res = await createJournalEntry({
      dateISO: date, // "yyyy-MM-dd" → stored at UTC midnight
      weight: weight || undefined,
      weightUnit,
      mood: mood || undefined,
      energy: energy || undefined,
      sleep: sleep || undefined,
      sideEffects: effects.length ? effects : undefined,
      notes: notes || undefined,
    });
    setBusy(false);
    if (res.ok) {
      window.location.href = "/journal";
    } else {
      setError(res.error ?? "Could not save the entry.");
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="space-y-4 rounded-card bg-surface p-4 ring-1 ring-line/10 shadow-sm"
    >
      <label className="block text-sm text-muted">
        Date
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="mt-1 w-full rounded-control border border-line/15 bg-bg px-3 py-2 text-ink"
        />
      </label>

      <div>
        <p className="mb-1 text-sm text-muted">Weight</p>
        <div className="flex gap-2">
          <input
            inputMode="decimal"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            placeholder="e.g. 78.5"
            aria-label="Weight"
            className="w-32 rounded-control border border-line/15 bg-bg px-3 py-2 tabular-nums text-ink"
          />
          <select
            value={weightUnit}
            onChange={(e) => setWeightUnit(e.target.value)}
            aria-label="Weight unit"
            className="rounded-control border border-line/15 bg-bg px-3 py-2 text-ink"
          >
            <option value="kg">kg</option>
            <option value="lb">lb</option>
          </select>
        </div>
      </div>

      <Segmented label="Mood (1–5)" value={mood} onChange={setMood} />
      <Segmented label="Energy (1–5)" value={energy} onChange={setEnergy} />

      <label className="block text-sm text-muted">
        Sleep (hours)
        <input
          inputMode="decimal"
          value={sleep}
          onChange={(e) => setSleep(e.target.value)}
          placeholder="e.g. 7.5"
          className="mt-1 w-32 rounded-control border border-line/15 bg-bg px-3 py-2 tabular-nums text-ink"
        />
      </label>

      <label className="block text-sm text-muted">
        Side effects
        <input
          value={sideEffects}
          onChange={(e) => setSideEffects(e.target.value)}
          placeholder="e.g. nausea, injection-site redness (encrypted)"
          className="mt-1 w-full rounded-control border border-line/15 bg-bg px-3 py-2 text-sm text-ink"
        />
      </label>

      <label className="block text-sm text-muted">
        Notes
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything else (encrypted)"
          className="mt-1 w-full rounded-control border border-line/15 bg-bg px-3 py-2 text-sm text-ink"
        />
      </label>

      {error && <p className="text-sm text-danger">{error}</p>}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-control bg-accent px-4 py-3 font-medium text-onAccent disabled:opacity-40"
      >
        <Save className="mr-1.5 inline h-4 w-4 align-[-0.125em]" aria-hidden />{busy ? "Saving…" : "Save entry"}
      </button>
    </form>
  );
}
