"use client";

import { X, Plus, Save, Lightbulb } from "lucide-react";
import Link from "next/link";

import { useState } from "react";
import { saveProtocol, reviseProtocol, type ProtocolInput } from "@/app/actions/protocols";
import { materialProtocolChange, type CarryStep, type ProtocolSnapshot } from "@/lib/protocol-revision";
import { ReviseProtocolDialog } from "@/components/ReviseProtocolDialog";
import { type WeekdayCode } from "@/lib/schedule/schedule";
import { parseSchedule, scheduleSummary, evenlySpacedDays, isWithinDoseWindow, DEFAULT_DOSE_TIME, type Schedule, type ScheduleEntry, type DayPattern } from "@/lib/schedule/entries";
import { reindexPresetState } from "@/lib/schedule/preset-reindex";
import { dosesPerWeek } from "@/lib/schedule/frequency";
import { perInjectionPreview } from "@/lib/titration/per-injection-preview";
import { type DoseUnit } from "@/lib/dosing/types";
import { cyclePlanEnd } from "@/lib/cycle/state";
import { type CycleSuggestion } from "@/lib/cycle/suggest";

interface Opt { id: string; name: string }

const input = "w-full rounded-control border border-line/15 bg-bg px-3 py-2 text-sm text-ink";
const DAYS: WeekdayCode[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

/**
 * Today as "YYYY-MM-DD" in the DEVICE's calendar — this seeds a `<input
 * type="date">`, which is device-local. A UTC slice would offer yesterday for
 * most of a Brisbane day.
 */
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function ProtocolForm({
  peptides,
  prescriptions,
  syringes,
  initial,
  cycleSuggestions,
  savedSnapshot,
  carryForward,
}: {
  peptides: Opt[];
  prescriptions: Opt[];
  syringes: Opt[];
  initial?: ProtocolInput;
  /**
   * Literature-derived cycle suggestion per peptide id, resolved server-side
   * (lib/cycle/server) so the ~200 KB enrichment seed stays out of this bundle.
   */
  cycleSuggestions?: Record<string, CycleSuggestion>;
  /**
   * The protocol AS STORED, for material-change detection. Absent on CREATE
   * (nothing to compare against, and nothing to corrupt) — both revision props
   * must be present before the form will ever offer to revise.
   */
  savedSnapshot?: ProtocolSnapshot;
  /**
   * The re-based ladder the replacement protocol would start from, computed
   * server-side from the OLD protocol's frequency and delivered doses.
   */
  carryForward?: { steps: CarryStep[]; resumedDose: string | null };
}) {
  const seed = initial;

  const initialSchedule: Schedule =
    parseSchedule(seed?.scheduleRule).length > 0
      ? parseSchedule(seed?.scheduleRule)
      : [{ dayPattern: { kind: "daily" }, times: [] }];

  const [form, setForm] = useState<ProtocolInput>(
    seed
      ? {
          // Keep edit fields and pin peptideId to a valid option.
          ...seed,
          id: initial?.id,
          peptideId: seed.peptideId || peptides[0]?.id || "",
        }
      : {
          peptideId: peptides[0]?.id ?? "",
          name: "",
          source: "manual",
          scheduleType: "fixed_times",
          rebaseMode: "fixed_anchor",
          doseInputUnit: "mcg",
          doseBasis: "per_injection",
          status: "active",
        },
  );
  const [entries, setEntries] = useState<Schedule>(initialSchedule);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Non-null while the revise confirmation is open. Holds the labels of what
  // changed, the carried-forward ladder (editable in the dialog) and the new
  // protocol's start day.
  const [revise, setRevise] = useState<null | { fields: string[]; steps: CarryStep[]; startDate: string }>(null);

  // The "N× per week (evenly spaced)" preset is a UI affordance that authors a
  // plain `weekly` DayPattern — there is no distinct stored kind. We track which
  // entry indices currently have the preset editor open, plus the N/time the user
  // picked (so the inputs are controlled). A re-opened weekly schedule shows the
  // standard "Specific weekdays" editor (preset flag off) — acceptable for v1.
  const [presetIdx, setPresetIdx] = useState<Set<number>>(new Set());
  const [presetN, setPresetN] = useState<Record<number, number>>({});
  const [presetTime, setPresetTime] = useState<Record<number, string>>({});

  const scheduleValid =
    entries.length > 0 &&
    entries.every((e) => {
      const p = e.dayPattern;
      if (p.kind === "weekly") return p.byDays.length > 0;
      if (p.kind === "interval") return p.everyDays > 0;
      if (p.kind === "cycle") return p.onDays > 0 && p.onDays + p.offDays > 0;
      return true;
    });

  // Block save while any open N×/week preset has a time outside 06:00–20:00.
  // (The stored entry only updates on a valid time, but we surface the block so
  // the user can't save expecting their out-of-window time to take effect.)
  const presetTimeInvalid = [...presetIdx].some(
    (i) => !isWithinDoseWindow(presetTime[i] ?? DEFAULT_DOSE_TIME),
  );

  // Per-week dosing needs a resolvable injection frequency to divide the weekly
  // dose. We derive it from the LIVE schedule entries (the same JSON save() sends),
  // not form.scheduleRule (which is only populated on submit).
  const perWeek = form.doseBasis === "per_week";
  const injectionsPerWeek = perWeek ? dosesPerWeek(JSON.stringify(entries)) : null;
  // GUARD: per_week with an unknown frequency can't produce a per-injection dose.
  // This mirrors the backend resolver fail-safe — block save rather than ship NaN.
  const perWeekBlocked = perWeek && (injectionsPerWeek == null || injectionsPerWeek <= 0);
  const perInjectionHint = perWeek
    ? perInjectionPreview({
        value: form.targetDose ?? "",
        unit: form.doseInputUnit as DoseUnit,
        injectionsPerWeek,
      })
    : null;

  // ── Cycle plan ─────────────────────────────────────────────────────────────
  // The suggestion tracks the CURRENTLY SELECTED peptide, so switching peptide
  // re-offers the right literature without a round-trip.
  const suggestion = cycleSuggestions?.[form.peptideId];
  const cycleOn = parseInt(form.cycleOnWeeks ?? "", 10);
  const cycleOff = parseInt(form.cycleOffWeeks ?? "", 10);
  const cycleOnValid = Number.isFinite(cycleOn) && cycleOn >= 1 && cycleOn <= 104;
  const cycleOffValid = !form.cycleOffWeeks?.trim() || (Number.isFinite(cycleOff) && cycleOff >= 1 && cycleOff <= 104);
  // Preview the planned stop from whichever anchor the cycle will actually count
  // from — an explicit cycleAnchor, else the protocol start.
  const cycleAnchorDate = form.cycleAnchor || form.startDate;
  const plannedStop =
    cycleOnValid && cycleAnchorDate ? cyclePlanEnd(new Date(cycleAnchorDate + "T00:00:00"), cycleOn) : null;
  // Block save on a malformed cycle rather than letting the server reject it.
  const cycleBlocked =
    (!!form.cycleOnWeeks?.trim() && !cycleOnValid) ||
    !cycleOffValid ||
    (!!form.cycleOffWeeks?.trim() && !form.cycleOnWeeks?.trim());

  function applySuggestion() {
    if (!suggestion?.onWeeks) return;
    setForm((f) => ({
      ...f,
      cycleOnWeeks: String(suggestion.onWeeks),
      cycleOffWeeks: suggestion.offWeeks ? String(suggestion.offWeeks) : f.cycleOffWeeks,
    }));
  }

  function set<K extends keyof ProtocolInput>(k: K, v: ProtocolInput[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function updateEntry(i: number, next: ScheduleEntry) {
    setEntries((cur) => cur.map((e, idx) => (idx === i ? next : e)));
  }
  function addEntry() {
    setEntries((cur) => [...cur, { dayPattern: { kind: "daily" }, times: [] }]);
  }
  function removeEntry(i: number) {
    // No-op when only one entry remains (mirrors the disabled remove button).
    if (entries.length <= 1) return;
    setEntries((cur) => cur.filter((_, idx) => idx !== i));
    // Reindex all preset state: removing entry `i` shifts every entry above it
    // down by one, so the preset flag/N/time keys must shift too — otherwise a
    // preset dangles on the wrong entry (silently overwriting its real schedule)
    // and a stale invalid-time key can dead-lock the Save button.
    const reindexed = reindexPresetState(i, {
      idx: [...presetIdx],
      n: presetN,
      time: presetTime,
    });
    setPresetIdx(new Set(reindexed.idx));
    setPresetN(reindexed.n);
    setPresetTime(reindexed.time);
  }

  // Build the plain `weekly` entry the preset authors. Clamps N to 1..7 and
  // falls back to DEFAULT_DOSE_TIME if the chosen time is outside 06:00–20:00.
  function presetEntry(i: number): ScheduleEntry {
    const n = Math.min(7, Math.max(1, presetN[i] ?? 2));
    const time = presetTime[i] ?? DEFAULT_DOSE_TIME;
    const safeTime = isWithinDoseWindow(time) ? time : DEFAULT_DOSE_TIME;
    return { dayPattern: { kind: "weekly", byDays: evenlySpacedDays(n) }, times: [safeTime] };
  }
  function setPresetActive(i: number, on: boolean) {
    setPresetIdx((s) => { const next = new Set(s); if (on) next.add(i); else next.delete(i); return next; });
  }

  /** The exact payload save() sends — reused verbatim by the revise path. */
  function payload(): ProtocolInput {
    return { ...form, scheduleRule: JSON.stringify(entries) };
  }

  async function save() {
    const next = payload();

    // A material change (schedule / dose basis / start date / step lengths) on a
    // stored protocol re-times the whole titration ladder, so it is never saved
    // in place — offer the revision instead. Both props are absent on CREATE,
    // where there is no history to corrupt.
    if (savedSnapshot && carryForward) {
      const after: ProtocolSnapshot = {
        scheduleRule: next.scheduleRule ?? null,
        // Coerced exactly as saveProtocol coerces it, so an unrecognised value
        // can't read as a change the server would never have written.
        doseBasis: next.doseBasis === "per_week" ? "per_week" : "per_injection",
        startDate: next.startDate ? next.startDate.slice(0, 10) : null,
        // This form does not own titration steps (StepsEditor does, with its own
        // actions), so an absent `steps` means "unchanged" — the same reading
        // saveProtocol's backstop applies.
        steps: next.steps
          ? next.steps.map((s, i) => ({
              stepIndex: i,
              durationDays: s.durationDays == null || s.durationDays === "" ? null : Number(s.durationDays),
            }))
          : savedSnapshot.steps,
      };
      const fields = materialProtocolChange(savedSnapshot, after);
      if (fields.length > 0) {
        setError(null);
        setRevise({ fields, steps: carryForward.steps, startDate: todayKey() });
        return;
      }
    }

    setBusy(true);
    setError(null);
    const res = await saveProtocol(next);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    // New protocol → go to its edit page (to add titration steps); edit → back to list.
    window.location.href = initial?.id ? "/protocols" : `/protocols/${res.id}/edit`;
  }

  async function confirmRevise() {
    if (!revise || !initial?.id) return;
    setBusy(true);
    setError(null);
    const res = await reviseProtocol({
      id: initial.id,
      startDate: revise.startDate,
      next: {
        ...payload(),
        // The ladder as confirmed in the dialog, re-based so step 0 IS the step
        // the user is on. Blank duration = open-ended final step.
        steps: revise.steps.map((s) => ({
          dose: s.dose,
          doseInputUnit: s.doseInputUnit,
          durationDays: s.durationDays == null ? "" : String(s.durationDays),
        })),
      },
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    window.location.href = initial?.id ? "/protocols" : `/protocols/${res.id}/edit`;
  }

  return (
    <div className="space-y-3">
      <label className="block text-sm text-muted">Name
        <input className={input + " mt-1"} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. BPC-157 daily" />
      </label>
      <label className="block text-sm text-muted">Peptide
        <select className={input + " mt-1"} value={form.peptideId} onChange={(e) => set("peptideId", e.target.value)}>
          {peptides.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label className="block text-sm text-muted">Prescription (optional)
        <select className={input + " mt-1"} value={form.prescriptionId ?? ""} onChange={(e) => set("prescriptionId", e.target.value)}>
          <option value="">— none —</option>
          {prescriptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>

      <div className="space-y-2">
        <label className="block text-sm text-muted">Dose basis
          <select className={input + " mt-1"} value={form.doseBasis ?? "per_injection"} onChange={(e) => set("doseBasis", e.target.value)}>
            <option value="per_injection">per injection</option>
            <option value="per_week">per week (total)</option>
          </select>
        </label>
        <div className="flex gap-2">
          <label className="block flex-1 text-sm text-muted">{perWeek ? "Target dose (per week)" : "Target dose"}
            <input className={input + " mt-1"} inputMode="decimal" value={form.targetDose ?? ""} onChange={(e) => set("targetDose", e.target.value)} />
          </label>
          <label className="block w-28 text-sm text-muted">Unit
            <select className={input + " mt-1"} value={form.doseInputUnit} onChange={(e) => set("doseInputUnit", e.target.value)}>
              {["mcg", "mg", "ml", "units"].map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </label>
        </div>
        {perWeekBlocked && (
          <p className="text-xs text-warn">Set a weekly schedule first — per-week dosing needs a known injection frequency.</p>
        )}
        {!perWeekBlocked && perInjectionHint && (
          <p className="text-xs text-muted">{perInjectionHint}</p>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-sm text-muted">Schedule</p>
        {entries.map((entry, i) => (
          <div key={i} className="rounded-control bg-bg p-3 ring-1 ring-line/15 space-y-2">
            <div className="flex items-center gap-2">
              <select
                className={input}
                aria-label="Day pattern"
                value={presetIdx.has(i) ? "perweek" : entry.dayPattern.kind}
                onChange={(e) => {
                  const choice = e.target.value;
                  if (choice === "perweek") {
                    setPresetActive(i, true);
                    updateEntry(i, presetEntry(i));
                    return;
                  }
                  setPresetActive(i, false);
                  const kind = choice as DayPattern["kind"];
                  const next: DayPattern =
                    kind === "daily" ? { kind: "daily" }
                    : kind === "weekly" ? { kind: "weekly", byDays: [] }
                    : kind === "interval" ? { kind: "interval", everyDays: 3 }
                    : { kind: "cycle", onDays: 5, offDays: 2 };
                  updateEntry(i, { ...entry, dayPattern: next });
                }}
              >
                <option value="daily">Every day</option>
                <option value="weekly">Specific weekdays</option>
                <option value="perweek">N× per week (evenly spaced)</option>
                <option value="interval">Every N days</option>
                <option value="cycle">Cycle (on/off)</option>
              </select>
              {entries.length > 1 && (
                <button type="button" onClick={() => removeEntry(i)} aria-label="Remove entry" className="inline-flex items-center rounded-control bg-bg px-3 py-2 text-danger ring-1 ring-line/15"><X className="h-4 w-4" aria-hidden /></button>
              )}
            </div>

            {presetIdx.has(i) && (() => {
              const n = Math.min(7, Math.max(1, presetN[i] ?? 2));
              const time = presetTime[i] ?? DEFAULT_DOSE_TIME;
              const timeOk = isWithinDoseWindow(time);
              const days = evenlySpacedDays(n);
              return (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <label className="block flex-1 text-xs text-muted">Doses per week
                      <input className={input + " mt-1"} type="number" inputMode="numeric" min={1} max={7} value={n}
                        onChange={(e) => {
                          const val = Math.min(7, Math.max(1, parseInt(e.target.value, 10) || 1));
                          setPresetN((m) => ({ ...m, [i]: val }));
                          updateEntry(i, { dayPattern: { kind: "weekly", byDays: evenlySpacedDays(val) }, times: [timeOk ? time : DEFAULT_DOSE_TIME] });
                        }} />
                    </label>
                    <label className="block flex-1 text-xs text-muted">Time of day
                      <input className={input + " mt-1"} type="time" min="06:00" max="20:00" value={time}
                        onChange={(e) => {
                          const val = e.target.value;
                          setPresetTime((m) => ({ ...m, [i]: val }));
                          if (isWithinDoseWindow(val)) {
                            updateEntry(i, { dayPattern: { kind: "weekly", byDays: evenlySpacedDays(n) }, times: [val] });
                          }
                        }} />
                    </label>
                  </div>
                  <p className="text-xs text-muted">Days: <span className="text-ink">{days.join(", ")}</span></p>
                  {!timeOk && <p className="text-xs text-warn">Time must be between 06:00 and 20:00.</p>}
                </div>
              );
            })()}

            {entry.dayPattern.kind === "weekly" && !presetIdx.has(i) && (
              <div className="flex flex-wrap gap-1.5">
                {DAYS.map((day) => {
                  const dp = entry.dayPattern as { kind: "weekly"; byDays: WeekdayCode[] };
                  const on = dp.byDays.includes(day);
                  return (
                    <button key={day} type="button"
                      onClick={() => updateEntry(i, { ...entry, dayPattern: { kind: "weekly", byDays: on ? dp.byDays.filter((x) => x !== day) : [...dp.byDays, day] } })}
                      className={`rounded-control px-3 py-1.5 text-xs font-medium ${on ? "bg-accent text-onAccent" : "bg-bg ring-1 ring-line/15"}`}>{day}</button>
                  );
                })}
              </div>
            )}

            {entry.dayPattern.kind === "interval" && (
              <label className="block text-xs text-muted">Every
                <input className={input + " mt-1"} inputMode="numeric" value={(entry.dayPattern as { everyDays: number }).everyDays}
                  onChange={(e) => updateEntry(i, { ...entry, dayPattern: { kind: "interval", everyDays: Math.max(1, parseInt(e.target.value, 10) || 1) } })} /> days
              </label>
            )}

            {entry.dayPattern.kind === "cycle" && (
              <div className="flex gap-2">
                <label className="block flex-1 text-xs text-muted">Days on
                  <input className={input + " mt-1"} inputMode="numeric" min={1} value={(entry.dayPattern as { onDays: number; offDays: number }).onDays}
                    onChange={(e) => updateEntry(i, { ...entry, dayPattern: { ...(entry.dayPattern as { kind: "cycle"; onDays: number; offDays: number }), onDays: Math.max(1, parseInt(e.target.value, 10) || 1) } })} />
                </label>
                <label className="block flex-1 text-xs text-muted">Days off
                  <input className={input + " mt-1"} inputMode="numeric" min={1} value={(entry.dayPattern as { onDays: number; offDays: number }).offDays}
                    onChange={(e) => updateEntry(i, { ...entry, dayPattern: { ...(entry.dayPattern as { kind: "cycle"; onDays: number; offDays: number }), offDays: Math.max(1, parseInt(e.target.value, 10) || 1) } })} />
                </label>
              </div>
            )}

            {!presetIdx.has(i) && (
              <div>
                <p className="text-xs text-muted">Times (blank = any time)</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {entry.times.map((t, ti) => (
                    <span key={ti} className="flex items-center gap-1">
                      <input type="time" className="rounded-control border border-line/15 bg-bg px-2 py-1 text-sm" value={t}
                        onChange={(e) => updateEntry(i, { ...entry, times: entry.times.map((x, xi) => (xi === ti ? e.target.value : x)) })} />
                      <button type="button" aria-label="Remove time" onClick={() => updateEntry(i, { ...entry, times: entry.times.filter((_, xi) => xi !== ti) })} className="inline-flex items-center text-danger"><X className="h-3.5 w-3.5" aria-hidden /></button>
                    </span>
                  ))}
                  <button type="button" onClick={() => updateEntry(i, { ...entry, times: [...entry.times, "08:00"] })} className="inline-flex items-center gap-1 rounded-control bg-bg px-2 py-1 text-xs ring-1 ring-line/15"><Plus className="h-3.5 w-3.5" aria-hidden /> time</button>
                </div>
              </div>
            )}
          </div>
        ))}
        <button type="button" onClick={addEntry} className="flex w-full items-center justify-center gap-1.5 rounded-control bg-bg px-3 py-2 text-sm font-medium text-accentStrong ring-1 ring-line/15"><Plus className="h-4 w-4" aria-hidden /> Add entry</button>
        <p className="text-xs text-muted">Preview: <span className="text-ink">{scheduleSummary(entries)}</span></p>
        {!scheduleValid && <p className="text-xs text-warn">Each weekday entry needs ≥1 day; intervals/cycles need positive numbers.</p>}
      </div>

      <div className="flex gap-2">
        <label className="block flex-1 text-sm text-muted">Schedule type
          <select className={input + " mt-1"} value={form.scheduleType} onChange={(e) => set("scheduleType", e.target.value)}>
            <option value="fixed_times">fixed times</option>
            <option value="interval">interval</option>
            <option value="titration">titration</option>
          </select>
        </label>
        <label className="block flex-1 text-sm text-muted">Rebase
          <select className={input + " mt-1"} value={form.rebaseMode} onChange={(e) => set("rebaseMode", e.target.value)}>
            <option value="fixed_anchor">fixed anchor</option>
            <option value="rolling">rolling</option>
          </select>
        </label>
      </div>

      <label className="block text-sm text-muted">Default syringe
        <select className={input + " mt-1"} value={form.defaultSyringeId ?? ""} onChange={(e) => set("defaultSyringeId", e.target.value)}>
          <option value="">— none —</option>
          {syringes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>

      <div className="flex gap-2">
        <label className="block flex-1 text-sm text-muted">Start date
          <input type="date" className={input + " mt-1"} value={form.startDate ?? ""} onChange={(e) => set("startDate", e.target.value)} />
        </label>
        <label className="block flex-1 text-sm text-muted">End date
          <input type="date" className={input + " mt-1"} value={form.endDate ?? ""} onChange={(e) => set("endDate", e.target.value)} />
        </label>
      </div>

      {/* ── Cycle plan ─────────────────────────────────────────────────────── */}
      <div className="space-y-2 rounded-card bg-bg p-3 ring-1 ring-line/15">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-medium text-ink">Cycle plan</p>
          <span className="text-xs text-muted">optional</span>
        </div>
        <p className="text-xs text-muted">
          How long to run before deliberately stopping. Leave blank to run continuously.
        </p>

        {suggestion && (
          <div className="rounded-control bg-accent/5 p-2.5 text-xs ring-1 ring-accent/20">
            <div className="flex items-start gap-2">
              <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accentStrong" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-ink">{suggestion.basis}</p>
                {suggestion.quote && (
                  <p className="mt-1 italic text-muted">&ldquo;{suggestion.quote}&rdquo;</p>
                )}
                <p className="mt-1 text-muted">
                  Reference only — not medical advice.
                  {suggestion.sourceUrl && (
                    <>
                      {" "}
                      <a
                        href={suggestion.sourceUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="font-medium text-accentStrong underline"
                      >
                        source
                      </a>
                    </>
                  )}
                </p>
                {suggestion.onWeeks !== null && (
                  <button
                    type="button"
                    onClick={applySuggestion}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-control bg-accent px-2.5 py-1.5 font-medium text-onAccent"
                  >
                    <Lightbulb className="h-3.5 w-3.5" aria-hidden /> Use {suggestion.onWeeks} weeks
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <label className="block flex-1 text-sm text-muted">
            Run for (weeks)
            <input
              className={input + " mt-1"}
              type="number"
              inputMode="numeric"
              min={1}
              max={104}
              placeholder="continuous"
              value={form.cycleOnWeeks ?? ""}
              onChange={(e) => set("cycleOnWeeks", e.target.value)}
            />
          </label>
          <label className="block flex-1 text-sm text-muted">
            Then break (weeks)
            <input
              className={input + " mt-1"}
              type="number"
              inputMode="numeric"
              min={1}
              max={104}
              placeholder="no restart"
              value={form.cycleOffWeeks ?? ""}
              onChange={(e) => set("cycleOffWeeks", e.target.value)}
            />
          </label>
        </div>

        {plannedStop && (
          <p className="text-xs text-muted">
            Planned last dose:{" "}
            <span className="font-medium text-ink">
              {plannedStop.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
            </span>
            {cycleOffValid && form.cycleOffWeeks?.trim() ? " · then restarts automatically after the break." : " · then stops."}
          </p>
        )}
        {cycleOnValid && !cycleAnchorDate && (
          <p className="text-xs text-warn">Set a start date to see the planned stop date.</p>
        )}
        {cycleBlocked && (
          <p className="text-xs text-warn">
            {!form.cycleOnWeeks?.trim() && form.cycleOffWeeks?.trim()
              ? "Set a run length before a break length."
              : "Cycle lengths must be whole weeks between 1 and 104."}
          </p>
        )}
      </div>

      {initial?.id && (
        <label className="block text-sm text-muted">Status
          <select className={input + " mt-1"} value={form.status} onChange={(e) => set("status", e.target.value)}>
            {["active", "paused", "completed"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={busy || !scheduleValid || perWeekBlocked || presetTimeInvalid || cycleBlocked} className="flex flex-1 items-center justify-center gap-2 rounded-control bg-accent px-4 py-3 font-medium text-onAccent disabled:opacity-40">{busy ? "…" : <><Save className="h-4 w-4" aria-hidden /> {initial?.id ? "Save protocol" : "Create & add steps"}</>}</button>
        <Link href="/protocols" className="rounded-control bg-bg px-4 py-3 text-sm ring-1 ring-line/15">Cancel</Link>
      </div>
      {!initial?.id && form.scheduleType === "titration" && (
        <p className="text-xs text-muted">Tip: after creating, you&apos;ll add titration steps on the next screen.</p>
      )}

      {revise && (
        <ReviseProtocolDialog
          changedFields={revise.fields}
          resumedDose={carryForward?.resumedDose ?? null}
          steps={revise.steps}
          startDate={revise.startDate}
          busy={busy}
          error={error}
          onStartDateChange={(v) => setRevise((r) => (r ? { ...r, startDate: v } : r))}
          onStepsChange={(s) => setRevise((r) => (r ? { ...r, steps: s } : r))}
          onConfirm={confirmRevise}
          onCancel={() => { setRevise(null); setError(null); }}
        />
      )}
    </div>
  );
}
