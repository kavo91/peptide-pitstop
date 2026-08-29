"use client";

/**
 * Build a stack: a named group of already-reconstituted (premixed) vials, each
 * created as a real volume-dosed protocol. One save → peptide + vial(s) + premixed
 * prep + protocol per component, linked under the stack.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Layers, Plus, Save, X } from "lucide-react";
import { createStack } from "@/app/actions/stacks";
import { perInjectionMcg, vialLabelStrengthMg } from "@/lib/stacks/compute";
import Decimal from "decimal.js";
import { generateRamp } from "@/lib/titration/generate-ramp";
import { trackingDayOf } from "@/lib/local-day";

const RAMP_UNITS = ["mcg", "mg", "ml"] as const; // no "units": syringe-relative, refused server-side
type RampUnit = (typeof RAMP_UNITS)[number];

interface RampDraft {
  startDose: string;
  targetDose: string;
  increment: string;
  weeksPerStep: string;
  unit: RampUnit;
}
const emptyRamp = (): RampDraft => ({ startDose: "", targetDose: "", increment: "", weeksPerStep: "2", unit: "mcg" });

/** An untouched ramp panel (all dose fields blank) is treated as no ramp at all. */
function rampIsBlank(r: RampDraft): boolean {
  return !r.startDose.trim() && !r.targetDose.trim() && !r.increment.trim();
}

/** Human preview of the generated ladder, or the domain error — never throws. */
function rampPreview(r: RampDraft): { ok: boolean; text: string } | null {
  if (!r.startDose.trim() || !r.targetDose.trim() || !r.increment.trim()) return null;
  try {
    const steps = generateRamp({
      startDose: r.startDose,
      targetDose: r.targetDose,
      increment: r.increment,
      weeksPerStep: Number(r.weeksPerStep),
      doseInputUnit: r.unit,
    });
    return { ok: true, text: `${steps.map((s) => s.dose).join(" → ")} ${r.unit} · ${r.weeksPerStep} wk/step · ${steps.length} phases` };
  } catch (e) {
    return { ok: false, text: e instanceof Error ? e.message : "invalid ramp" };
  }
}

const field = "rounded-control border border-line/15 bg-bg px-3 py-2 text-sm text-ink";
const input = `w-full ${field}`;

interface Row {
  name: string;
  conc: string; // mcg/ml
  vialMl: string; // vial size
  qty: string;
  doseMl: string;
  /** Optional per-component titration ladder (the unit is the user's choice). */
  ramp: RampDraft | null;
}
const emptyRow = (): Row => ({ name: "", conc: "", vialMl: "5", qty: "1", doseMl: "0.2", ramp: null });

