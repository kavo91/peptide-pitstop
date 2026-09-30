"use client";

import { Save, Pause, Play } from "lucide-react";

import { useEffect, useState } from "react";
import { updateProtocol, pauseProtocol, resumeProtocol } from "@/app/actions/protocols";
import { useSavedFlash } from "./useSavedFlash";

interface Props {
  id: string;
  name: string;
  peptideName: string;
  startDate: string | null; // yyyy-mm-dd
  scheduleLabel: string;
  halfLifeHours: string | null;
  status: "active" | "paused" | "completed";
}

/** Per-protocol key for the notice that must outlive a revalidate remount. */
const noticeKey = (id: string) => `pt-protocol-notice:${id}`;

const STATUS_STYLE: Record<string, string> = {
  active: "bg-ok/10 text-ok",
  paused: "bg-warn/10 text-warn",
  completed: "bg-line/[0.06] text-muted",
};

export function ProtocolEditor(p: Props) {
  const [startDate, setStartDate] = useState(p.startDate ?? "");
  const [status, setStatus] = useState(p.status);
  // "Saved" is time-boxed and parked in sessionStorage, because a save that
  // changes the start date or status changes this component's key on
  // protocols/page.tsx (`id:startDate:status`) and so remounts it before a plain
  // flag could paint. See useSavedFlash — same reason the notice below needs
  // sessionStorage too.
  const { saved, flashSaved, clearSaved } = useSavedFlash("protocol", p.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Non-fatal server notice — today only "the cycle anchor was held because
  // this protocol has logged doses". The save still succeeded, so this must
  // read as information, not as a failure.
  //
  // It is parked in sessionStorage rather than kept in state alone because a
  // SUCCESSFUL save that moves the start date calls revalidatePath AND changes
  // this editor's key, so React REMOUNTS it, discarding component state before anything
  // can be read. (The same remount is what useSavedFlash above works around.)
  // Seeded from an effect, not from useState's initialiser, so the server and
  // the first client render agree and hydration stays clean.
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    try {
      setNotice(sessionStorage.getItem(noticeKey(p.id)));
    } catch {
      /* storage blocked (private mode): the in-state copy is all we get */
    }
  }, [p.id]);

  function showNotice(msg: string | null) {
    setNotice(msg);
    try {
      if (msg) sessionStorage.setItem(noticeKey(p.id), msg);
      else sessionStorage.removeItem(noticeKey(p.id));
    } catch {
      /* ignore — see above */
    }
  }

  async function save() {
    setBusy(true);
    clearSaved();
    setError(null);
    showNotice(null);
    try {
      // Only send the start date when the user actually edited it. An untouched
      // field stays `undefined` (column untouched server-side) so a status-only
      // save can never cascade this card's possibly-stale date across a stack.
      const startDirty = startDate !== (p.startDate ?? "");
      const res = await updateProtocol({
        id: p.id,
        ...(startDirty ? { startDateISO: startDate ? new Date(startDate).toISOString() : null } : {}),
        status,
      });
      if (res.ok) {
        flashSaved();
        showNotice(res.warning ?? null);
      } else setError(res.error ?? "Could not save.");
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
            onChange={(e) => { setStartDate(e.target.value); clearSaved(); }}
            className="mt-1 w-full rounded-control border border-line/15 bg-bg px-3 py-2 text-sm text-ink"
          />
        </label>
        <label className="block flex-1 text-xs text-muted">Status
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value as Props["status"]); clearSaved(); }}
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
      {notice && (
        <div className="mt-2 rounded-control bg-warn/10 p-2 text-sm text-warn ring-1 ring-warn/20" role="status">
          <p>{notice}</p>
          <button type="button" onClick={() => showNotice(null)} className="mt-1 text-xs font-medium underline">
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
