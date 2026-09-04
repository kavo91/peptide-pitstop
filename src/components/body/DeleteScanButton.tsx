"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Check, X } from "lucide-react";
import { deleteBodyCompScan } from "@/app/actions/bodycomp";

/** Two-step confirm → server action → router.refresh(). Mirrors DeleteLabPanelButton. */
export function DeleteScanButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    const res = await deleteBodyCompScan(id);
    setBusy(false);
    if (res.ok) {
      router.refresh();
    } else {
      setError(res.error ?? "Could not delete.");
    }
  }

  if (!confirming) {
    return (
      <span className="flex items-center gap-2 text-xs">
        <button type="button" onClick={() => setConfirming(true)} aria-label={`Delete scan ${label}`} className="inline-flex min-h-[40px] min-w-[40px] items-center gap-1 px-1 font-medium text-muted hover:text-danger"><Trash2 className="h-3.5 w-3.5" aria-hidden /> Delete</button>
        {error && <span className="text-danger">{error}</span>}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2 text-xs">
      <span className="text-muted">Delete this scan and its regions?</span>
      <button type="button" onClick={remove} disabled={busy} className="inline-flex min-h-[40px] min-w-[40px] items-center gap-1 px-1 font-medium text-danger disabled:opacity-40"><Check className="h-3.5 w-3.5" aria-hidden /> {busy ? "…" : "Confirm"}</button>
      <button type="button" onClick={() => setConfirming(false)} className="inline-flex min-h-[40px] min-w-[40px] items-center gap-1 px-1 text-muted"><X className="h-3.5 w-3.5" aria-hidden /> Cancel</button>
      {error && <span className="text-danger">{error}</span>}
    </span>
  );
}
