"use server";

/**
 * Dose-shift suggestions — Apply (single), Apply-all and Pin server
 * actions.
 *
 * The client sends ONLY `{ protocolId, k, startDate, fingerprint }` per
 * move. Everything else — the rotated schedule rule, the carried-forward
 * titration steps, the cycle plan, the endDate — is rebuilt here from the DB
 * row, never forwarded from the wire. `reviseProtocol` is a general rewrite
 * exempt from the ordinary rewrite guard, so this boundary is the only thing
 * standing between a crafted request and an arbitrary schedule rewrite.
 *
 * `applyShiftPlan` applies a combined plan's moves one at a time through
 * the SAME single-protocol path as `applyShiftSuggestion` — both share the
 * `applyOne` core below — in the order the engine hands them over, stopping at
 * the first failure. There is still no multi-protocol transaction: every
 * landed move is a valid revision on its own, but a PREFIX of the plan is not
 * the plan, and the engine (not this file) is what makes each prefix the best
 * state reachable from the one before it — see `orderByBestPrefix` in
 * shift-suggest.ts. A partial apply can still leave a day busier than the
 * whole plan would have, which is what the confirm sheet's copy says.
 */
import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/owner";
import { viewerToday } from "@/lib/viewer-tz";
import { addDays } from "@/lib/schedule/schedule";
import { dosesPerWeek } from "@/lib/schedule/frequency";
import { planCarryForward, daysSpentInPhase, type CarryStep } from "@/lib/protocol-revision";
import {
  eligibility,
  rotateDays,
  rotatedRule,
  rotationPreservesCount,
  shiftFingerprint,
  dayKey,
  MAX_PLAN_MOVES,
  SHIFT_MAX_START_DAYS,
  type ShiftProtocolInput,
  type SkipReason,
} from "@/lib/schedule/shift-suggest";
import { snapStartToPattern, parseDayKey } from "@/lib/schedule/shift-transition";
import { reviseProtocol, type ProtocolInput } from "@/app/actions/protocols";

export type ApplyShiftResult =
  | { ok: true; newProtocolId: string; startDate: string }
  | {
      ok: false;
      error: string;
      code: "invalid" | "auth" | "not_found" | "changed" | "ineligible" | "race" | "failed";
    };

/**
 * Per-move outcome inside an Apply-all plan — the same shape
 * `applyShiftSuggestion` maps to `ApplyShiftResult`, plus the `protocolId` a
 * batch of them needs to tell moves apart.
 */
export type ApplyPlanMoveResult = { protocolId: string } & (
  | { ok: true; newProtocolId: string; startDate: string }
  | {
      ok: false;
      error: string;
      code: "invalid" | "auth" | "not_found" | "changed" | "ineligible" | "race" | "failed";
    }
);

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const FINGERPRINT_RE = /^[0-9a-f]{64}$/;

/** Same message reviseProtocol's compare-and-swap close returns on a race. */
const RACE_MESSAGE = "This protocol was already revised or closed. Refresh and try again.";

/**
 * Factual, reason-specific copy — logistics only, never dosing advice. Typed
 * against SkipReason (not `string`) so a reason the engine adds later fails
 * the build here instead of silently falling through to the generic fallback
 * message.
 */
const INELIGIBLE_MESSAGE: Record<SkipReason, string> = {
  inactive: "This protocol is not active.",
  stack: "This protocol is in a stack, so it is not eligible.",
  pinned: "This protocol is kept as is.",
  ends_soon: "This course ends within a week.",
  not_weekly: "This protocol's schedule is not a weekly pattern.",
  no_rule: "This protocol's schedule is not a weekly pattern.",
};

/** A real calendar day matching "YYYY-MM-DD" — rejects e.g. "2026-02-31". */
function isValidDateKey(key: string): boolean {
  if (!DATE_KEY_RE.test(key)) return false;
  const [y, mo, d] = key.split("-").map(Number);
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d;
}

/**
 * Field-level validation for one move — shared by `applyShiftSuggestion` (a
 * single move) and `applyShiftPlan` (every move in a plan validated
 * against this SAME rule set, up front, before any move is applied). `raw`
 * arrives over the wire and may not even be an object.
 */
