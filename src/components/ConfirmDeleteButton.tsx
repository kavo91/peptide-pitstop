"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Check, X } from "lucide-react";

type DeleteResult = { ok: boolean; error?: string };

interface Props {
  /**
   * The delete to run. Provide EITHER `onDelete` (a bound server action), OR
   * `action` + `id` (an action called as `action(id)`). `onDelete` wins if both
   * are given.
   */
  onDelete?: () => Promise<DeleteResult>;
  action?: (id: string) => Promise<DeleteResult>;
  id?: string;
  /** Danger-styled prompt shown inline once the trigger is armed. */
  confirmMessage: string;
  /**
   * Compact = small icon-only trigger (no "Delete" word). Default renders the
   * Trash2 icon + a label.
   */
  compact?: boolean;
  /** Trigger label (ignored when `compact`). Defaults to "Delete". */
  label?: string;
  /** Optional accessible label for the trigger (e.g. "Delete this protocol"). */
  ariaLabel?: string;
}

/**
 * Reusable inline two-step delete control. Matches the existing idiom in
 * DeleteLogButton / VialActions: a Trash2 trigger flips a `confirming` state to
 * reveal a danger-styled prompt with inline Confirm / Cancel — NO window.confirm,
 * NO modal/dialog. On success it reloads; on failure it shows inline error text.
 *
 * Theme-agnostic: uses the shared danger / muted / text-xs utility classes so it
 * renders correctly under both the current and pitstop designs.
 */
export function ConfirmDeleteButton({ onDelete, action, id, confirmMessage, compact = false, label = "Delete", ariaLabel }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const run = onDelete ?? (id != null && action ? () => action(id) : null);
      if (!run) {
        setError("Nothing to delete.");
        setBusy(false);
        return;
      }
      const res = await run();
      if (res.ok) {
        router.refresh();
        return; // keep `busy` true through the reload so the control stays disabled
      }
      setError(res.error ?? "Could not delete.");
    } catch {
      setError("Could not delete.");
    }
    setBusy(false);
  }

  if (!confirming) {
    return (
      <span className="inline-flex items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          aria-label={ariaLabel ?? (compact ? label : undefined)}
          className="inline-flex items-center gap-1 font-medium text-muted hover:text-danger"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
          {!compact && <span>{label}</span>}
        </button>
        {error && <span className="text-danger">{error}</span>}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-xs">
      <span className="text-danger">{confirmMessage}</span>
      <button
        type="button"
        onClick={remove}
        disabled={busy}
        className="inline-flex items-center gap-1 font-medium text-danger disabled:opacity-40"
      >
        <Check className="h-3.5 w-3.5" aria-hidden /> {busy ? "…" : "Confirm"}
      </button>
      <button
        type="button"
        onClick={() => { setConfirming(false); setError(null); }}
        className="inline-flex items-center gap-1 text-muted"
      >
        <X className="h-3.5 w-3.5" aria-hidden /> Cancel
      </button>
      {error && <span className="text-danger">{error}</span>}
    </span>
  );
}
