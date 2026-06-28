"use client";

import { Sparkles } from "lucide-react";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addProtocolSteps } from "@/app/actions/protocols";
import { generateRamp } from "@/lib/titration/generate-ramp";
import { type DoseUnit } from "@/lib/dosing/types";

const input = "w-full rounded-control border border-line/15 bg-bg px-3 py-2 text-sm text-ink";

/**
 * Auto-generates an editable titration ramp: start → target in fixed increments,
 * each step `weeksPerStep` long, final step indefinite. Each generated step is
 * persisted via addProtocolSteps (atomic batch — all-or-nothing, no partial ramp),
 * then the page reloads to show them in StepsEditor.
 *
 * Dose unit follows the protocol's doseInputUnit. For a per_week protocol the
 * doses entered here are weekly totals (the resolver divides per injection);
 * generation is blocked when the injection frequency is unknown.
 */
export function RampGenerator({
  protocolId,
  doseInputUnit,
  doseBasis,
  injectionsPerWeek,
}: {
  protocolId: string;
  doseInputUnit: DoseUnit;
  doseBasis: string;
  injectionsPerWeek: number | null;
}) {
  const router = useRouter();
  const [startDose, setStartDose] = useState("");
  const [targetDose, setTargetDose] = useState("");
  const [increment, setIncrement] = useState("");
  const [weeksPerStep, setWeeksPerStep] = useState("4");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const perWeek = doseBasis === "per_week";
  const blocked = perWeek && (injectionsPerWeek == null || injectionsPerWeek <= 0);
  const unitLabel = perWeek ? `${doseInputUnit}/week` : doseInputUnit;

  async function generate() {
    setBusy(true);
    setError(null);
    let steps;
    try {
      steps = generateRamp({
        startDose,
        targetDose,
        increment,
        weeksPerStep: Number(weeksPerStep),
        doseInputUnit,
      });
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : "Could not generate the ramp.");
      return;
    }
    // Persist the whole ramp atomically — a failure adds nothing, so the
    // generator can never leave a partial, orphaned set of steps.
    const res = await addProtocolSteps({
      protocolId,
      steps: steps.map((step) => ({
        dose: step.dose,
        doseInputUnit: step.doseInputUnit,
        durationDays: step.durationDays == null ? undefined : String(step.durationDays),
      })),
    });
    if (!res.ok) {
      setBusy(false);
      setError(res.error ?? "Could not add the generated steps.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-2 rounded-control bg-bg p-3 ring-1 ring-line/15">
      <p className="text-xs font-medium text-muted">Auto-generate ramp ({unitLabel})</p>
      <div className="flex items-end gap-2">
        <label className="block flex-1 text-xs text-muted">Start
          <input className={input + " mt-1"} inputMode="decimal" value={startDose} onChange={(e) => setStartDose(e.target.value)} placeholder="e.g. 2" />
        </label>
        <label className="block flex-1 text-xs text-muted">Target
          <input className={input + " mt-1"} inputMode="decimal" value={targetDose} onChange={(e) => setTargetDose(e.target.value)} placeholder="e.g. 8" />
        </label>
      </div>
      <div className="flex items-end gap-2">
        <label className="block flex-1 text-xs text-muted">Increment
          <input className={input + " mt-1"} inputMode="decimal" value={increment} onChange={(e) => setIncrement(e.target.value)} placeholder="e.g. 2" />
        </label>
        <label className="block flex-1 text-xs text-muted">Weeks / step
          <input className={input + " mt-1"} inputMode="numeric" value={weeksPerStep} onChange={(e) => setWeeksPerStep(e.target.value)} placeholder="e.g. 4" />
        </label>
        <button
          type="button"
          onClick={generate}
          disabled={busy || blocked || !startDose || !targetDose || !increment}
          className="rounded-control bg-accent px-4 py-2 text-sm font-medium text-onAccent disabled:opacity-40"
        ><Sparkles className="mr-1.5 inline h-4 w-4 align-[-0.125em]" aria-hidden />Generate</button>
      </div>
      {blocked && (
        <p className="text-xs text-warn">Set a weekly schedule first — per-week dosing needs a known injection frequency.</p>
      )}
      <p className="text-xs text-muted">Builds steps from start to target; the final step is the indefinite maintenance dose.</p>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