function validateShiftMove(
  raw: unknown,
  viewer: { key: string; date: Date },
):
  | { ok: true; move: { protocolId: string; k: number; startDate: string; fingerprint: string } }
  | { ok: false; code: "invalid"; error: string } {
  // `raw` itself may not be an object at all (e.g. a POST body of `[]` or
  // `[null]`) — dereferencing a field on it before this check throws a
  // TypeError and turns into an HTTP 500. Widen to `unknown` first so this
  // defensive check isn't narrowed away by a caller's (trusted) declared type.
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, code: "invalid", error: "Invalid request." };
  }
  const r = raw as Record<string, unknown>;

  const protocolId = r.protocolId;
  if (typeof protocolId !== "string" || protocolId.length === 0 || protocolId.length > 64) {
    return { ok: false, code: "invalid", error: "Invalid protocol." };
  }
  const k = r.k;
  if (typeof k !== "number" || !Number.isInteger(k) || k < 1 || k > 6) {
    return { ok: false, code: "invalid", error: "Invalid rotation." };
  }
  const startDate = r.startDate;
  if (typeof startDate !== "string" || !isValidDateKey(startDate)) {
    return { ok: false, code: "invalid", error: "Invalid start date." };
  }
  // Same bound the engine now refuses to offer a move past (SHIFT_MAX_START_DAYS,
  // shift-suggest.ts), so the two agree by construction rather than by two
  // literals that drifted.
  const [ty, tm, td] = viewer.key.split("-").map(Number);
  const maxKey = dayKey(addDays(new Date(ty, tm - 1, td), SHIFT_MAX_START_DAYS));
  if (startDate < viewer.key || startDate > maxKey) {
    return {
      ok: false,
      code: "invalid",
      error: `Start date must be within the next ${SHIFT_MAX_START_DAYS} days.`,
    };
  }
  const fingerprint = r.fingerprint;
  if (typeof fingerprint !== "string" || !FINGERPRINT_RE.test(fingerprint)) {
    return { ok: false, code: "invalid", error: "Invalid request." };
  }
  return { ok: true, move: { protocolId, k, startDate, fingerprint } };
}

/**
 * Apply one dose-shift move: closes the live protocol and starts its rotated
 * successor through the existing `reviseProtocol` revision path. Shared core
 * behind `applyShiftSuggestion` (one move) and `applyShiftPlan` (N moves
 * applied in sequence through this same path, one call per move). `user` and
 * `viewer` are already resolved by the caller — fetched once per request,
 * never once per move — and `move` has already passed `validateShiftMove`
 * against that same `viewer`.
 */
