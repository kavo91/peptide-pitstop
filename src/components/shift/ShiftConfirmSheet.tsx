"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ShiftSuggestion } from "@/lib/schedule/shift-suggest";
// dayKey/parseDayKey have one home — shift-transition.ts. Never import
// either from shift-suggest.ts here: it value-imports `node:crypto` and must
// never load into a client bundle.
import { transitionPreview, parseDayKey, dayKey } from "@/lib/schedule/shift-transition";
import { applyShiftSuggestion } from "@/app/actions/shift";
import { dayList, timeList, formatDayKey, gapSentence } from "./format";

/**
 * Exactly the fields this sheet reads. A `CombinedMove` carries every one
 * of them with the same meaning and the same values as the standalone card
 * would, so one move of the combined plan can open this sheet directly
 * without a caller inventing the week-shaped fields — rows, per-time counts,
 * before/after — that a whole `ShiftSuggestion` would have to carry and this
 * sheet never touches.
 */
export type ShiftConfirmInput = Pick<
  ShiftSuggestion,
  | "protocolId"
  | "peptideName"
  | "k"
  | "fromDays"
  | "toDays"
  | "times"
  | "startDate"
  | "lastDoseDate"
  | "usualGapDays"
  | "protocolStartDate"
  | "courseEndDate"
  | "fingerprint"
>;

function addDaysToKey(key: string, n: number): string {
  const d = parseDayKey(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

/**
 * Confirm sheet for one Apply, modelled on ReviseProtocolDialog's shell. The
 * date input picks the EARLIEST acceptable day, not necessarily a day the
 * rotated pattern runs on. The server snaps it forward to the real first dose
 * with `snapStartToPattern` (src/lib/schedule/shift-transition.ts) before ever
 * touching the DB; `transitionPreview`, built on that same function, derives a
 * CLIENT-SIDE-ONLY preview of the same thing — the real first dose, which
 * planned doses are retired (honouring the course end), and the true
 * gap — and recomputes it as the date input changes. It is a preview, never
 * the number Apply acts on: the server recomputes the real transition (and
 * the whole rotation) from scratch against the fingerprinted protocol state,
 * exactly like every other field here.
 */
export function ShiftConfirmSheet({
  suggestion,
  today,
  onApplied,
  onCancel,
}: {
  suggestion: ShiftConfirmInput;
  today: string;
  onApplied: () => void;
  onCancel: () => void;
}) {
  const [startDate, setStartDate] = useState(suggestion.startDate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changedNotice, setChangedNotice] = useState(false);
  const dateRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    dateRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  // A dose for THIS protocol already logged today is a fact about the
  // suggestion as computed (`lastDoseDate` is the most recent logged/surviving
  // day on or before today) — the sheet has no live doseLog access of its own.
  const todayLogged = suggestion.lastDoseDate === today;
  const preview = transitionPreview({
    fromDays: suggestion.fromDays,
    toDays: suggestion.toDays,
    today: parseDayKey(today),
    earliest: parseDayKey(startDate),
    todayLogged,
    lastDoseDate: suggestion.lastDoseDate,
    usualGapDays: suggestion.usualGapDays,
    // Same floor the server's snap applies (a revision never starts on or
    // before the protocol's own first day), so the preview matches Apply.
    protocolStartDate: suggestion.protocolStartDate ? parseDayKey(suggestion.protocolStartDate) : null,
    // A day after the course end was never a planned dose, so it must
    // never show up as one about to be removed.
    courseEnd: suggestion.courseEndDate ? parseDayKey(suggestion.courseEndDate) : null,
  });
  const maxDate = addDaysToKey(today, 14);

  async function confirm() {
    setBusy(true);
    setError(null);
    setChangedNotice(false);
    const res = await applyShiftSuggestion({
      protocolId: suggestion.protocolId,
      k: suggestion.k,
      startDate,
      fingerprint: suggestion.fingerprint,
    });
    setBusy(false);
    if (res.ok) {
      onApplied();
      return;
    }
    if (res.code === "changed" || res.code === "race") {
      setChangedNotice(true);
      router.refresh();
      return;
    }
    setError(res.error);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Apply day shift"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-card bg-surface p-5 shadow-lg ring-1 ring-line/10">
        <h2 className="text-lg font-semibold">
          Move {suggestion.peptideName} to {dayList(suggestion.toDays)}?
        </h2>
        <p className="mt-1 text-sm text-muted">
          {dayList(suggestion.fromDays)} → {dayList(suggestion.toDays)}
          {suggestion.times.length > 0 && ` at ${timeList(suggestion.times)}`}
        </p>

        <label className="mt-4 block text-sm text-muted">
          Start on or after
          <input
            ref={dateRef}
            type="date"
            className="mt-1 w-full rounded-control border border-line/15 bg-bg px-3 py-2 text-sm text-ink"
            value={startDate}
            min={today}
            max={maxDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </label>

        <p className="mt-2 text-sm text-muted">First dose on the new days: {formatDayKey(preview.startDate)}</p>

        {preview.removedDoseDates.length > 0 && (
          <p className="mt-2 text-sm text-muted">
            Planned doses that will not happen: {preview.removedDoseDates.map(formatDayKey).join(", ")}
          </p>
        )}

        <p className="mt-3 text-sm text-muted">
          {gapSentence({
            lastDoseDate: suggestion.lastDoseDate,
            gapDays: preview.gapDays,
            usualGapDays: suggestion.usualGapDays,
            shorterThanUsual: preview.shorterThanUsual,
          })}
        </p>

        {changedNotice && (
          <p className="mt-3 text-sm text-warn">The schedule changed — the suggestions have been refreshed.</p>
        )}
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={confirm}
            disabled={busy}
            className="flex-1 rounded-control bg-accent px-4 py-3 font-medium text-onAccent disabled:opacity-40"
          >
            {busy ? "…" : "Confirm"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-control bg-bg px-4 py-3 text-sm ring-1 ring-line/15 disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
