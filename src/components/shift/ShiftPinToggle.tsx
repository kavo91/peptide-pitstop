"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { pinShiftSuggestion } from "@/app/actions/shift";

/**
 * Toggles `Protocol.shiftPinned`. Two shapes for the two places it appears:
 * a checkbox on the edit page (set/unset either way) and a small "Offer
 * again" button in the panel's collapsed "Kept as is" list (unset only).
 */
export function ShiftPinToggle({
  protocolId,
  pinned,
  mode,
}: {
  protocolId: string;
  pinned: boolean;
  mode: "checkbox" | "button";
}) {
  const [checked, setChecked] = useState(pinned);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function toggle(next: boolean) {
    setBusy(true);
    setError(null);
    const res = await pinShiftSuggestion({ protocolId, pinned: next });
    setBusy(false);
    if (res.ok) {
      setChecked(next);
      router.refresh();
    } else {
      setError(res.error);
    }
  }

  if (mode === "button") {
    return (
      <div className="shrink-0">
        <button
          type="button"
          onClick={() => toggle(false)}
          disabled={busy}
          className="min-h-[44px] rounded-control bg-bg px-3 py-2.5 text-sm ring-1 ring-line/15 disabled:opacity-40"
        >
          {busy ? "…" : "Offer again"}
        </button>
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={checked}
          disabled={busy}
          onChange={(e) => toggle(e.target.checked)}
          className="mt-0.5"
        />
        <span>Shift suggestions: kept as is</span>
      </label>
      <p className="mt-1 text-xs text-muted">
        When ticked, the Smooth-your-week panel leaves this protocol where it is.
      </p>
      {error && <p className="mt-1 text-sm text-danger">{error}</p>}
    </div>
  );
}
