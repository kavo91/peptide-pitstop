"use client";

import { Save, Pause, Play } from "lucide-react";

import { useState } from "react";
import { updateProtocol, pauseProtocol, resumeProtocol } from "@/app/actions/protocols";

interface Props {
  id: string;
  name: string;
  peptideName: string;
  startDate: string | null; // yyyy-mm-dd
  scheduleLabel: string;
  halfLifeHours: string | null;
  status: "active" | "paused" | "completed";
}

const STATUS_STYLE: Record<string, string> = {
  active: "bg-ok/10 text-ok",
  paused: "bg-warn/10 text-warn",
  completed: "bg-line/[0.06] text-muted",
};

export function ProtocolEditor(p: Props) {
  const [startDate, setStartDate] = useState(p.startDate ?? "");
  const [status, setStatus] = useState(p.status);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      const res = await updateProtocol({
        id: p.id,
        startDateISO: startDate ? new Date(startDate).toISOString() : null,
        status,
      });
      if (res.ok) setSaved(true);
      else setError(res.error ?? "Could not save.");
    } catch {
      setError("Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function togglePause() {
    setBusy(true);
    setError(null);
    try {
      const res = status === "active"
        ? await pauseProtocol(p.id)
        : await resumeProtocol(p.id);
      if (res.ok) setStatus(status === "active" ? "paused" : "active");
      else setError(res.error ?? "Could not toggle.");
    } catch {
      setError("Could not toggle.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{p.peptideName}</p>
          <p className="text-sm text-muted">{p.name}</p>
        </div>
        <span className={`rounded-full px-2 py-1 text-xs font-medium capitalize ${STATUS_STYLE[status]}`}>{status}</span>
      </div>

      <dl className="mb-3 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted">Schedule</dt>
          <dd className="font-medium">{p.scheduleLabel}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Half-life</dt>
          <dd className="font-medium tabular-nums">{p.halfLifeHours ? `${p.halfLifeHours} h` : "—"}</dd>
        </div>
      </dl>

      <div className="flex items-end gap-2">
        <label className="block flex-1 text-xs text-muted">Start date
          <input
            type="date"
            value={startDate}
            onChange={(e) => { setStartDate(e.target.value); setSaved(false); }}
            className="mt-1 w-full rounded-control border border-line/15 bg-bg px-3 py-2 text-sm text-ink"
          />
        </label>
        <label className="block flex-1 text-xs text-muted">Status
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value as Props["status"]); setSaved(false); }}
            className="mt-1 w-full rounded-control border border-line/15 bg-bg px-3 py-2 text-sm text-ink"
          >
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="completed">Completed</option>
          </select>
        </label>
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded-control bg-accent px-4 py-2 text-sm font-medium text-onAccent disabled:opacity-40"
        >
          <Save className="mr-1.5 inline h-4 w-4 align-[-0.125em]" aria-hidden />{busy ? "…" : saved ? "Saved" : "Save"}
        </button>
      </div>

      {/* Dedicated pause/resume toggle — only shown for active or paused protocols */}
      {(status === "active" || status === "paused") && (
        <div className="mt-3">
          <button
            type="button"
            onClick={togglePause}
            disabled={busy}
            className={`w-full rounded-control px-4 py-2 text-sm font-medium disabled:opacity-40 ${
              status === "active"
                ? "bg-warn/10 text-warn ring-1 ring-warn/20 hover:bg-warn/20"
                : "bg-ok/10 text-ok ring-1 ring-ok/20 hover:bg-ok/20"
            }`}
          >
            {status === "active" ? <><Pause className="mr-1.5 inline h-4 w-4 align-[-0.125em]" aria-hidden />Pause protocol</> : <><Play className="mr-1.5 inline h-4 w-4 align-[-0.125em]" aria-hidden />Resume protocol</>}
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
