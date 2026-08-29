"use client";

import type { CarryStep } from "@/lib/protocol-revision";

const input = "w-full rounded-control border border-line/15 bg-bg px-3 py-2 text-sm text-ink";

/**
 * Confirm a protocol revision. Shows what changed, which ladder step is being
 * resumed, and the carried-forward steps — editable, because the carry-forward
 * is a judgement (calendar length is preserved, so the dose count inside each
 * step moves with the new frequency) and it should be visible, not silent.
 */
export function ReviseProtocolDialog({
  changedFields,
  resumedDose,
  steps,
  startDate,
  minStartDate,
  busy,
  error,
  onStartDateChange,
  onStepsChange,
  onConfirm,
  onCancel,
}: {
  changedFields: string[];
  resumedDose: string | null;
  steps: CarryStep[];
  startDate: string;
  /**
   * Earliest date the revision may start — the day after the protocol it
   * replaces. reviseProtocol refuses anything on or before that (a backdated
   * revision gives the predecessor an endDate before its own startDate and
   * inverts the course lineage); this stops the user reaching that error.
   */
  minStartDate?: string;
  busy: boolean;
  error: string | null;
  onStartDateChange: (v: string) => void;
  onStepsChange: (s: CarryStep[]) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div role="dialog" aria-modal="true" aria-label="Revise protocol"
         className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-card bg-surface p-5 shadow-lg ring-1 ring-line/10">
        <h2 className="text-lg font-semibold">Revise this protocol?</h2>
        <p className="mt-1 text-sm text-muted">
          You changed the <strong>{changedFields.join(", ")}</strong>. Editing that in place would re-time
          every titration step and move you along your own ladder, so the current protocol is completed
          and a new one starts — your logged doses stay with the protocol they were taken under.
        </p>

        {resumedDose && (
          <p className="mt-3 rounded-control bg-accent/10 px-3 py-2 text-sm">
            Resuming at <strong>{resumedDose}</strong> — the dose you are on today.
          </p>
        )}

        <label className="mt-4 block text-sm text-muted">New protocol starts
          <input type="date" className={input + " mt-1"} value={startDate} min={minStartDate}
                 onChange={(e) => onStartDateChange(e.target.value)} />
        </label>

        {steps.length > 0 && (
          <div className="mt-4">
            <p className="text-sm font-medium">Remaining ladder</p>
            <p className="mb-2 text-xs text-muted">
              Lengths are in days and carry over unchanged; only the step you are on is shortened by the
              time already served in it. Edit before confirming if this is not what you want.
            </p>
            <ul className="space-y-2">
              {steps.map((s, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 text-sm tabular-nums">{s.dose} {s.doseInputUnit}</span>
                  <input className={input} inputMode="numeric" placeholder="open-ended"
                         aria-label={`Days for the ${s.dose} ${s.doseInputUnit} step`}
                         value={s.durationDays ?? ""}
                         onChange={(e) => {
                           const v = e.target.value.trim();
                           const next = [...steps];
                           next[i] = { ...s, durationDays: v === "" ? null : Number(v) };
                           onStepsChange(next);
                         }} />
                  <span className="shrink-0 text-xs text-muted">days</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}

        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onConfirm} disabled={busy}
                  className="flex-1 rounded-control bg-accent px-4 py-3 font-medium text-onAccent disabled:opacity-40">
            {busy ? "…" : "Revise protocol"}
          </button>
          <button type="button" onClick={onCancel} disabled={busy}
                  className="rounded-control bg-bg px-4 py-3 text-sm ring-1 ring-line/15">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
