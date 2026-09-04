"use client";

/**
 * Add an illness / travel / other window. Days inside a window are shaded on
 * every chart, excluded from interval medians and counted — a window is a
 * confounder tag, never an explanation. Every control carries a label.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createLifeEvent, type LifeEventKind } from "@/app/actions/lifeevents";
import { BODY_COPY } from "@/lib/bodycomp-copy";

const KINDS: { value: LifeEventKind; label: string }[] = [
  { value: "illness", label: "Illness" },
  { value: "travel", label: "Travel" },
  { value: "other", label: "Other" },
];

const inputCls = "mt-1 w-full rounded-control border border-line/15 bg-bg px-3 py-2 text-sm";
const labelCls = "block text-xs text-muted";

export function LifeEventForm() {
  const router = useRouter();
  const [kind, setKind] = useState<LifeEventKind>("illness");
  const [startDay, setStartDay] = useState("");
  const [endDay, setEndDay] = useState("");
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    const res = await createLifeEvent({ kind, startDay, endDay: endDay || startDay, label, notes });
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Could not save the window.");
      return;
    }
    setStartDay("");
    setEndDay("");
    setLabel("");
    setNotes("");
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label="Add an illness or travel window">
      <label htmlFor="life-event-kind" className={labelCls}>
        Kind
        <select id="life-event-kind" value={kind} onChange={(e) => setKind(e.target.value as LifeEventKind)} className={inputCls}>
          {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
      </label>
      <label htmlFor="life-event-label" className={labelCls}>
        Label
        <input id="life-event-label" type="text" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder="flu" className={inputCls} />
        <span className="mt-1 block text-[10px] text-muted">{BODY_COPY.lifeEventLabelHint}</span>
      </label>
      <label htmlFor="life-event-start" className={labelCls}>
        Start day<span className="text-danger"> *</span>
        <input id="life-event-start" type="date" required value={startDay} onChange={(e) => setStartDay(e.target.value)} className={inputCls} />
      </label>
      <label htmlFor="life-event-end" className={labelCls}>
        End day (inclusive)
        <input id="life-event-end" type="date" value={endDay} min={startDay || undefined} onChange={(e) => setEndDay(e.target.value)} className={inputCls} />
        <span className="mt-1 block text-[10px] text-muted">{BODY_COPY.lifeEventEndHint}</span>
      </label>
      <label htmlFor="life-event-notes" className={`${labelCls} sm:col-span-2`}>
        Notes (encrypted)
        <textarea id="life-event-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputCls} />
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button type="submit" disabled={busy || !startDay} className="inline-flex items-center gap-1 rounded-control bg-accent px-3 py-1.5 text-sm font-medium text-onAccent disabled:opacity-40">
          <Plus className="h-4 w-4" aria-hidden /> {busy ? "Saving…" : "Add window"}
        </button>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        {saved && !error && <p role="status" className="text-xs text-muted">{BODY_COPY.lifeEventSaved}</p>}
      </div>
    </form>
  );
}
