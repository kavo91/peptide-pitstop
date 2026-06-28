"use client";

import { Save } from "lucide-react";

import { useState } from "react";
import { updateReorderDefaults } from "@/app/actions/settings";

const input = "w-full rounded-control border border-line/15 bg-bg px-3 py-2 text-sm text-ink";

export function ReorderDefaultsForm({ leadTimeDays, bufferDays }: { leadTimeDays: number; bufferDays: number }) {
  const [lead, setLead] = useState(String(leadTimeDays));
  const [buffer, setBuffer] = useState(String(bufferDays));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true); setError(null); setSaved(false);
    const res = await updateReorderDefaults({ leadTimeDays: lead, bufferDays: buffer });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setSaved(true);
  }

  return (
    <section className="mt-8">
      <h2 className="mb-1 text-sm font-medium text-muted">Reorder defaults</h2>
      <p className="mb-3 text-xs text-muted">Used when a prescription has no lead time of its own.</p>
      <div className="flex items-end gap-2">
        <label className="block flex-1 text-sm text-muted">Lead time (days)
          <input className={input + " mt-1"} inputMode="numeric" min="0" value={lead} onChange={(e) => { setLead(e.target.value); setSaved(false); }} />
        </label>
        <label className="block flex-1 text-sm text-muted">Safety buffer (days)
          <input className={input + " mt-1"} inputMode="numeric" min="0" value={buffer} onChange={(e) => { setBuffer(e.target.value); setSaved(false); }} />
        </label>
        <button type="button" onClick={save} disabled={busy} className="inline-flex items-center gap-1.5 rounded-control bg-accent px-4 py-2 text-sm font-medium text-onAccent disabled:opacity-40">{busy ? "…" : <><Save className="h-4 w-4" aria-hidden /> Save</>}</button>
      </div>
      {saved && <p className="mt-2 text-xs text-ok">Saved ✓</p>}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </section>
  );
}
