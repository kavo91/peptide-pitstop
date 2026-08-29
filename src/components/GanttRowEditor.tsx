"use client";

import { Save, SlidersHorizontal, X } from "lucide-react";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateProtocol } from "@/app/actions/protocols";

/**
 * In-view editor for the two things the Gantt exists to adjust: the course's
 * end date and its cycle plan. Everything else stays on the protocol form —
 * this panel deliberately cannot touch the schedule rule or titration steps.
 *
 * Sends only the fields the user actually changed (an untouched field stays
 * `undefined`, column untouched server-side), and router.refresh()es on
 * success so the bars re-render from the server's truth rather than from
 * whatever this client happens to hold.
 */
interface Props {
  id: string;
  name: string;
  /** yyyy-mm-dd or null — server values, used for dirty tracking. */
  endDate: string | null;
  cycleOnWeeks: number | null;
  cycleOffWeeks: number | null;
  cycleAnchor: string | null;
}

const field =
  "mt-1 w-full rounded-control border border-line/15 bg-bg px-2.5 py-1.5 text-sm text-ink";

export function GanttRowEditor(p: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [endDate, setEndDate] = useState(p.endDate ?? "");
  const [onWeeks, setOnWeeks] = useState(p.cycleOnWeeks?.toString() ?? "");
  const [offWeeks, setOffWeeks] = useState(p.cycleOffWeeks?.toString() ?? "");
  const [anchor, setAnchor] = useState(p.cycleAnchor ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toInt = (s: string): number | null => {
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : null;
  };

  async function save() {
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      const endDirty = endDate !== (p.endDate ?? "");
      const onDirty = onWeeks !== (p.cycleOnWeeks?.toString() ?? "");
      const offDirty = offWeeks !== (p.cycleOffWeeks?.toString() ?? "");
      const anchorDirty = anchor !== (p.cycleAnchor ?? "");
      const res = await updateProtocol({
        id: p.id,
        ...(endDirty ? { endDateISO: endDate ? new Date(endDate).toISOString() : null } : {}),
        ...(onDirty ? { cycleOnWeeks: onWeeks ? toInt(onWeeks) : null } : {}),
        ...(offDirty ? { cycleOffWeeks: offWeeks ? toInt(offWeeks) : null } : {}),
        ...(anchorDirty ? { cycleAnchorISO: anchor ? new Date(anchor).toISOString() : null } : {}),
      });
      if (res.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setError(res.error ?? "Could not save.");
      }
    } catch {
      setError("Could not save.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Edit ${p.name}`}
        className="mt-1 inline-flex items-center gap-1 rounded-control px-2 py-0.5 text-xs font-medium text-accentStrong hover:bg-accent/10"
      >
        <SlidersHorizontal className="h-3 w-3" aria-hidden /> Edit cycle &amp; end date
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-card bg-bg p-3 ring-1 ring-line/15">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-ink">
          {p.name} — cycle &amp; end date
        </p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={`Close editor for ${p.name}`}
          className="rounded-control p-1 text-muted hover:bg-line/10"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="block text-xs text-muted">
          End date
          <input
            type="date"
            value={endDate}
            onChange={(e) => { setEndDate(e.target.value); setSaved(false); }}
            className={field}
          />
        </label>
        <label className="block text-xs text-muted">
          Run for (weeks)
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={104}
            placeholder="continuous"
            value={onWeeks}
            onChange={(e) => { setOnWeeks(e.target.value); setSaved(false); }}
            className={field}
          />
        </label>
        <label className="block text-xs text-muted">
          Then break (weeks)
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={104}
            placeholder="no restart"
            value={offWeeks}
            onChange={(e) => { setOffWeeks(e.target.value); setSaved(false); }}
            className={field}
          />
        </label>
        <label className="block text-xs text-muted">
          Cycle anchor
          <input
            type="date"
            value={anchor}
            onChange={(e) => { setAnchor(e.target.value); setSaved(false); }}
            className={field}
          />
        </label>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-xs text-muted">
          Blank end date = open-ended. The anchor is where the CURRENT on-cycle
          starts; clear it to count from the start date.
        </p>
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="shrink-0 rounded-control bg-accent px-3 py-1.5 text-xs font-medium text-onAccent disabled:opacity-40"
        >
          <Save className="mr-1 inline h-3.5 w-3.5 align-[-0.125em]" aria-hidden />
          {busy ? "…" : saved ? "Saved" : "Save"}
        </button>
      </div>
      {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
    </div>
  );
}
