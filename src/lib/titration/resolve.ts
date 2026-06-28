import { parseSchedule, slotsInRange, weeklyDays, type DatedSlot } from "../schedule/entries";
import { startOfDay, addDays } from "../schedule/schedule";
import { perInjectionDose } from "./dose-basis";
import { phaseTargets, activePhaseAt } from "./phase";
import { reconstructRebasedSlots } from "./rebase-slots";
import { slotStatus } from "./status";
import type { ResolveInput, ResolveResult, ResolvedSlot } from "./types";

function slotStart(s: DatedSlot): Date {
  if (!s.time) return startOfDay(s.date);
  const [h, m] = s.time.split(":").map(Number);
  return new Date(startOfDay(s.date).getTime() + h * 3_600_000 + m * 60_000);
}

const weekKey = (dte: Date) => {
  const ws = addDays(startOfDay(dte), -startOfDay(dte).getDay());
  return ws.getTime();
};

export function resolveTitration(inp: ResolveInput): ResolveResult {
  const schedule = parseSchedule(inp.scheduleRule);
  const titrating = inp.steps.length > 0 && inp.startDate != null;
  // Steps MUST be addressed by stepIndex, not array position. The DB returns steps
  // in arbitrary order (editing a step reorders the rows), yet phaseTargets sorts
  // internally — so a raw inp.steps[phaseIndex] lookup can pick the WRONG dose
  // (e.g. render the 2mg step while the phase cursor is on the 1mg step). Sort once
  // here and use `steps` for every position-based access below.
  const steps = [...inp.steps].sort((a, b) => a.stepIndex - b.stepIndex);

  // 1. Expand standing-grid slots, then apply fixed_anchor rebase per week.
  let slots = slotsInRange(schedule, inp.range.start, inp.range.end, inp.startDate, inp.endDate);
  if (titrating || inp.delivered.length > 0) {
    const pdays = weeklyDays(schedule);
    if (pdays.length > 0 && inp.rebaseMode === "fixed_anchor") {
      const byWeek = new Map<number, DatedSlot[]>();
      for (const s of slots) {
        const k = weekKey(s.date);
        (byWeek.get(k) ?? byWeek.set(k, []).get(k)!).push(s);
      }
      const out: DatedSlot[] = [];
      for (const [k, wkSlots] of byWeek) {
        const ws = new Date(k);
        const deliveredInWeek = inp.delivered.filter((dz) => weekKey(dz.takenAt) === k);
        out.push(...reconstructRebasedSlots({
          weekSlots: wkSlots, weekStart: ws, plannedDays: pdays,
          rebaseMode: inp.rebaseMode, freq: "WEEKLY", delivered: deliveredInWeek,
        }));
      }
      slots = out.sort((a, b) => a.date.getTime() - b.date.getTime());
    }
  }

  // 2. Phase targets (only meaningful when titrating with a known frequency).
  const targets = titrating && inp.injectionsPerWeek && inp.injectionsPerWeek > 0
    ? phaseTargets(steps, inp.injectionsPerWeek) : null;

  const delivered = [...inp.delivered].sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime());
  const skippedKeys = new Set(inp.skipped.map((s) => `${startOfDay(s.date).getTime()}@${s.time ?? "any"}`));
  const ordered = slots.map((s) => ({ s, start: slotStart(s) })).sort((a, b) => a.start.getTime() - b.start.getTime());
  // PASS 1 — match delivered doses to slots for STATUS only. A dose logged on the
  // SAME CALENDAR DAY as a slot counts as that slot's dose, regardless of the clock
  // time (product rule: same day = taken — the user logs when they actually dosed,
  // not to the minute). The slot's time is NOT used to gate matching; it only breaks
  // ties when a day has >1 slot (multi-time schedule) — each slot takes its CLOSEST-
  // in-time unconsumed same-day dose so a morning/evening pair lands on the right
  // slots. Single-time/untimed/rebased days trivially match the one same-day dose.
  // (Earlier this used a ±adherence-window test for timed slots, which falsely
  // flagged real same-day doses taken off-time as "missed"/"off-schedule".)
  const consumed = new Set<string>();
  const matches: ({ id: string; takenAt: Date } | null)[] = ordered.map(({ s, start }) => {
    const slotDay = startOfDay(s.date).getTime();
    let best: { id: string; takenAt: Date } | null = null;
    let bestDist = Infinity;
    for (const dz of delivered) {
      if (consumed.has(dz.id)) continue;
      if (startOfDay(dz.takenAt).getTime() !== slotDay) continue; // same calendar day only
      const dist = Math.abs(dz.takenAt.getTime() - start.getTime());
      if (dist < bestDist) { best = dz; bestDist = dist; }
    }
    if (best) consumed.add(best.id);
    return best;
  });

  // Ad-hoc deliveries = doses NOT matched to any slot (extra/unscheduled). They still
  // count toward titration progression (spec assumption), ordered by takenAt.
  const adHoc = delivered.filter((dz) => !consumed.has(dz.id));

  // PASS 2 — phase cursor. The phase SHOWN at a slot reflects completions STRICTLY
  // BEFORE that slot's own dose, so the slot where the Nth dose lands is still the
  // prior phase until its target is met. completion-ordinal(i) =
  //   (ad-hoc doses with takenAt < slot[i].start)  [range-independent: pre-range counts]
  // + (prior slots i' < i that are taken/projected, i.e. will be/were delivered).
  // A slot counts toward later slots' cursor iff it is taken (matched) or projected
  // (future, assumed delivered); a missed/skipped slot does NOT advance the phase.
  // The ad-hoc count below uses takenAt < slot.start, so pre-range doses are picked
  // up automatically for the first slot — the cursor is range-independent.
  const resolvedSlots: ResolvedSlot[] = [];
  const stepUpDates: Date[] = [];
  let priorCompletedSlots = 0; // taken/projected slots strictly before the current one
  let lastPhase = -1;

  for (let i = 0; i < ordered.length; i++) {
    const { s, start } = ordered[i];
    const nextStart = i + 1 < ordered.length ? ordered[i + 1].start : null;
    const match = matches[i];

    const isSkipped = skippedKeys.has(`${startOfDay(s.date).getTime()}@${s.time ?? "any"}`);
    const status = isSkipped ? "skipped" : slotStatus({ slotStart: start, now: inp.now, matchedLog: match, nextSlotStart: nextStart, adherenceWindowMin: inp.adherenceWindowMin });
    const isProjected = start.getTime() > inp.now.getTime();

    // Cursor = ad-hoc doses strictly before this slot (incl. pre-range) + prior taken/
    // projected slots. activePhaseAt is evaluated on the count BEFORE this slot's dose.
    const adHocBefore = adHoc.filter((dz) => dz.takenAt.getTime() < start.getTime()).length;
    const cursorBeforeSlot = adHocBefore + priorCompletedSlots;
    const phaseIndex = targets ? activePhaseAt(targets, cursorBeforeSlot) : null;
    if (phaseIndex != null && phaseIndex !== lastPhase && lastPhase !== -1) stepUpDates.push(start);
    if (phaseIndex != null) lastPhase = phaseIndex;

    // Dose for this slot. EVERY value emitted is per-injection — a per_week
    // weekly value must be divided exactly once, by the SAME perInjectionDose
    // path, whether it comes from the active titration step or the
    // Protocol.targetDose fallback (non-titration: no steps / null startDate).
    // per_week must NEVER emit an undivided weekly value; if it can't be divided
    // (frequency unresolved) we yield "" so callers fail safe rather than
    // overdose (spec §6). per_injection passes through unchanged.
    //   Precedence: active step dose → else fallbackDose (Protocol.targetDose).
    const stepDose = phaseIndex != null ? steps[phaseIndex] : null;
    const rawValue = stepDose ? stepDose.dose : (inp.fallbackDose ?? "");
    const rawUnit = (stepDose
      ? (stepDose.doseInputUnit as ResolvedSlot["perInjectionUnit"])
      : inp.fallbackUnit);
    const per = rawValue !== ""
      ? perInjectionDose({ doseBasis: inp.doseBasis, value: rawValue, unit: rawUnit, injectionsPerWeek: inp.injectionsPerWeek })
      : null;
    // per is null only when: per_week + unresolved frequency (→ fail safe "") or
    // there was no value at all. per_injection always returns its value.
    const perInjectionValue = per ? per.value : (inp.doseBasis === "per_week" ? "" : rawValue);
    const perInjectionUnit = per ? per.unit : rawUnit;

    // This slot advances the cursor for LATER slots iff it is/will be delivered.
    if (status === "taken" || status === "projected") priorCompletedSlots++;

    resolvedSlots.push({
      date: s.date, time: s.time,
      phaseIndex: titrating ? phaseIndex : null,
      perInjectionValue, perInjectionUnit, status, isProjected,
      matchedLogId: match ? match.id : null,
      rebased: s.rebased ?? false,
    });
  }

  // phaseProgress is the STATE THROUGH THE now-DAY: count every dose delivered on
  // or before the end of inp.now's local day (matched or ad-hoc), range-independent,
  // then locate the active phase + position. We count to END-of-day, not <= now,
  // because today.ts passes `now` as local midnight (startOfDay) — counting
  // strictly `<= midnight` dropped a dose already logged earlier today, which made
  // the card read e.g. "0/10 doses" right after logging (it should be "1/10").
  let phaseProgress = null;
  if (targets) {
    const nowDayEnd = startOfDay(inp.now).getTime() + 86_400_000;
    const deliveredAtNow = inp.delivered.filter((dz) => dz.takenAt.getTime() < nowDayEnd).length;
    const phaseIndex = activePhaseAt(targets, deliveredAtNow);
    let before = 0;
    for (let i = 0; i < phaseIndex; i++) before += targets[i] ?? 0;
    phaseProgress = {
      phaseIndex,
      phaseCount: targets.length,
      deliveredInPhase: deliveredAtNow - before,
      targetInPhase: targets[phaseIndex],
    };
  }

  return { slots: resolvedSlots, stepUpDates, phaseProgress };
}