async function applyOne(
  user: { id: string },
  viewer: { key: string; date: Date },
  move: { protocolId: string; k: number; startDate: string; fingerprint: string },
): Promise<ApplyPlanMoveResult> {
  const { protocolId, k, startDate, fingerprint } = move;

  try {
    // 1. Load — userId + active scoped, same shape reviseProtocol itself requires.
    const row = await prisma.protocol.findFirst({
      where: { id: protocolId, userId: user.id, status: "active" },
      include: { steps: true, peptide: { select: { name: true } } },
    });
    if (!row) return { protocolId, ok: false, code: "not_found", error: "Protocol not found." };

    // 2. Fingerprint must match the CURRENT row — rejects a rotation whose
    // rule changed underneath the user since the suggestion was computed.
    const expectedFingerprint = shiftFingerprint({
      protocolId: row.id,
      scheduleRule: row.scheduleRule,
      startDate: row.startDate,
      k,
    });
    if (expectedFingerprint !== fingerprint) {
      return {
        protocolId,
        ok: false,
        code: "changed",
        error: "The schedule changed since this suggestion was made. Refresh to see the current one.",
      };
    }

    // 3. Re-check eligibility server-side. loggedDayKeys is unused by
    // eligibility(), so [] here is fine — nothing derived from it feeds a
    // decision this function makes.
    const asShiftInput: ShiftProtocolInput = {
      id: row.id,
      name: row.name,
      peptideName: row.peptide.name,
      status: row.status,
      scheduleRule: row.scheduleRule,
      startDate: row.startDate,
      endDate: row.endDate,
      cycleOnWeeks: row.cycleOnWeeks,
      cycleOffWeeks: row.cycleOffWeeks,
      cycleAnchor: row.cycleAnchor,
      stackId: row.stackId,
      shiftPinned: row.shiftPinned,
      loggedDayKeys: [],
    };
    const el = eligibility(asShiftInput, viewer.date);
    if (!el.ok) {
      return { protocolId, ok: false, code: "ineligible", error: INELIGIBLE_MESSAGE[el.reason] };
    }
    // el.ok guarantees parseSchedule(row.scheduleRule) succeeded on a
    // non-empty rule (parseSchedule(null) is "no_rule", checked before stack/
    // pinned/ends_soon above) — row.scheduleRule is a real string here.
    const scheduleRule = row.scheduleRule as string;

    // 3b. computeShiftPlan never OFFERS a rotation that changes the
    // candidate's dose count inside the 28-day horizon, but a hand-crafted
    // request (a valid fingerprint paired with a k the plan never offered for
    // this protocol) reaches here without ever going through the engine's own
    // check — re-check it on the identical basis (rotationPreservesCount,
    // exported by shift-suggest.ts next to the loop's own dose-count check) before any
    // revision is built.
    if (!rotationPreservesCount({ protocol: asShiftInput, k, today: viewer.date })) {
      return {
        protocolId,
        ok: false,
        code: "ineligible",
        error: "That rotation would change the number of doses in the next four weeks.",
      };
    }

    // 4. Rebuild `next` ENTIRELY from the row + planCarryForward — nothing
    // from the client except k and startDate. Mirrors the protocol edit
    // page's own computation (src/app/protocols/[id]/edit/page.tsx) exactly.
    const deliveredRows = await prisma.doseLog.findMany({
      where: { userId: user.id, protocolId: row.id },
      orderBy: { takenAt: "asc" },
      select: { takenAt: true, localDay: true },
    });
    const deliveredDayKeys = deliveredRows.map(
      (d) => d.localDay ?? new Date(d.takenAt).toISOString().slice(0, 10),
    );

    // The RAW startDate is only the earliest day the user will accept — it is
    // not necessarily a day the rotated pattern actually runs on. Snap it
    // forward to the successor's real first dose (same rule the engine and the
    // sheet's live preview use — src/lib/schedule/shift-transition.ts) before
    // handing it to reviseProtocol. The snapped date may legitimately land up
    // to 6 days after the raw one; the ≥today/≤today+14 bounds
    // (validateShiftMove) are checked against the RAW date on purpose.
    const todayLogged = deliveredDayKeys.includes(viewer.key);
    const toDays = rotateDays(el.byDays, k);
    const start = snapStartToPattern({
      toDays,
      earliest: parseDayKey(startDate),
      today: viewer.date,
      todayLogged,
      protocolStartDate: row.startDate,
    });
    // The raw bound is today + 14 and the snap may add up to 6 more days (a
    // weekly pattern's widest gap), so a snapped start may legitimately land as
    // far out as today + 20 — but never past it. A protocol whose own
    // startDate is months away would otherwise sail through the raw check and
    // have reviseProtocol create a successor starting arbitrarily far out.
    if (dayKey(start) > dayKey(addDays(viewer.date, 20))) {
      return {
        protocolId,
        ok: false,
        code: "invalid",
        error: "The first day on the new pattern would be more than 20 days out. Pick an earlier start date.",
      };
    }

    const steps: CarryStep[] = [...row.steps]
      .sort((a, b) => a.stepIndex - b.stepIndex)
      .map((s) => ({
        stepIndex: s.stepIndex,
        dose: s.dose.toString(),
        doseInputUnit: s.doseInputUnit,
        durationDays: s.durationDays,
      }));

    // OLD (stored) rule, not the rotated one — a rotation preserves the weekly
    // dose count by construction (rotationPreservesCount above), so old and
    // new agree on injectionsPerWeek here; OLD is used only to mirror the edit
    // page's own computation exactly (src/app/protocols/[id]/edit/page.tsx).
    const injectionsPerWeek = dosesPerWeek(row.scheduleRule);
    const daysSpentInCurrentPhase = daysSpentInPhase({
      steps,
      injectionsPerWeek,
      deliveredDayKeys,
      todayKey: viewer.key,
    });
    const carrySteps = planCarryForward({
      steps,
      injectionsPerWeek,
      deliveredCount: deliveredDayKeys.length,
      daysSpentInCurrentPhase,
    });

    const next: ProtocolInput = {
      peptideId: row.peptideId,
      prescriptionId: row.prescriptionId ?? undefined,
      name: row.name,
      source: row.source,
      scheduleType: row.scheduleType,
      scheduleRule: rotatedRule(scheduleRule, k),
      rebaseMode: row.rebaseMode,
      adherenceWindowMin: String(row.adherenceWindowMin),
      defaultSyringeId: row.defaultSyringeId ?? undefined,
      targetDose: row.targetDose?.toString(),
      doseInputUnit: row.doseInputUnit,
      doseBasis: row.doseBasis,
      // `endDate` is deliberately ABSENT. reviseProtocol already carries
      // the predecessor's own endDate byte-for-byte when `next.endDate` is
      // undefined; re-deriving it here as a date-only string goes through
      // `toISOString()`, which moves a LOCAL-midnight endDate (the form
      // src/app/actions/cycle.ts writes) back a day in any timezone ahead of
      // UTC and would then take reviseProtocol's explicit-override branch,
      // shortening the course by a day.
      steps: carrySteps.map((s) => ({
        dose: s.dose,
        doseInputUnit: s.doseInputUnit,
        durationDays: s.durationDays == null ? "" : String(s.durationDays),
      })),
    };

    // 5. reviseProtocol closes the predecessor (CAS on status:"active") and
    // creates the rotated successor; it already runs planned-dose generation
    // and revalidates /protocols, / and /today. Pass the SNAPPED start date,
    // never the raw one.
    const res = await reviseProtocol({ id: row.id, next, startDate: dayKey(start) });
    if (res.ok) {
      // 6. Best-effort audit row for the shift itself — own try/catch so
      // a logging failure can never undo a revision that already succeeded.
      try {
        await prisma.auditLog.create({
          data: {
            userId: user.id,
            entityType: "Protocol",
            entityId: res.id,
            field: "shift",
            newValue: `k=${k}; ${el.byDays.join(",")} -> ${toDays.join(",")}; start ${dayKey(start)}; from ${row.id}`,
          },
        });
      } catch (e) {
        console.error("applyOne audit log failed", e);
      }
      return { protocolId, ok: true, newProtocolId: res.id, startDate: dayKey(start) };
    }
    if (res.error === RACE_MESSAGE) return { protocolId, ok: false, code: "race", error: res.error };
    return { protocolId, ok: false, code: "failed", error: res.error };
  } catch (e) {
    console.error("applyOne failed", e);
    return { protocolId, ok: false, code: "failed", error: "Could not apply the suggestion." };
  }
}