export function StackBuilder({ options }: { options: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [rows, setRows] = useState<Row[]>([emptyRow(), emptyRow()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Shared start date for every component protocol — required once any ramp
  // exists (an inert ladder must not be creatable); defaults to today.
  const [startDate, setStartDate] = useState(() => trackingDayOf(new Date()));
  // Lockstep helper: one cadence applied to every ramped component so all
  // ladders share identical phase boundaries.
  const [lockWeeks, setLockWeeks] = useState("2");
  const [lockSteps, setLockSteps] = useState("3");

  const anyRamp = rows.some((r) => r.ramp);

  function applyLockstep() {
    const n = Math.floor(Number(lockSteps));
    const wk = Number(lockWeeks);
    if (!Number.isFinite(n) || n < 2) return setError("Lockstep needs at least 2 phases.");
    if (!Number.isFinite(wk) || wk <= 0) return setError("Lockstep needs weeks per step > 0.");
    setError(null);
    const skipped: string[] = [];
    setRows((rs) =>
      rs.map((r, idx) => {
        if (!r.ramp) return r;
        const a = Number(r.ramp.startDose);
        const b = Number(r.ramp.targetDose);
        if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) {
          skipped.push(r.name.trim() || `component ${idx + 1}`);
          return r;
        }
        // Round the increment UP (8 dp): rounding down makes generateRamp's
        // while(cur < target) under-shoot and append a phantom extra phase, so
        // one lockstep click could give components DIFFERENT phase counts.
        const inc = new Decimal(b).minus(a).div(n - 1).toDecimalPlaces(8, Decimal.ROUND_UP).toString();
        return { ...r, ramp: { ...r.ramp, increment: inc, weeksPerStep: String(wk) } };
      }),
    );
    if (skipped.length > 0) setError(`Lockstep skipped ${skipped.join(", ")} — set start and target (start < target) first.`);
  }

  function setRow(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
  function reset() {
    setName("");
    setRows([emptyRow(), emptyRow()]);
    setError(null);
    setStartDate(trackingDayOf(new Date()));
    setLockWeeks("2");
    setLockSteps("3");
  }

  async function save() {
    setError(null);
    const nm = name.trim();
    if (!nm) return setError("Give the stack a name.");
    const rowValid = (r: Row) => Boolean(r.name.trim() && vialLabelStrengthMg(r.conc, r.vialMl) && perInjectionMcg(r.doseMl, r.conc));
    // A configured ramp on a row that would be silently dropped is a user
    // intent about to be discarded — surface it instead of vanishing it.
    const orphaned = rows.findIndex((r) => r.ramp && !rampIsBlank(r.ramp) && !rowValid(r));
    if (orphaned !== -1) {
      return setError(
        `Component ${orphaned + 1}${rows[orphaned].name.trim() ? ` (${rows[orphaned].name.trim()})` : ""} has a titration ramp but incomplete base fields — finish its peptide, concentration and dose first.`,
      );
    }
    const components = rows
      .filter(rowValid)
      .map((r) => ({
        peptideName: r.name.trim(),
        concentrationMcgPerMl: r.conc.trim(),
        vialSizeMl: r.vialMl.trim(),
        qty: r.qty.trim() || "1",
        doseMl: r.doseMl.trim(),
        ...(r.ramp && !rampIsBlank(r.ramp)
          ? {
              ramp: {
                startDose: r.ramp.startDose.trim(),
                targetDose: r.ramp.targetDose.trim(),
                increment: r.ramp.increment.trim(),
                weeksPerStep: r.ramp.weeksPerStep.trim(),
                doseInputUnit: r.ramp.unit,
              },
            }
          : {}),
      }));
    if (components.length === 0) return setError("Add at least one component with a concentration and dose.");
    const hasRamp = components.some((c) => "ramp" in c);
    if (hasRamp && !startDate.trim()) return setError("A titration ramp needs a stack start date.");
    setBusy(true);
    const res = await createStack({ name: nm, components, ...(hasRamp ? { startDateISO: startDate.trim() } : {}) });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    reset();
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-control bg-bg px-4 py-2 text-sm font-medium text-accentStrong ring-1 ring-line/15"
      >
        <span className="inline-flex items-center gap-1.5">
          <Layers className="h-4 w-4" aria-hidden /> Build a stack
        </span>
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
      <p className="text-sm font-medium">Build a stack</p>
      <p className="text-xs text-muted">
        Group already-reconstituted (premixed) vials taken together. Reference only — not medical advice.
      </p>
      <input className={input} placeholder="Stack name (e.g. BPC + TB)" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="space-y-3">
        {rows.map((r, i) => {
          const mcg = perInjectionMcg(r.doseMl, r.conc);
          const vialMg = vialLabelStrengthMg(r.conc, r.vialMl);
          return (
            <div key={i} className="space-y-1.5 rounded-control bg-bg p-2.5 ring-1 ring-line/10">
              <div className="flex items-center gap-2">
                <select
                  className={`${field} min-w-0 flex-1`}
                  value={r.name}
                  onChange={(e) => setRow(i, { name: e.target.value })}
                  aria-label={`Component ${i + 1}`}
                >
                  <option value="">Choose a peptide…</option>
                  {options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
                <span className="shrink-0 rounded-control bg-surface px-2 py-1 text-xs text-muted ring-1 ring-line/15">Premixed</span>
                <button
                  type="button"
                  onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                  disabled={rows.length <= 1}
                  className="shrink-0 rounded-control bg-surface p-2 ring-1 ring-line/15 disabled:opacity-30"
                  aria-label={`Remove component ${i + 1}`}
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input
                  className={`${field} w-24 shrink-0`}
                  inputMode="decimal"
                  placeholder="mcg/ml"
                  value={r.conc}
                  onChange={(e) => setRow(i, { conc: e.target.value })}
                  aria-label={`Component ${i + 1} concentration mcg/ml`}
                />
                <input
                  className={`${field} w-20 shrink-0`}
                  inputMode="decimal"
                  placeholder="vial ml"
                  value={r.vialMl}
                  onChange={(e) => setRow(i, { vialMl: e.target.value })}
                  aria-label={`Component ${i + 1} vial ml`}
                />
                <input
                  className={`${field} w-16 shrink-0`}
                  inputMode="numeric"
                  placeholder="qty"
                  value={r.qty}
                  onChange={(e) => setRow(i, { qty: e.target.value })}
                  aria-label={`Component ${i + 1} quantity`}
                />
                <input
                  className={`${field} w-20 shrink-0`}
                  inputMode="decimal"
                  placeholder="dose ml"
                  value={r.doseMl}
                  onChange={(e) => setRow(i, { doseMl: e.target.value })}
                  aria-label={`Component ${i + 1} dose ml`}
                />
              </div>
              <p className="text-xs text-muted">
                {mcg ? `${r.doseMl} ml → ${mcg} mcg` : "enter mcg/ml + dose"}
                {vialMg ? ` · ${vialMg} mg/vial` : ""}
              </p>
              {r.ramp ? (
                <div className="space-y-1.5 rounded-control bg-surface p-2 ring-1 ring-line/10">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium">Titration ramp</p>
                    <button type="button" onClick={() => setRow(i, { ramp: null })} className="text-xs text-muted" aria-label={`Remove ramp for component ${i + 1}`}>
                      remove
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <input className={`${field} w-20 shrink-0`} inputMode="decimal" placeholder="start" value={r.ramp.startDose}
                      onChange={(e) => setRow(i, { ramp: { ...r.ramp!, startDose: e.target.value } })} aria-label={`Component ${i + 1} ramp start dose`} />
                    <input className={`${field} w-20 shrink-0`} inputMode="decimal" placeholder="target" value={r.ramp.targetDose}
                      onChange={(e) => setRow(i, { ramp: { ...r.ramp!, targetDose: e.target.value } })} aria-label={`Component ${i + 1} ramp target dose`} />
                    <input className={`${field} w-20 shrink-0`} inputMode="decimal" placeholder="+step" value={r.ramp.increment}
                      onChange={(e) => setRow(i, { ramp: { ...r.ramp!, increment: e.target.value } })} aria-label={`Component ${i + 1} ramp increment`} />
                    <select className={`${field} w-20 shrink-0`} value={r.ramp.unit}
                      onChange={(e) => setRow(i, { ramp: { ...r.ramp!, unit: e.target.value as RampUnit } })} aria-label={`Component ${i + 1} ramp unit`}>
                      {RAMP_UNITS.map((u) => (<option key={u} value={u}>{u}</option>))}
                    </select>
                    <input className={`${field} w-16 shrink-0`} inputMode="decimal" placeholder="wk" value={r.ramp.weeksPerStep}
                      onChange={(e) => setRow(i, { ramp: { ...r.ramp!, weeksPerStep: e.target.value } })} aria-label={`Component ${i + 1} ramp weeks per step`} />
                  </div>
                  {(() => {
                    const pv = rampPreview(r.ramp);
                    return pv ? <p className={`text-xs ${pv.ok ? "text-muted" : "text-danger"}`}>{pv.text}</p> : <p className="text-xs text-muted">start → target in +step jumps; final step holds indefinitely</p>;
                  })()}
                </div>
              ) : (
                <button type="button" onClick={() => setRow(i, { ramp: emptyRamp() })} className="text-xs font-medium text-accentStrong">
                  + Titration ramp
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setRows((rs) => [...rs, emptyRow()])}
          className="inline-flex items-center gap-1 text-xs font-medium text-accentStrong"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden /> Add component
        </button>
      </div>
      {anyRamp && (
        <div className="space-y-2 rounded-control bg-bg p-2.5 ring-1 ring-line/10">
          <div className="flex items-center gap-2">
            <label className="flex-1 text-xs">
              <span className="text-muted">Stack start date</span>
              <input type="date" className={input} value={startDate} onChange={(e) => setStartDate(e.target.value)} aria-label="Stack start date" />
            </label>
          </div>
          <div className="flex items-end gap-2">
            <label className="text-xs">
              <span className="text-muted">wk/step</span>
              <input className={input} inputMode="decimal" value={lockWeeks} onChange={(e) => setLockWeeks(e.target.value)} aria-label="Lockstep weeks per step" />
            </label>
            <label className="text-xs">
              <span className="text-muted">phases</span>
              <input className={input} inputMode="numeric" value={lockSteps} onChange={(e) => setLockSteps(e.target.value)} aria-label="Lockstep phase count" />
            </label>
            <button type="button" onClick={applyLockstep} className="rounded-control bg-surface px-3 py-2 text-xs font-medium text-accentStrong ring-1 ring-line/15">
              Ramp all together
            </button>
          </div>
          <p className="text-xs text-muted">
            Applies one cadence to every ramped component (equal increments from each start → target over the same phases).
          </p>
        </div>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-control bg-accent px-4 py-2 text-sm font-medium text-onAccent disabled:opacity-40"
        >
          {busy ? "…" : (
            <>
              <Save className="h-4 w-4" aria-hidden /> Create stack
            </>
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            reset();
          }}
          className="inline-flex items-center gap-1.5 rounded-control bg-bg px-4 py-2 text-sm ring-1 ring-line/15"
        >
          <X className="h-4 w-4" aria-hidden /> Cancel
        </button>
      </div>
    </div>
  );
}
