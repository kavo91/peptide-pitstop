/**
 * Protocol revision — changing a live protocol's schedule without corrupting it.
 *
 * PURE. No I/O, no Prisma.
 */

import { phaseTargets, activePhaseAt } from "@/lib/titration/phase";

/**
 * The key every revision of one course shares.
 *
 * Null courseId means the protocol is its own course, so existing rows need no
 * backfill. Analytics groups on this rather than walking a self-link, because a
 * consumer that forgets to group returns ONE protocol's numbers — visibly
 * partial — rather than silently under-reporting a chain.
 */
export function courseKey(p: { id: string; courseId: string | null }): string {
  return p.courseId ?? p.id;
}

/** The fields that decide whether a change re-times the schedule. */
export interface ProtocolSnapshot {
  scheduleRule: string | null;
  doseBasis: string;
  /** Date-only "YYYY-MM-DD", or null. */
  startDate: string | null;
  steps: { stepIndex: number; durationDays: number | null }[];
}

/**
 * Which material fields differ between two versions of a protocol.
 *
 * MATERIAL means "re-times the schedule". `durationDays` is stored as calendar
 * days but the ladder advances on a dose count derived at read time
 * (round(durationDays / 7 * injectionsPerWeek)), so changing any of these
 * re-derives every PAST step's target and moves the user along their own ladder.
 *
 * Dose VALUES are deliberately immaterial: a ladder bump changes what is
 * delivered but re-times nothing, and forcing a new protocol per bump would
 * shred one titration course into a dozen fragments. Same for name, notes,
 * reminder times, syringe, vial pin, endDate, status and the cycle fields.
 *
 * Returns labels rather than a boolean so the dialog can name what changed.
 */
export function materialProtocolChange(
  before: ProtocolSnapshot,
  after: ProtocolSnapshot,
): string[] {
  const changed: string[] = [];
  if ((before.scheduleRule ?? "") !== (after.scheduleRule ?? "")) changed.push("dosing schedule");
  if (before.doseBasis !== after.doseBasis) changed.push("dose basis");
  if ((before.startDate ?? "") !== (after.startDate ?? "")) changed.push("start date");

  // Steps are addressed by stepIndex, never array position — the DB returns them
  // unsorted (lib/titration/resolve.ts sorts for the same reason).
  const key = (s: ProtocolSnapshot["steps"]) =>
    [...s].sort((a, b) => a.stepIndex - b.stepIndex).map((x) => `${x.stepIndex}:${x.durationDays ?? "null"}`).join("|");
  if (key(before.steps) !== key(after.steps)) changed.push("titration steps");

  return changed;
}

/**
 * Refuse a schedule rewrite at the boundary.
 *
 * A resolver-side clamp was considered and rejected: it fixes the wrong
 * invariant. Slowing a schedule down SHRINKS the dose-count targets, so an
 * existing delivered count overshoots and escalates the user PAST a ramp step
 * they never took — which a "never go backwards" guard is blind to, and which is
 * worse than dropping back. The invariant is "past targets must not be
 * re-derived", so the rewrite is refused rather than compensated for.
 *
 * saveProtocol calls this. ProtocolForm prompts and routes to reviseProtocol
 * before ever reaching it, so in practice this catches the paths that do NOT
 * prompt: a server action invoked directly, a future import, or a future edit
 * surface. (The prescription wizard only CREATES protocols — verified, one
 * exported action and no update path — so it never reaches this; a create has
 * no delivered doses and the assertion returns immediately.)
 * reviseProtocol needs no exemption — it never mutates the old protocol.
 */
export function assertNoScheduleRewrite(
  before: ProtocolSnapshot,
  after: ProtocolSnapshot,
  ctx: { status: string; hasDeliveredDoses: boolean },
): void {
  if (ctx.status !== "active" || !ctx.hasDeliveredDoses) return;
  const changed = materialProtocolChange(before, after);
  if (changed.length === 0) return;
  throw new Error(
    `Cannot change ${changed.join(", ")} on a protocol that already has logged doses — ` +
      `it would re-time every titration step. Revise the protocol instead.`,
  );
}

export interface CarryStep {
  stepIndex: number;
  dose: string;
  doseInputUnit: string;
  durationDays: number | null;
}

/**
 * The new protocol's ladder, re-based so its step 0 IS the step the user is on.
 *
 * This is what makes the whole design safe: the new protocol starts with ZERO
 * delivered doses, so the count-based resolver lands on step 0 — which is the
 * resumed step. No freezing, no offset, no inverse conversion, and past targets
 * are never recomputed because the past belongs to the old protocol.
 *
 * Remaining steps keep their CALENDAR length: durationDays is already days, so
 * they copy across untouched and only the dose count inside each step moves with
 * the new frequency. Only the part-completed current step is shortened.
 *
 * `injectionsPerWeek` and `deliveredCount` are the OLD protocol's — the question
 * being answered is "where was the user standing before the change?".
 */
