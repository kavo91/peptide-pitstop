"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Layers, Check, FileText, X } from "lucide-react";
import { logStack, addStackPrescription, deleteStack, type StackView } from "@/app/actions/stacks";
import { trackingDayOf, deviceTimeZone } from "@/lib/local-day";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import { StackScheduleEditor } from "@/components/StackScheduleEditor";

const field = "w-full rounded-control border border-line/15 bg-bg px-2.5 py-1.5 text-sm text-ink";

/**
 * @param manage When true, the card also surfaces stack management — an editable
 *   schedule (StackScheduleEditor) and a delete control (deleteStack). When false
 *   or absent (e.g. the Today quick-log card) the card renders ONLY the component
 *   list, grouped prescription and one-tap "Log stack", staying focused.
 */
export function StackCard({ stack, manage = false }: { stack: StackView; manage?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [editingRx, setEditingRx] = useState(false);
  const [rx, setRx] = useState({
    source: stack.prescription?.source ?? "",
    prescriber: "",
    pharmacy: "",
    doseInstructions: "",
    refillsRemaining: stack.prescription?.refillsRemaining?.toString() ?? "",
    nextRefill: stack.prescription?.nextRefill ?? "",
    expiration: stack.prescription?.expiry ?? "",
  });
  const [rxErr, setRxErr] = useState<string | null>(null);

  async function log() {
    setBusy(true);
    setMsg(null);
    const res = await logStack(stack.id, { localDay: trackingDayOf(new Date()), tz: deviceTimeZone() ?? undefined });
    setBusy(false);
    if (!res.ok) {
      setMsg(res.error ?? "Could not log.");
      return;
    }
    if (res.logged > 0) {
      // Append any per-component skip reason — a silently skipped component
      // otherwise just stops being recorded behind a cheerful "Logged N".
      setMsg(`Logged ${res.logged} dose${res.logged === 1 ? "" : "s"}.${res.error ? ` ${res.error}` : ""}`);
      router.refresh();
    } else {
      // Nothing logged — surface the real reason (already logged today, no prep, etc.).
      setMsg(res.error ?? "Nothing to log.");
    }
  }

  async function saveRx() {
    setBusy(true);
    setRxErr(null);
    const res = await addStackPrescription({ stackId: stack.id, ...rx });
    setBusy(false);
    if (!res.ok) return setRxErr(res.error);
    setEditingRx(false);
    router.refresh();
  }

  const p = stack.prescription;

  return (
    <div className="rounded-card bg-surface px-4 py-3 text-sm shadow-sm ring-1 ring-line/10">
      <div className="mb-2 flex items-center gap-1.5 font-medium">
        <Layers className="h-4 w-4 text-accentStrong" aria-hidden /> {stack.name}
      </div>
      <ul className="space-y-1">
        {stack.components.map((c) => (
          <li key={c.protocolId} className="text-xs text-muted">
            <span className="text-ink">{c.peptideName}</span>
            {c.resolved ? (
              c.resolved.doseValue === "" ? (
                // Resolver fail-safe: never render a raw number here (spec §6).
                <> — <span className="text-warn">dose unresolvable — check schedule</span></>
              ) : (
                <>
                  {" "}— {c.resolved.doseValue} {c.resolved.doseUnit}
                  {c.resolved.altDisplay ? ` (${c.resolved.altDisplay})` : ""}
                </>
              )
            ) : (
              <>
                {/* A revised successor may dose in mcg/mg — render its real unit;
                    the ml → mcg pair only holds for an ml dose. */}
                {" "}— {c.doseMl} {c.doseInputUnit}
                {c.perInjectionMcg ? ` → ${c.perInjectionMcg} mcg` : ""}
              </>
            )}
            {c.halfLifeHours ? ` · t½ ${c.halfLifeHours}h` : ""}
            {c.remainingMl ? ` · ${c.remainingMl} ml left` : ""}
            {c.expiry ? ` · exp ${c.expiry}` : ""}
            {c.resolved && c.resolved.doseValue !== "" ? (
              <span className="ml-1 text-accentStrong">
                · Phase {c.resolved.phaseIndex + 1} of {c.resolved.phaseCount}
                {c.resolved.targetInPhase != null ? ` — ${c.resolved.deliveredInPhase}/${c.resolved.targetInPhase} doses` : ""}
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      {/* Grouped prescription — one script covering the whole stack. */}
      {!editingRx ? (
        <div className="mt-2 flex items-center gap-2 text-xs">
          <FileText className="h-3.5 w-3.5 text-muted" aria-hidden />
          {p ? (
            <>
              <span className="text-muted">
                Rx: <span className="text-ink">{p.source ?? "Prescription"}</span>
                {p.refillsRemaining != null ? ` · ${p.refillsRemaining} left` : ""}
                {p.nextRefill ? ` · refill ${p.nextRefill}` : ""}
              </span>
              <button type="button" onClick={() => setEditingRx(true)} className="font-medium text-accentStrong">Edit</button>
            </>
          ) : (
            <button type="button" onClick={() => setEditingRx(true)} className="font-medium text-accentStrong">+ Add prescription</button>
          )}
        </div>
      ) : (
        <div className="mt-2 space-y-2 rounded-control bg-bg p-2.5 text-xs ring-1 ring-line/10">
          <p className="font-medium">Stack prescription</p>
          <p className="text-muted">One grouped script covering {stack.components.map((c) => c.peptideName).join(" + ")}.</p>
          <input className={field} placeholder="Source (e.g. Compounding pharmacy)" value={rx.source} onChange={(e) => setRx({ ...rx, source: e.target.value })} />
          <input className={field} placeholder="Prescriber" value={rx.prescriber} onChange={(e) => setRx({ ...rx, prescriber: e.target.value })} />
          <input className={field} placeholder="Pharmacy" value={rx.pharmacy} onChange={(e) => setRx({ ...rx, pharmacy: e.target.value })} />
          <input className={field} placeholder="Dose instructions (e.g. 0.2 ml/day each)" value={rx.doseInstructions} onChange={(e) => setRx({ ...rx, doseInstructions: e.target.value })} />
          <div className="flex gap-2">
            <label className="flex-1">
              <span className="text-muted">Refills left</span>
              <input className={field} inputMode="numeric" value={rx.refillsRemaining} onChange={(e) => setRx({ ...rx, refillsRemaining: e.target.value })} />
            </label>
            <label className="flex-1">
              <span className="text-muted">Next refill</span>
              <input className={field} type="date" value={rx.nextRefill} onChange={(e) => setRx({ ...rx, nextRefill: e.target.value })} />
            </label>
            <label className="flex-1">
              <span className="text-muted">Expiry</span>
              <input className={field} type="date" value={rx.expiration} onChange={(e) => setRx({ ...rx, expiration: e.target.value })} />
            </label>
          </div>
          {rxErr && <p className="text-danger">{rxErr}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={saveRx} disabled={busy} className="flex-1 rounded-control bg-accent px-2.5 py-1.5 font-medium text-onAccent disabled:opacity-40">{busy ? "…" : "Save prescription"}</button>
            <button type="button" onClick={() => { setEditingRx(false); setRxErr(null); }} className="inline-flex items-center gap-1 rounded-control bg-surface px-2.5 py-1.5 ring-1 ring-line/15"><X className="h-3.5 w-3.5" aria-hidden /> Cancel</button>
          </div>
        </div>
      )}

      {/* Stack management — schedule editor + delete. Hidden on the focused
          Today quick-log card (manage falsy); shown in Settings (manage). */}
      {manage && <StackScheduleEditor stackId={stack.id} scheduleRule={stack.scheduleRule} startDate={stack.startDate} />}

      <button
        type="button"
        onClick={log}
        disabled={busy}
        className="mt-2 inline-flex items-center gap-1.5 rounded-control bg-accent px-3 py-1.5 text-xs font-medium text-onAccent disabled:opacity-40"
      >
        <Check className="h-3.5 w-3.5" aria-hidden /> {busy ? "…" : "Log stack"}
      </button>
      {msg && <p className="mt-1 text-xs text-muted">{msg}</p>}

      {manage && (
        <div className="mt-2 border-t border-line/10 pt-2">
          <ConfirmDeleteButton
            action={deleteStack}
            id={stack.id}
            confirmMessage="Delete this stack? Its protocols are removed and logged doses are kept; vials and inventory are preserved."
            label="Delete stack"
            ariaLabel="Delete this stack"
          />
        </div>
      )}
    </div>
  );
}
