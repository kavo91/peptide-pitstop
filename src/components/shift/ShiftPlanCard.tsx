"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CombinedPlan } from "@/lib/schedule/shift-suggest";
import { pinShiftSuggestion } from "@/app/actions/shift";
import { DayCountStrip } from "./DayCountStrip";
import { ShiftDiffGrid } from "./ShiftDiffGrid";
import { ShiftConfirmSheet, type ShiftConfirmInput } from "./ShiftConfirmSheet";
import { ShiftPlanConfirmSheet } from "./ShiftPlanConfirmSheet";
import { confirmInputForMove, dayList, timeList, formatDayKey, gapSentence } from "./format";

/** Per-move lifecycle, mirroring the ask/busy/done/kept shape used elsewhere. */
type RowMode = "busy" | "done" | "kept";

/**
 * The one combined view: the whole plan's week on a single grid, one
 * "Apply all" for the set, and one block per move underneath.
 *
 * The two sets of numbers are deliberately different and both are shown: the
 * grid's Before/After is the week with EVERY move applied, and each move's
 * "Only this" strip is the week that move gives on its own (`standaloneAfter`),
 * so whichever button is pressed the reader has already seen the week it
 * lands. Nothing here is conditional on anything else having been applied —
 * every move's start date, retired doses and gap are measured as if it were
 * the only one.
 */
