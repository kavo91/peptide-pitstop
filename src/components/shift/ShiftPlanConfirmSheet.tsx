"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CombinedMove } from "@/lib/schedule/shift-suggest";
import { applyShiftPlan } from "@/app/actions/shift";
import { dayList, formatDayKey } from "./format";

/**
 * Confirm sheet for the whole combined plan — the same shell as
 * ShiftConfirmSheet, one step simpler: there is no date to edit here, because
 * every move carries the start date its own row already showed.
 *
 * `applyShiftPlan` lands the moves one after another through the same
 * single-move path, stopping at the first that cannot be applied — there is no
 * multi-protocol transaction, so a partial result is a real outcome and is
 * reported as one rather than swallowed. The moves that did land are ordinary
 * revisions and stay applied.
 *
 * On a partial the refresh is DEFERRED to the close, not fired next to the
 * message: refreshing redraws the panel, and if the new schedule has no plan
 * left to offer, ShiftPanel swaps this card for its flat state and unmounts
 * this sheet — taking the only record of what actually happened with it. The
 * refresh runs when the reader closes the sheet instead.
 */
export function ShiftPlanConfirmSheet({
  moves,
  onApplied,
  onCancel,
}: {
  moves: CombinedMove[];
  onApplied: () => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [partial, setPartial] = useState<string | null>(null);
  const [staleUntilClose, setStaleUntilClose] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();

  // Confirm, not Cancel: this sheet has no field to fill in, so the button the
  // reader arrived for is the one that should already hold focus.
  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  // Closing after a partial apply is what fires the refresh the partial branch
  // deliberately did not — see the header. Escape closes through the same
  // function as the button, so neither route can skip it.
  const close = useCallback(() => {
    onCancel();
    if (staleUntilClose) router.refresh();
  }, [onCancel, router, staleUntilClose]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close]);

  async function confirm() {
    setBusy(true);
    setError(null);
    setPartial(null);
    try {
      // Only the four fields the action validates — never the display facts.
      const res = await applyShiftPlan({
        moves: moves.map((m) => ({
          protocolId: m.protocolId,
          k: m.k,
          startDate: m.startDate,
          fingerprint: m.fingerprint,
        })),
      });
      setBusy(false);
      if (res.ok) {
        onApplied();
        return;
      }
      // The run stops at the first move that fails, so at most one result is
      // a failure and it is the last one present. Name the protocol by the
      // move it came from — the reader knows these by peptide, not by id.
      let failed: { protocolId: string; error: string } | null = null;
      for (const r of res.results) {
        if (!r.ok) {
          failed = { protocolId: r.protocolId, error: r.error };
          break;
        }
      }
      // Plan-level rejections (an expired session, a malformed or over-long
      // batch) carry protocolId "" and match no move, so the name is missing —
      // the REASON is shown either way. Without this an expired session on
      // Apply-all read "Applied 0 of 3." with nothing to explain it.
      const name = failed ? moves.find((m) => m.protocolId === failed?.protocolId)?.peptideName : undefined;
      const count = `Applied ${res.appliedCount} of ${moves.length}.`;
      const reason = failed ? (name ? `${name}: ${failed.error}` : failed.error) : null;
      setPartial(reason ? `${count} ${reason}` : count);
      // NOT router.refresh() — see the header. The panel this sheet lives in
      // can disappear on a refresh, and this message is the only record of a
      // partial apply.
      setStaleUntilClose(true);
    } catch {
      // A thrown action (a dropped connection mid-request, say) says nothing
      // about how many moves landed, so this sentence claims nothing either.
      setBusy(false);
      setError("Could not apply the changes. Refresh to see the current schedule.");
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Apply all changes"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-card bg-surface p-5 shadow-lg ring-1 ring-line/10">
        <h2 className="text-lg font-semibold">
          Apply all {moves.length} change{moves.length === 1 ? "" : "s"}?
        </h2>

        <ul className="mt-3 space-y-2 text-sm">
          {moves.map((m) => (
            <li key={m.protocolId} data-shift-plan-move={m.protocolId}>
              {m.peptideName}: {dayList(m.fromDays)} → {dayList(m.toDays)}, first dose {formatDayKey(m.startDate)}
            </li>
          ))}
        </ul>

        {/* The truthful version of "the ones before it stay applied": the
            moves are ordered so each step is the best one available from the
            step before it, but a plan is chosen as a whole, so part of one is
            not a smaller version of it. */}
        <p className="mt-3 text-sm text-muted">
          Changes are applied one after another. If one cannot be applied, the ones before it stay applied — and a
          part of the plan can leave a day busier than it is now.
        </p>

        {partial && <p className="mt-3 text-sm text-warn">{partial}</p>}
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}

        <div className="mt-5 flex gap-2">
          {/* After a partial, Confirm would re-send moves that already landed
              (and would be refused as "changed"), so the only thing left to do
              is read the message and close. */}
          <button
            ref={confirmRef}
            type="button"
            onClick={confirm}
            disabled={busy || partial !== null}
            className="min-h-11 flex-1 rounded-control bg-accent px-4 py-3 font-medium text-onAccent disabled:opacity-40"
          >
            {busy ? "…" : "Confirm"}
          </button>
          <button
            type="button"
            onClick={close}
            disabled={busy}
            className="min-h-11 rounded-control bg-bg px-4 py-3 text-sm ring-1 ring-line/15 disabled:opacity-40"
          >
            {partial === null ? "Cancel" : "Close"}
          </button>
        </div>
      </div>
    </div>
  );
}
