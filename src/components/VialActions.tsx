"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Pencil, FlaskConical, Archive, Trash2, Check, X } from "lucide-react";
import { retireVial, deleteVial } from "@/app/actions/vials";
import { OverflowMenu } from "@/components/OverflowMenu";

export function VialActions({ id, hasPrep = false, doseCount = 0 }: { id: string; hasPrep?: boolean; doseCount?: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retire() {
    setBusy(true);
    setError(null);
    const res = await retireVial(id, "finished");
    setBusy(false);
    if (res.ok) {
      router.refresh();
    } else {
      setError(res.error ?? "Could not retire.");
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    const res = await deleteVial(id);
    setBusy(false);
    if (res.ok) {
      router.refresh();
    } else {
      setError(res.error ?? "Could not delete.");
    }
  }

  const deletePrompt = doseCount > 0
    ? `Permanently delete this vial and its ${doseCount} logged dose${doseCount === 1 ? "" : "s"}? This can't be undone.`
    : "Permanently delete this vial? This can't be undone.";

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
      {confirming ? (
        <>
          <button type="button" disabled={busy} onClick={retire} className="inline-flex items-center gap-1 font-medium text-danger disabled:opacity-40"><Check className="h-3.5 w-3.5" aria-hidden /> {busy ? "…" : "Confirm retire"}</button>
          <button type="button" onClick={() => setConfirming(false)} className="inline-flex items-center gap-1 text-muted"><X className="h-3.5 w-3.5" aria-hidden /> Cancel</button>
        </>
      ) : deleting ? (
        <>
          <span className="text-danger">{deletePrompt}</span>
          <button type="button" disabled={busy} onClick={remove} className="inline-flex items-center gap-1 font-medium text-danger disabled:opacity-40"><Check className="h-3.5 w-3.5" aria-hidden /> {busy ? "…" : "Confirm delete"}</button>
          <button type="button" onClick={() => setDeleting(false)} className="inline-flex items-center gap-1 text-muted"><X className="h-3.5 w-3.5" aria-hidden /> Cancel</button>
        </>
      ) : (
        <>
          {/* Desktop (sm+): inline action row — unchanged from before */}
          <div className="hidden sm:flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <Link href={`/inventory/${id}/edit`} className="inline-flex items-center gap-1 font-medium text-accentStrong"><Pencil className="h-3.5 w-3.5" aria-hidden /> Edit</Link>
            {hasPrep && <Link href={`/inventory/${id}/recon/edit`} className="inline-flex items-center gap-1 font-medium text-accentStrong"><FlaskConical className="h-3.5 w-3.5" aria-hidden /> Edit recon</Link>}
            <button type="button" onClick={() => setConfirming(true)} className="inline-flex items-center gap-1 font-medium text-muted hover:text-danger"><Archive className="h-3.5 w-3.5" aria-hidden /> Retire</button>
            <button type="button" onClick={() => setDeleting(true)} className="inline-flex items-center gap-1 font-medium text-danger"><Trash2 className="h-3.5 w-3.5" aria-hidden /> Delete</button>
          </div>
          {/* Mobile (<sm): same four actions collapsed into an overflow menu */}
          <div className="sm:hidden">
            <OverflowMenu>
              <Link href={`/inventory/${id}/edit`} className="flex items-center gap-2 rounded-control px-3 py-2 font-medium text-accentStrong hover:bg-bg"><Pencil className="h-3.5 w-3.5" aria-hidden /> Edit</Link>
              {hasPrep && <Link href={`/inventory/${id}/recon/edit`} className="flex items-center gap-2 rounded-control px-3 py-2 font-medium text-accentStrong hover:bg-bg"><FlaskConical className="h-3.5 w-3.5" aria-hidden /> Edit recon</Link>}
              <button type="button" onClick={() => setConfirming(true)} className="flex w-full items-center gap-2 rounded-control px-3 py-2 text-left font-medium text-muted hover:bg-bg hover:text-danger"><Archive className="h-3.5 w-3.5" aria-hidden /> Retire</button>
              <button type="button" onClick={() => setDeleting(true)} className="flex w-full items-center gap-2 rounded-control px-3 py-2 text-left font-medium text-danger hover:bg-bg"><Trash2 className="h-3.5 w-3.5" aria-hidden /> Delete</button>
            </OverflowMenu>
          </div>
        </>
      )}
      {error && <span className="text-danger">{error}</span>}
    </div>
  );
}