export function ShiftPlanCard({
  plan,
  suggestions,
  today,
}: {
  plan: CombinedPlan;
  /**
   * The standalone cards, kept as the per-move source of truth for a sheet
   * — narrowed to the fields that sheet actually reads, because everything
   * here crosses the server/client boundary and a whole ShiftSuggestion carries
   * a week's worth of rows nothing on this card renders.
   */
  suggestions: ShiftConfirmInput[];
  today: string;
}) {
  const [planSheetOpen, setPlanSheetOpen] = useState(false);
  const [moveSheetId, setMoveSheetId] = useState<string | null>(null);
  const [rowMode, setRowMode] = useState<Record<string, RowMode>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const router = useRouter();

  const moveCount = plan.moves.length;
  const openMove = plan.moves.find((m) => m.protocolId === moveSheetId) ?? null;

  function setMode(protocolId: string, mode: RowMode | null) {
    setRowMode((prev) => {
      const next = { ...prev };
      if (mode === null) delete next[protocolId];
      else next[protocolId] = mode;
      return next;
    });
  }

  function setError(protocolId: string, message: string | null) {
    setRowError((prev) => {
      const next = { ...prev };
      if (message === null) delete next[protocolId];
      else next[protocolId] = message;
      return next;
    });
  }

  async function keep(protocolId: string) {
    setMode(protocolId, "busy");
    setError(protocolId, null);
    const res = await pinShiftSuggestion({ protocolId, pinned: true });
    if (res.ok) {
      setMode(protocolId, "kept");
      router.refresh();
    } else {
      setMode(protocolId, null);
      setError(protocolId, res.error);
    }
  }

  function applied(protocolId: string) {
    setMoveSheetId(null);
    setMode(protocolId, "done");
    router.refresh();
  }

  return (
    <div
      data-shift-combined
      data-shift-moves={String(moveCount)}
      className="rounded-card bg-surface p-4 ring-1 ring-line/10"
    >
      {/* The week as /doses draws it — a row per protocol, a cell per day —
          with one moved row per move and the two count strips kept as its last
          two rows (same component, same data attributes). */}
      <ShiftDiffGrid
        rows={plan.rows}
        before={plan.before}
        after={plan.after}
        weekStart={plan.weekStart}
        today={today}
        captionId="shift-week-combined"
        caption={`Week of ${formatDayKey(plan.weekStart)} — the first full week with every change in place`}
      />

      {plan.perTime.length > 0 && (
        <>
          <p className="mt-3 text-xs text-muted">
            Days with two doses at the same time: {plan.sameTimeDays.before} → {plan.sameTimeDays.after}
          </p>
          <details className="mt-1 text-xs text-muted">
            {/* min-h-11: a disclosure is a touch target like any other. */}
            <summary className="flex min-h-11 cursor-pointer items-center">Per time of day</summary>
            <ul className="mt-1 space-y-0.5 tabular-nums">
              {plan.perTime.map((pt) => (
                <li key={pt.time}>
                  {pt.time}: {pt.before.join(" ")} → {pt.after.join(" ")}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}

      {/* Only one of this card's two dialogs may be reachable at a time. Both
          attach their own window-level Escape handler, so a keyboard user who
          tabbed past an open overlay into the controls underneath could open
          the second sheet and then close BOTH with one keypress. Disabling the
          other side is the containment. */}
      <button
        type="button"
        data-shift-apply-all
        onClick={() => setPlanSheetOpen(true)}
        disabled={moveSheetId !== null}
        className="mt-4 min-h-11 w-full rounded-control bg-accent px-4 py-3 text-sm font-medium text-onAccent focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-40 sm:w-auto"
      >
        Apply all {moveCount} change{moveCount === 1 ? "" : "s"}
      </button>

      <ul className="mt-4 space-y-3">
        {plan.moves.map((m) => {
          const mode = rowMode[m.protocolId];
          const error = rowError[m.protocolId];
          return (
            <li
              key={m.protocolId}
              data-shift-move={m.protocolId}
              className="rounded-control bg-bg p-3 ring-1 ring-line/10"
            >
              <p className="font-medium">
                {m.peptideName} · {m.protocolName}
              </p>
              <p className="mt-1 text-sm text-muted">
                {dayList(m.fromDays)} → {dayList(m.toDays)}
                {m.times.length > 0 && ` at ${timeList(m.times)}`}
              </p>
              <p className="mt-1 text-sm">First dose on the new days: {formatDayKey(m.startDate)}</p>

              {m.removedDoseDates.length > 0 && (
                <p className="mt-1 text-sm text-muted">
                  Planned doses that will not happen: {m.removedDoseDates.map(formatDayKey).join(", ")}
                </p>
              )}

              <p className="mt-1 text-sm text-muted">{gapSentence(m)}</p>

              {/* The week this ONE move gives, measured over the same week as
                  the grid above — not the grid's After, which is every move
                  together. Both are on the page so neither button promises the
                  other's numbers. */}
              <p className="mt-3 text-xs font-medium text-muted">Applying only this one</p>
              {/* The caption is the strip's accessible NAME, so it carries the
                  peptide: every move in the list has the same visible words
                  above it, and a reader jumping between groups needs to know
                  which move's strip they landed on. */}
              <DayCountStrip
                variant="row"
                rowLabel="Only this"
                label="Only this"
                counts={m.standaloneAfter}
                compareTo={plan.before}
                caption={`Applying only this one — ${m.peptideName}`}
              />

              {error && <p className="mt-2 text-sm text-danger">{error}</p>}

              {mode === "done" ? (
                <p className="mt-3 rounded-control bg-ok/10 px-3 py-2 text-sm font-medium text-ok">
                  Applied — your protocol list is updating.
                </p>
              ) : mode === "kept" ? (
                <p className="mt-3 rounded-control bg-surface px-3 py-2 text-sm text-muted">Kept as is.</p>
              ) : (
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => setMoveSheetId(m.protocolId)}
                    disabled={mode === "busy" || planSheetOpen}
                    className="min-h-11 rounded-control bg-surface px-4 py-3 text-sm font-medium ring-1 ring-line/15 focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-40"
                  >
                    Apply just this
                  </button>
                  <button
                    type="button"
                    onClick={() => keep(m.protocolId)}
                    disabled={mode === "busy" || planSheetOpen}
                    className="min-h-11 min-w-[44px] rounded-control bg-surface px-4 py-3 text-sm ring-1 ring-line/15 focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-40"
                  >
                    {mode === "busy" ? "…" : "Keep as is"}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {planSheetOpen && (
        <ShiftPlanConfirmSheet
          moves={plan.moves}
          onApplied={() => {
            setPlanSheetOpen(false);
            router.refresh();
          }}
          onCancel={() => setPlanSheetOpen(false)}
        />
      )}

      {openMove && (
        <ShiftConfirmSheet
          suggestion={confirmInputForMove(openMove, suggestions)}
          today={today}
          onApplied={() => applied(openMove.protocolId)}
          onCancel={() => setMoveSheetId(null)}
        />
      )}
    </div>
  );
}
