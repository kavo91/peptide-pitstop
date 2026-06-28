"use client";

import { ArrowUp, ArrowDown, Pencil, Trash2, Plus } from "lucide-react";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  addProtocolStep,
  removeProtocolStep,
  updateProtocolStep,
  moveProtocolStep,
} from "@/app/actions/protocols";
import { RampGenerator } from "@/components/RampGenerator";
import { TitrationCalcChart } from "@/components/TitrationCalcChart";
import { type DoseUnit } from "@/lib/dosing/types";

interface Step {
  id: string;
  stepIndex: number;
  dose: string;
  doseInputUnit: string;
  durationDays: string;
  notes: string;
}

const input = "w-full rounded-control border border-line/15 bg-bg px-3 py-2 text-sm text-ink";

function StepRow({
  step,
  doseBasis,
  isFirst,
  isLast,
  busy,
  onBusy,
  onError,
}: {
  step: Step;
  doseBasis: string;
  isFirst: boolean;
  isLast: boolean;
  busy: boolean;
  onBusy: (b: boolean) => void;
  onError: (e: string | null) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [dose, setDose] = useState(step.dose);
  const [unit, setUnit] = useState(step.doseInputUnit);
  const [durationDays, setDurationDays] = useState(step.durationDays);

  async function save() {
    onBusy(true);
    onError(null);
    const res = await updateProtocolStep({
      stepId: step.id,
      dose,
      doseInputUnit: unit,
      durationDays,
    });
    onBusy(false);
    if (res.ok) {
      setEditing(false);
      router.refresh();
    } else {
      onError(res.error ?? "Could not save step.");
    }
  }

  async function remove() {
    onBusy(true);
    onError(null);
    const res = await removeProtocolStep(step.id);
    onBusy(false);
    if (res.ok) router.refresh();
    else onError(res.error ?? "Could not remove step.");
  }

  async function move(dir: "up" | "down") {
    onBusy(true);
    onError(null);
    const res = await moveProtocolStep(step.id, dir);
    onBusy(false);
    if (res.ok) router.refresh();
    else onError(res.error ?? "Could not reorder step.");
  }

  if (editing) {
    return (
      <li className="space-y-2 rounded-control bg-bg p-3 ring-1 ring-line/15">
        <div className="flex items-end gap-2">
          <label className="block flex-1 text-xs text-muted">Dose
            <input
              className={input + " mt-1"}
              inputMode="decimal"
              value={dose}
              onChange={(e) => setDose(e.target.value)}
            />
          </label>
          <label className="block w-24 text-xs text-muted">Unit
            <select className={input + " mt-1"} value={unit} onChange={(e) => setUnit(e.target.value)}>
              {["mcg", "mg", "ml", "units"].map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </label>
          <label className="block w-24 text-xs text-muted">Days
            <input
              className={input + " mt-1"}
              inputMode="numeric"
              value={durationDays}
              onChange={(e) => setDurationDays(e.target.value)}
              placeholder="∞"
            />
          </label>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={save}
            disabled={busy || !dose}
            className="rounded-control bg-accent px-3 py-1.5 text-xs font-medium text-onAccent disabled:opacity-40"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => { setDose(step.dose); setUnit(step.doseInputUnit); setDurationDays(step.durationDays); setEditing(false); }}
            className="rounded-control bg-bg px-3 py-1.5 text-xs ring-1 ring-line/15"
          >
            Cancel
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-center justify-between rounded-control bg-bg px-3 py-2 text-sm ring-1 ring-line/10">
      <span className="tabular-nums">
        Step {step.stepIndex + 1}:{" "}
        <span className="font-medium">{step.dose} {step.doseInputUnit}{doseBasis === "per_week" ? " / week" : ""}</span>
        {step.durationDays
          ? <span className="text-muted"> · {step.durationDays} days</span>
          : <span className="text-muted"> · maintenance</span>}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => move("up")}
          disabled={busy || isFirst}
          className="text-xs text-muted disabled:opacity-30"
          aria-label="Move step up"
        ><ArrowUp className="inline h-4 w-4 align-[-0.125em]" aria-hidden /></button>
        <button
          type="button"
          onClick={() => move("down")}
          disabled={busy || isLast}
          className="text-xs text-muted disabled:opacity-30"
          aria-label="Move step down"
        ><ArrowDown className="inline h-4 w-4 align-[-0.125em]" aria-hidden /></button>
        <button
          type="button"
          onClick={() => setEditing(true)}
          disabled={busy}
          className="text-xs font-medium text-accentStrong disabled:opacity-40"
        ><Pencil className="mr-1 inline h-3.5 w-3.5 align-[-0.125em]" aria-hidden />Edit</button>
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className="text-xs font-medium text-danger disabled:opacity-40"
        ><Trash2 className="mr-1 inline h-3.5 w-3.5 align-[-0.125em]" aria-hidden />Remove</button>
      </div>
    </li>
  );
}

export function StepsEditor({
  protocolId,
  steps,
  doseBasis,
  doseInputUnit,
  injectionsPerWeek,
  startDate = null,
  nowWeek = null,
}: {
  protocolId: string;
  steps: Step[];
  doseBasis: string;
  doseInputUnit: DoseUnit;
  injectionsPerWeek: number | null;
  startDate?: string | null;
  nowWeek?: number | null;
}) {
  const router = useRouter();
  const [dose, setDose] = useState("");
  const [unit, setUnit] = useState<string>(doseInputUnit);
  const [durationDays, setDurationDays] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    const res = await addProtocolStep({ protocolId, dose, doseInputUnit: unit, durationDays });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    router.refresh();
  }

  return (
    <div className="space-y-2">
      {/* Live ramp preview — recomputes from the saved steps after every
          add/edit/remove/generate (router.refresh re-supplies `steps`), so you can
          see how the titration and its per-phase dose-counts change as you set up. */}
      <TitrationCalcChart
        steps={steps.map((s) => ({
          stepIndex: s.stepIndex,
          dose: s.dose,
          doseInputUnit: s.doseInputUnit,
          durationDays: s.durationDays ? Number(s.durationDays) : null,
        }))}
        injectionsPerWeek={injectionsPerWeek}
        doseBasis={doseBasis}
        startDate={startDate}
        nowWeek={nowWeek}
      />
      <RampGenerator
        protocolId={protocolId}
        doseInputUnit={doseInputUnit}
        doseBasis={doseBasis}
        injectionsPerWeek={injectionsPerWeek}
      />
      <ol className="space-y-2">
        {steps.map((s, i) => (
          <StepRow
            key={s.id}
            step={s}
            doseBasis={doseBasis}
            isFirst={i === 0}
            isLast={i === steps.length - 1}
            busy={busy}
            onBusy={setBusy}
            onError={setError}
          />
        ))}
        {steps.length === 0 && (
          <li className="text-sm text-muted">No steps yet — add a titration ramp below.</li>
        )}
      </ol>

      <div className="flex items-end gap-2">
        <label className="block flex-1 text-xs text-muted">Dose
          <input
            className={input + " mt-1"}
            inputMode="decimal"
            value={dose}
            onChange={(e) => setDose(e.target.value)}
            placeholder="e.g. 250"
          />
        </label>
        <label className="block w-24 text-xs text-muted">Unit
          <select className={input + " mt-1"} value={unit} onChange={(e) => setUnit(e.target.value)}>
            {["mcg", "mg", "ml", "units"].map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </label>
        <label className="block w-24 text-xs text-muted">Days
          <input
            className={input + " mt-1"}
            inputMode="numeric"
            value={durationDays}
            onChange={(e) => setDurationDays(e.target.value)}
            placeholder="∞"
          />
        </label>
        <button
          type="button"
          onClick={add}
          disabled={busy || !dose}
          className="rounded-control bg-accent px-4 py-2 text-sm font-medium text-onAccent disabled:opacity-40"
        ><Plus className="mr-1 inline h-4 w-4 align-[-0.125em]" aria-hidden />Add</button>
      </div>
      <p className="text-xs text-muted">Leave Days blank for the final maintenance step.</p>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
