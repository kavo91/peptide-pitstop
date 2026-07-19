"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { TrendingUp } from "lucide-react";
import { advanceTitrationPhase } from "@/app/actions/protocols";
import type { TitrationAdvanceSuggestion } from "@/lib/titration/advance-suggest";

/**
 * Offered after logging a dose whose amount matches the NEXT titration step
 * (e.g. 400 mcg logged while the plan is on 200 with 400 next). Pure schedule
 * bookkeeping in response to what the user already logged — accepting truncates
 * the current phase so the plan continues from this dose; declining changes
 * nothing. Mirrors RebasePrompt's ask/busy/done/kept lifecycle.
 */
export function TitrationAdvancePrompt({ advance }: { advance: TitrationAdvanceSuggestion }) {
  const [state, setState] = useState<"ask" | "busy" | "done" | "kept" | "error">("ask");
  const router = useRouter();

  async function accept() {
    setState("busy");
    const res = await advanceTitrationPhase({ protocolId: advance.protocolId, doseLogId: advance.doseLogId });
    setState(res.ok ? "done" : "error");
    if (res.ok) router.refresh();
  }

  function keep() {
    setState("kept");
    router.refresh(); // the logged dose still needs to appear in the today list
  }

  if (state === "done")
    return (
      <p className="rounded-control bg-ok/10 px-3 py-2 text-sm font-medium text-ok">
        Phase {advance.toPhase} brought forward — the plan continues from this dose.
      </p>
    );
  if (state === "kept")
    return <p className="rounded-control bg-bg px-3 py-2 text-sm text-muted">Kept the current plan.</p>;
  if (state === "error")
    return <p className="rounded-control bg-bg px-3 py-2 text-sm text-muted">Couldn&apos;t update the plan — it may have changed. Adjust it in the protocol editor if needed.</p>;
  return (
    <div className="rounded-card bg-warn/10 p-3 text-sm">
      <p className="mb-2">
        This {advance.peptideName} dose ({advance.doseLabel}) matches <strong>Phase {advance.toPhase} of {advance.phaseCount}</strong> — your plan is on Phase {advance.fromPhase}. Bring Phase {advance.toPhase} forward so the plan continues from this dose?
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={accept} disabled={state === "busy"} className="flex flex-1 items-center justify-center gap-1.5 rounded-control bg-accent px-3 py-2 font-medium text-onAccent disabled:opacity-40">
          {state === "busy" ? "…" : <><TrendingUp className="h-4 w-4" aria-hidden /> Bring phase forward</>}
        </button>
        <button type="button" onClick={keep} className="rounded-control bg-bg px-3 py-2 ring-1 ring-line/15">
          Keep current plan
        </button>
      </div>
    </div>
  );
}
