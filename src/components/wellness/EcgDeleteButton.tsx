"use client";

/**
 * Delete one imported ECG recording. Two clicks: the second confirms.
 *
 * The recording and the report PDF go together — the trace lives in the row and
 * the report in the file, and keeping one without the other would leave a
 * half-record. Nothing here is recoverable, hence the confirm step.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deleteEcgRecording } from "@/app/actions/ecg";

export function EcgDeleteButton({ id, backTo = "/journal" }: { id: string; backTo?: string }) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!armed) { setArmed(true); return; }
          setError(null);
          start(async () => {
            const res = await deleteEcgRecording(id);
            if (!res.ok) { setError(res.error ?? "Could not delete this recording."); setArmed(false); return; }
            router.replace(backTo);
            router.refresh();
          });
        }}
        className={`inline-flex items-center gap-1.5 rounded-control px-3 py-2 text-xs font-medium disabled:opacity-40 ${
          // `text-bg` rather than a literal white: the page ground is near-white
          // in the light themes and near-black in the dark ones, so it is the readable
          // pair against --danger in both instead of only one.
          armed ? "bg-danger text-bg" : "bg-bg text-muted ring-1 ring-line/15 hover:text-danger"
        }`}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
        {pending ? "Deleting…" : armed ? "Delete for good" : "Delete recording"}
      </button>
      {armed && !pending && (
        <button type="button" onClick={() => setArmed(false)} className="text-xs font-medium text-muted hover:text-ink">
          Keep it
        </button>
      )}
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
    </div>
  );
}