/**
 * Apply one dose-shift suggestion — thin wrapper over `applyOne`: validates
 * the single move and resolves auth/viewer once, then delegates.
 *
 * The raw `input` arrives over the wire, so every field is validated
 * defensively regardless of what the declared parameter type claims about it.
 */
export async function applyShiftSuggestion(input: {
  protocolId: string;
  k: number;
  startDate: string;
  fingerprint: string;
}): Promise<ApplyShiftResult> {
  const viewer = await viewerToday();
  const validated = validateShiftMove(input, viewer);
  if (!validated.ok) return { ok: false, code: validated.code, error: validated.error };

  const user = await getCurrentUser();
  if (!user) return { ok: false, code: "auth", error: "Not signed in." };

  const result = await applyOne(user, viewer, validated.move);
  if (result.ok) return { ok: true, newProtocolId: result.newProtocolId, startDate: result.startDate };
  return { ok: false, code: result.code, error: result.error };
}

/**
 * Apply-all: apply a combined plan's moves one at a time through
 * the SAME single-protocol path as `applyShiftSuggestion` — `applyOne`,
 * shared by both. Moves run in the order given, which the engine has already
 * put in best-prefix-first order (`orderByBestPrefix`, shift-suggest.ts) for
 * exactly this reason; the first failure stops the run, so later moves get no
 * result entry at all and no un-revise exists. There is still no
 * multi-protocol transaction: every landed move is a valid revision on its own,
 * and the moves that landed are whatever prefix got that far.
 *
 * Every move's shape is validated up front, against the SAME field rules as
 * `applyShiftSuggestion`, BEFORE any move is applied — a malformed later move
 * (or a duplicate protocolId) must never leave a half-applied plan.
 */