export function planCarryForward(args: {
  steps: CarryStep[];
  injectionsPerWeek: number | null;
  deliveredCount: number;
  /** Calendar days since the first dose logged in the current phase; 0 if none. */
  daysSpentInCurrentPhase: number;
}): CarryStep[] {
  const ordered = [...args.steps].sort((a, b) => a.stepIndex - b.stepIndex);
  if (ordered.length === 0) return [];

  const ipw = args.injectionsPerWeek;
  const reindex = (steps: CarryStep[]) => steps.map((s, i) => ({ ...s, stepIndex: i }));

  // Without a frequency the phase cannot be resolved; copy rather than guess.
  if (ipw == null || ipw <= 0) return reindex(ordered);

  const targets = phaseTargets(
    ordered.map((s) => ({ stepIndex: s.stepIndex, dose: s.dose, doseInputUnit: s.doseInputUnit, durationDays: s.durationDays })),
    ipw,
  );
  const current = activePhaseAt(targets, args.deliveredCount);
  const remaining = ordered.slice(current);

  const [head, ...rest] = remaining;
  const shortened: CarryStep =
    head.durationDays == null
      ? head
      : { ...head, durationDays: Math.max(1, head.durationDays - Math.max(0, args.daysSpentInCurrentPhase)) };

  return reindex([shortened, ...rest]);
}

/**
 * Calendar days already served in the CURRENT titration phase.
 *
 * Measured from the first dose that landed in this phase, not from the
 * protocol's start — the phase boundary is what matters, and it is derived from
 * the delivered dose count, not the calendar. `planCarryForward` subtracts this
 * from the resumed step so the user finishes the ramp they are actually on
 * rather than restarting it.
 *
 * Returns 0 whenever the answer is unknowable or nothing has been served: no
 * steps, no frequency, no doses, or a phase entered but not yet dosed. Zero is
 * the safe direction — it never shortens a step too much.
 *
 * All inputs are date-only "YYYY-MM-DD" keys, so this is timezone-free: it
 * compares the tracking days the doses were logged on, never instants.
 */
export function daysSpentInPhase(args: {
  steps: CarryStep[];
  injectionsPerWeek: number | null;
  /** Tracking-day key per delivered dose, ASCENDING. */
  deliveredDayKeys: string[];
  todayKey: string;
}): number {
  const ordered = [...args.steps].sort((a, b) => a.stepIndex - b.stepIndex);
  const ipw = args.injectionsPerWeek;
  const delivered = args.deliveredDayKeys.length;
  if (ordered.length === 0 || ipw == null || ipw <= 0 || delivered === 0) return 0;

  const targets = phaseTargets(
    ordered.map((s) => ({ stepIndex: s.stepIndex, dose: s.dose, doseInputUnit: s.doseInputUnit, durationDays: s.durationDays })),
    ipw,
  );
  const current = activePhaseAt(targets, delivered);

  // Doses consumed by every phase before this one. Any target before `current`
  // is non-null by construction: activePhaseAt returns at the first null it
  // meets, so a null can only ever be AT `current`, never before it.
  let cumBefore = 0;
  for (let i = 0; i < current; i++) cumBefore += targets[i] ?? 0;

  // The phase is entered but not yet dosed.
  if (delivered <= cumBefore) return 0;

  const firstKey = args.deliveredDayKeys[cumBefore];
  const first = Date.parse(`${firstKey}T00:00:00Z`);
  const today = Date.parse(`${args.todayKey}T00:00:00Z`);
  if (!Number.isFinite(first) || !Number.isFinite(today)) return 0;
  return Math.max(0, Math.floor((today - first) / 86_400_000));
}

/**
 * The endDate to stamp when a protocol is closed by hand, or null to leave it.
 *
 * `endDate` means the PLANNED end — it is set when the protocol is created and
 * nothing touched it when the course was closed early. That left two fields
 * disagreeing: `status` saying the course is over while `endDate` said it ran
 * for weeks yet. Slot generation is bounded by `endDate`, so the finished course
 * kept materialising slots beside its replacement's, and each one aged into a
 * miss the user could never have logged — a course closed weeks before its
 * planned end leaves a trail of them.
 *
 * `reviseProtocol` already sets an honest endDate, so this closes the same gap
 * on the ordinary status dropdown — the path most people will actually use.
 *
 * Only ever SHRINKS. An endDate already in the past is a course that ran to its
 * planned end and is already honest; moving it would rewrite history. Pausing is
 * not closing, so it is left alone — a paused course may resume.
 */
export function endDateOnClose(args: {
  wasStatus: string;
  nowStatus: string;
  /** Date-only "YYYY-MM-DD", or null if never set. */
  currentEndDate: string | null;
  todayKey: string;
}): string | null {
  if (args.nowStatus !== "completed" || args.wasStatus === "completed") return null;
  if (args.currentEndDate != null && args.currentEndDate <= args.todayKey) return null;
  return args.todayKey;
}
