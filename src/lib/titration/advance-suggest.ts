/**
 * Titration phase-advance SUGGESTION.
 *
 * When a logged dose's amount matches the NEXT titration step (the user has
 * moved themselves up — e.g. logging 400 mcg while the plan's current phase
 * says 200 and the next says 400), offer to bring the next phase forward so
 * the plan continues from this dose. This is schedule BOOKKEEPING that reacts
 * to what the user already logged — the app never suggests changing a dose.
 *
 * Mechanics: the phase cursor is dose-count based (phaseTargets/activePhaseAt),
 * so "bring forward" = truncate the CURRENT step's durationDays until its
 * dose-count target equals the doses actually delivered before this log —
 * the logged dose then falls in the next phase, and all views/resolvers follow.
 *
 * Read/decide half (plain module, unit-testable pure core). The write half is
 * advanceTitrationPhase in app/actions/protocols.ts, which recomputes this
 * server-side at confirm time — client-carried numbers are never trusted.
 */
import Decimal from "decimal.js";
import { prisma } from "@/lib/db";
import { phaseTargets, activePhaseAt } from "./phase";
import { perInjectionDose } from "./dose-basis";
import { dosesPerWeek } from "../schedule/frequency";

export interface TitrationAdvanceSuggestion {
  protocolId: string;
  doseLogId: string;
  peptideName: string;
  /** 1-based phase numbers for prompt copy ("Phase 2 of 5"). */
  fromPhase: number;
  toPhase: number;
  phaseCount: number;
  /** The matched next-step dose for prompt copy, e.g. "400 mcg". */
  doseLabel: string;
}

/** Step shape the pure core consumes (structurally satisfied by Prisma's ProtocolStep). */
export interface AdvanceStep {
  stepIndex: number;
  dose: { toString(): string } | string;
  doseInputUnit: string;
  durationDays: number | null;
}

export interface AdvanceComputation {
  /** stepIndex of the CURRENT phase's step, whose duration gets truncated. */
  stepIndex: number;
  newDurationDays: number;
  fromPhase: number; // 1-based
  toPhase: number;
  phaseCount: number;
  nextDoseValue: string;
  nextDoseUnit: string;
}

/** Canonical mcg for a step dose, or null for units we can't mass-compare. */
function toMcg(value: string, unit: string): Decimal | null {
  if (unit === "mcg") return new Decimal(value);
  if (unit === "mg") return new Decimal(value).times(1000);
  return null; // ml / units are prep-dependent — no reliable canonical mass
}

/** Relative match within 0.5% — absorbs unit-conversion rounding, nothing else. */
function matches(a: Decimal, b: Decimal): boolean {
  if (b.lte(0)) return false;
  return a.minus(b).abs().div(b).lte("0.005");
}

/** Minimal durationDays whose dose-count target equals `count` (inverts phaseTargets' rounding). */
function durationForCount(count: number, injectionsPerWeek: number): number | null {
  for (let d = 0; d <= 370; d++) {
    if (Math.round((d / 7) * injectionsPerWeek) === count) return d;
  }
  return null;
}

/**
 * Pure decision: does `loggedDoseMcg` (delivered as dose #deliveredBeforeCount+1)
 * match the NEXT step's per-injection dose? Returns the truncation to apply, or
 * null when no advance applies (non-titrating, final phase, no match, or the
 * logged dose equals the current phase's own dose).
 */
export function computeAdvance(args: {
  steps: AdvanceStep[];
  doseBasis: "per_injection" | "per_week";
  injectionsPerWeek: number | null;
  deliveredBeforeCount: number;
  loggedDoseMcg: string;
}): AdvanceComputation | null {
  const steps = [...args.steps].sort((a, b) => a.stepIndex - b.stepIndex);
  const ipw = args.injectionsPerWeek;
  if (steps.length < 2 || !ipw || ipw <= 0) return null;

  const targets = phaseTargets(
    steps.map((s) => ({ stepIndex: s.stepIndex, dose: s.dose.toString(), doseInputUnit: s.doseInputUnit, durationDays: s.durationDays })),
    ipw,
  );
  const cur = activePhaseAt(targets, args.deliveredBeforeCount);
  const next = cur + 1;
  if (next >= steps.length) return null; // already on the final phase

  const per = (i: number) =>
    perInjectionDose({ doseBasis: args.doseBasis, value: steps[i].dose.toString(), unit: steps[i].doseInputUnit as never, injectionsPerWeek: ipw });
  const nextPer = per(next);
  const curPer = per(cur);
  if (!nextPer || !curPer) return null;
  const nextMcg = toMcg(nextPer.value, nextPer.unit);
  const curMcg = toMcg(curPer.value, curPer.unit);
  if (!nextMcg || !curMcg) return null;

  const logged = new Decimal(args.loggedDoseMcg);
  // Must match the NEXT step and clearly differ from the current one —
  // identical adjacent steps would make the prompt meaningless.
  if (!matches(logged, nextMcg) || matches(logged, curMcg)) return null;

  // Doses already delivered INSIDE the current phase (cumulative targets of
  // completed phases are all non-null, else activePhaseAt would have stopped).
  let cumBefore = 0;
  for (let i = 0; i < cur; i++) cumBefore += targets[i] ?? 0;
  const deliveredInPhase = args.deliveredBeforeCount - cumBefore;
  if (deliveredInPhase < 0) return null;

  const newDurationDays = durationForCount(deliveredInPhase, ipw);
  if (newDurationDays == null) return null;

  return {
    stepIndex: steps[cur].stepIndex,
    newDurationDays,
    fromPhase: cur + 1,
    toPhase: next + 1,
    phaseCount: steps.length,
    nextDoseValue: nextPer.value,
    nextDoseUnit: nextPer.unit,
  };
}

/**
 * DB wrapper: build the suggestion for a just-created dose log, or undefined.
 * Takes the caller's userId (same boundary rule as computeRebaseSuggestion —
 * not client-callable directly).
 */
export async function computeTitrationAdvanceSuggestion(args: {
  protocolId: string | undefined;
  userId: string;
  doseLogId: string;
}): Promise<TitrationAdvanceSuggestion | undefined> {
  const { protocolId, userId, doseLogId } = args;
  if (!protocolId) return undefined;

  const protocol = await prisma.protocol.findFirst({
    where: { id: protocolId, userId, status: "active" },
    include: { steps: true, peptide: true },
  });
  if (!protocol || protocol.steps.length < 2) return undefined;

  const log = await prisma.doseLog.findFirst({ where: { id: doseLogId, userId, protocolId } });
  if (!log) return undefined;

  const deliveredBeforeCount = await prisma.doseLog.count({
    where: { userId, protocolId, takenAt: { lt: log.takenAt } },
  });

  const computed = computeAdvance({
    steps: protocol.steps,
    doseBasis: protocol.doseBasis === "per_week" ? "per_week" : "per_injection",
    injectionsPerWeek: dosesPerWeek(protocol.scheduleRule),
    deliveredBeforeCount,
    loggedDoseMcg: log.doseMcg.toString(),
  });
  if (!computed) return undefined;

  return {
    protocolId: protocol.id,
    doseLogId,
    peptideName: protocol.peptide.name,
    fromPhase: computed.fromPhase,
    toPhase: computed.toPhase,
    phaseCount: computed.phaseCount,
    doseLabel: `${computed.nextDoseValue} ${computed.nextDoseUnit}`,
  };
}