export async function applyShiftPlan(input: {
  moves: { protocolId: string; k: number; startDate: string; fingerprint: string }[];
}): Promise<{ ok: boolean; appliedCount: number; results: ApplyPlanMoveResult[] }> {
  // `input` itself may not be an object (e.g. a POST body of `[]`/`[null]`) —
  // dereferencing `.moves` on it before this check throws and turns into a 500.
  const rawInput: unknown = input;
  if (rawInput === null || typeof rawInput !== "object" || Array.isArray(rawInput)) {
    return {
      ok: false,
      appliedCount: 0,
      results: [{ protocolId: "", ok: false, code: "invalid", error: "Invalid request." }],
    };
  }
  const raw = rawInput as Record<string, unknown>;
  const rawMoves = raw.moves;
  if (!Array.isArray(rawMoves) || rawMoves.length < 1 || rawMoves.length > MAX_PLAN_MOVES) {
    return {
      ok: false,
      appliedCount: 0,
      results: [
        {
          protocolId: "",
          ok: false,
          code: "invalid",
          error: `A plan must have between 1 and ${MAX_PLAN_MOVES} moves.`,
        },
      ],
    };
  }

  // getCurrentUser/viewerToday ONCE per request — never once per move.
  const viewer = await viewerToday();

  // Every move's shape validated up front, against the identical rules
  // applyShiftSuggestion uses, and protocolIds must be distinct (one revision
  // per protocol per plan) — BEFORE any move is applied.
  const seenProtocolIds = new Set<string>();
  const moves: { protocolId: string; k: number; startDate: string; fingerprint: string }[] = [];
  for (const rawMove of rawMoves) {
    const validated = validateShiftMove(rawMove, viewer);
    if (!validated.ok) {
      return { ok: false, appliedCount: 0, results: [{ protocolId: "", ...validated }] };
    }
    if (seenProtocolIds.has(validated.move.protocolId)) {
      return {
        ok: false,
        appliedCount: 0,
        results: [
          {
            protocolId: validated.move.protocolId,
            ok: false,
            code: "invalid",
            error: "Each protocol can only appear once in a plan.",
          },
        ],
      };
    }
    seenProtocolIds.add(validated.move.protocolId);
    moves.push(validated.move);
  }

  const user = await getCurrentUser();
  if (!user) {
    return {
      ok: false,
      appliedCount: 0,
      results: [{ protocolId: "", ok: false, code: "auth", error: "Not signed in." }],
    };
  }

  // Apply sequentially, in the given (engine) order, through the SAME
  // applyOne core applyShiftSuggestion uses. Stop at the first failure —
  // later moves get no result entry at all, never a synthetic "not attempted"
  // placeholder.
  const results: ApplyPlanMoveResult[] = [];
  let appliedCount = 0;
  for (const move of moves) {
    const result = await applyOne(user, viewer, move);
    results.push(result);
    if (!result.ok) break;
    appliedCount++;
  }

  // Once at the end, not once per move — reviseProtocol already revalidates
  // internally on every successful call; this is the plan-level pass,
  // regardless of how many moves actually landed.
  revalidatePath("/protocols");
  revalidatePath("/today");

  return { ok: appliedCount === moves.length, appliedCount, results };
}

/** Toggle "keep as is" (Protocol.shiftPinned) for one of the viewer's own protocols. */
export async function pinShiftSuggestion(input: {
  protocolId: string;
  pinned: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  // `input` itself may not be an object (e.g. a POST body of `[]`/`[null]`) —
  // dereferencing a field on it before this check throws and turns into a 500.
  // Widen to `unknown` first so this defensive check isn't narrowed away by
  // the declared (trusted) parameter type.
  const rawInput: unknown = input;
  if (rawInput === null || typeof rawInput !== "object" || Array.isArray(rawInput)) {
    return { ok: false, error: "Invalid request." };
  }
  const raw = rawInput as Record<string, unknown>;
  if (typeof raw.protocolId !== "string" || raw.protocolId.length === 0 || raw.protocolId.length > 64) {
    return { ok: false, error: "Invalid protocol." };
  }
  if (typeof raw.pinned !== "boolean") {
    return { ok: false, error: "Invalid request." };
  }
  const protocolId = raw.protocolId;
  const pinned = raw.pinned;

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  try {
    const res = await prisma.protocol.updateMany({
      where: { id: protocolId, userId: user.id },
      data: { shiftPinned: pinned },
    });
    if (res.count === 0) return { ok: false, error: "Protocol not found." };
  } catch (e) {
    console.error("pinShiftSuggestion failed", e);
    return { ok: false, error: "Could not update the protocol." };
  }

  revalidatePath("/protocols");
  revalidatePath("/today");
  return { ok: true };
}
