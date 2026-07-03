"use client";

import { Save } from "lucide-react";
import { useState } from "react";
import { updateReminderSettings } from "@/app/actions/settings";

/**
 * Reminder anchor settings — applies to BOTH channels (Web Push and the HA
 * relay fallback): when untimed daily doses remind, and when (or whether) the
 * still-pending evening nag fires. Timed slots always use their own slot time.
 */

const input = "mt-1 w-full rounded-control border border-line/15 bg-bg px-3 py-2 text-sm text-ink";

export function ReminderTimesForm(p: { untimedTime: string; nagTime: string; nagEnabled: boolean }) {
  const [untimedTime, setUntimedTime] = useState(p.untimedTime);
  const [nagTime, setNagTime] = useState(p.nagTime);
  const [nagEnabled, setNagEnabled] = useState(p.nagEnabled);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      const res = await updateReminderSettings({ untimedTime, nagTime, nagEnabled });
      if (res.ok) setSaved(true);
      else setError(res.error ?? "Could not save.");
    } catch {
      setError("Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
      <p className="mb-3 text-sm font-medium">Reminder times</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block flex-1 basis-32 text-xs text-muted">
          Daily doses (no set time)
          <input
            type="time"
            value={untimedTime}
            onChange={(e) => { setUntimedTime(e.target.value); setSaved(false); }}
            className={input}
          />
        </label>
        <label className="block flex-1 basis-32 text-xs text-muted">
          Catch-up nag
          <input
            type="time"
            value={nagTime}
            disabled={!nagEnabled}
            onChange={(e) => { setNagTime(e.target.value); setSaved(false); }}
            className={`${input} disabled:opacity-40`}
          />
        </label>
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded-control bg-accent px-4 py-2 text-sm font-medium text-onAccent disabled:opacity-40"
        >
          <Save className="mr-1.5 inline h-4 w-4 align-[-0.125em]" aria-hidden />
          {busy ? "…" : saved ? "Saved" : "Save"}
        </button>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm text-muted">
        <input
          type="checkbox"
          checked={nagEnabled}
          onChange={(e) => { setNagEnabled(e.target.checked); setSaved(false); }}
          className="h-4 w-4 accent-accent"
        />
        Evening catch-up nag — one summary if doses are still unlogged
      </label>
      <p className="mt-2 text-xs text-muted">
        Scheduled slots always remind at their own time. Defaults: 08:00 / 18:00.
      </p>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
