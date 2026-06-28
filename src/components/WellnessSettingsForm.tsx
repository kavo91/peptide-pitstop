"use client";

import { Save } from "lucide-react";
import { useState } from "react";
import { updateWellnessSettings } from "@/app/actions/settings";

const input = "w-full rounded-control border border-line/15 bg-bg px-3 py-2 text-sm text-ink";

/**
 * Wellness preferences: daily hydration target (mL) and the custom side-effect
 * symptom list (comma/newline separated). A blank symptom list clears the
 * override so the curated default applies.
 */
export function WellnessSettingsForm({
  hydrationTargetMl,
  symptomList,
}: {
  hydrationTargetMl: number | null;
  symptomList: string[] | null;
}) {
  const [target, setTarget] = useState(hydrationTargetMl != null ? String(hydrationTargetMl) : "");
  const [symptoms, setSymptoms] = useState((symptomList ?? []).join("\n"));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true); setError(null); setSaved(false);
    const res = await updateWellnessSettings({ hydrationTargetMl: target, symptomList: symptoms });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setSaved(true);
  }

  return (
    <section className="mt-8">
      <h2 className="mb-1 text-sm font-medium text-muted">Wellness</h2>
      <p className="mb-3 text-xs text-muted">Daily hydration goal and your side-effect symptom list.</p>
      <div className="space-y-3">
        <label className="block text-sm text-muted">Hydration target (mL/day)
          <input className={input + " mt-1 w-40"} inputMode="numeric" min="0" placeholder="e.g. 2000"
            value={target} onChange={(e) => { setTarget(e.target.value); setSaved(false); }} />
        </label>
        <label className="block text-sm text-muted">Side-effect symptoms
          <span className="block text-xs text-muted">One per line (or comma-separated). Leave blank for the default list.</span>
          <textarea className={input + " mt-1 min-h-[7rem]"} placeholder="Nausea, Headache, Fatigue…"
            value={symptoms} onChange={(e) => { setSymptoms(e.target.value); setSaved(false); }} />
        </label>
        <button type="button" onClick={save} disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-control bg-accent px-4 py-2 text-sm font-medium text-onAccent disabled:opacity-40">
          {busy ? "…" : <><Save className="h-4 w-4" aria-hidden /> Save</>}
        </button>
      </div>
      {saved && <p className="mt-2 text-xs text-ok">Saved ✓</p>}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </section>
  );
}
