"use client";

/**
 * The user's illness / travel / other windows: label, kind pill, date range,
 * two-step delete → server action → router.refresh(). Mirrors DeleteScanButton.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Check, X } from "lucide-react";
import { deleteLifeEvent } from "@/app/actions/lifeevents";
import type { LifeEventKind } from "@/app/actions/lifeevents";
import { BODY_COPY } from "@/lib/bodycomp-copy";
import { PILL } from "./format";

export interface LifeEventListItem {
  id: string;
  kind: LifeEventKind;
  startDay: string;
  endDay: string;
  label: string | null;
  notes: string | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "YYYY-MM-DD" → "4 Jun '26" without constructing a Date (no timezone shift, no locale). */
function fmtDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]} '${String(y).slice(2)}`;
}
const inclusiveDays = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;

function kindPill(kind: LifeEventKind): { cls: string; label: string } {
  switch (kind) {
    case "illness": return { cls: `${PILL} bg-warn/10 text-warn`, label: "illness" };
    case "travel": return { cls: `${PILL} bg-accent/10 text-accentStrong`, label: "travel" };
    default: return { cls: `${PILL} bg-line/[0.08] text-muted`, label: "other" };
  }
}

function DeleteButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    const res = await deleteLifeEvent(id);
    setBusy(false);
    if (res.ok) router.refresh();
    else setError(res.error ?? "Could not delete.");
  }

  if (!confirming) {
    return (
      <span className="flex items-center gap-2 text-xs">
        <button type="button" onClick={() => setConfirming(true)} aria-label={`Delete window ${label}`} className="inline-flex min-h-[40px] min-w-[40px] items-center gap-1 px-1 font-medium text-muted hover:text-danger"><Trash2 className="h-3.5 w-3.5" aria-hidden /> Delete</button>
        {error && <span className="text-danger">{error}</span>}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2 text-xs">
      <span className="text-muted">{BODY_COPY.lifeEventDeleteConfirm}</span>
      <button type="button" onClick={remove} disabled={busy} className="inline-flex min-h-[40px] min-w-[40px] items-center gap-1 px-1 font-medium text-danger disabled:opacity-40"><Check className="h-3.5 w-3.5" aria-hidden /> {busy ? "…" : "Confirm"}</button>
      <button type="button" onClick={() => setConfirming(false)} className="inline-flex min-h-[40px] min-w-[40px] items-center gap-1 px-1 text-muted"><X className="h-3.5 w-3.5" aria-hidden /> Cancel</button>
      {error && <span className="text-danger">{error}</span>}
    </span>
  );
}

export function LifeEventList({ events }: { events: LifeEventListItem[] }) {
  if (events.length === 0) return <p className="text-xs text-muted">{BODY_COPY.lifeEventsEmpty}</p>;
  return (
    <ul className="divide-y divide-line/10">
      {events.map((e) => {
        const pill = kindPill(e.kind);
        const range = e.startDay === e.endDay ? fmtDay(e.startDay) : `${fmtDay(e.startDay)} → ${fmtDay(e.endDay)}`;
        const days = inclusiveDays(e.startDay, e.endDay);
        const title = e.label ?? pill.label;
        return (
          <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span className="flex flex-wrap items-center gap-2">
              <span className={pill.cls}>{pill.label}</span>
              <span className="font-medium text-ink">{e.label ?? "—"}</span>
              <span className="tabular-nums text-muted">{range}</span>
              <span className="text-[10px] text-muted">{days} day{days === 1 ? "" : "s"}</span>
              {e.notes && <span className="basis-full text-xs text-muted">{e.notes}</span>}
            </span>
            <DeleteButton id={e.id} label={`${title} ${range}`} />
          </li>
        );
      })}
    </ul>
  );
}
