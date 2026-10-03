/**
 * Keeping `cycleAnchor` linked to `startDate`.
 *
 * `cycleAnchor` is the start of the CURRENT on-cycle, and null falls back to
 * `startDate` at read time — the schema says so and every reader honours it
 * (cycleState, forecast-slots, protocol-gantt, shift-suggest all take
 * `cycleAnchor ?? startDate`). An anchor WRITTEN equal to the start date is
 * therefore only a materialised copy of it. Edit the start date afterwards and
 * that copy silently stops matching: the cycle counts from a day the protocol
 * no longer starts on, and the first on-block is short by exactly the edit
 * distance. No surface says a word about it.
 *
 * Example: a protocol created with startDate = cycleAnchor on day 1, then
 * moved to start on day 8. If the anchor stays on day 1, an 8-week ON block
 * ends a week early: 49 dosing days, not the intended 56.
 *
 * The rule, deliberately narrow:
 *
 *   - The anchor moves only when it was LINKED — stored anchor on the same DAY
 *     as the stored start date. An anchor a user deliberately placed elsewhere
 *     (GanttRowEditor owns that field) is a statement of intent, never rewritten.
 *   - A null anchor already follows `startDate` at read time, so there is
 *     nothing to write; leaving it null keeps it following forever.
 *   - Doses logged ⇒ the anchor does NOT move. The on-block those doses sit in
 *     really did begin on the anchor. Re-dating it would rewrite history the
 *     dose logs contradict, and cycleState would then report "day N of M"
 *     against doses that disagree with it. The caller surfaces `warn` instead;
 *     the sanctioned fix is reviseProtocol (close the course, start a new one) —
 *     the same escape hatch assertNoScheduleRewrite already routes to.
 *
 * Re-freezing the anchor onto the new start date is safe precisely BECAUSE the
 * rule keys on "anchor === startDate": the pair stays linked, so the next edit
 * follows too. The link is self-sustaining rather than one-shot.
 *
 * PURE — date-only, no I/O.
 */
import { dateOnlyKey } from "../schedule/schedule";

/**
 * Date-only "YYYY-MM-DD" of either stored form; null stays null. Matches
 * actions/protocols.dayOf.
 */
const day = (d: Date | null | undefined): string | null => (d ? dateOnlyKey(d) : null);

export interface AnchorFollowInput {
  /** Protocol.startDate as currently stored. */
  storedStartDate: Date | null;
  /** Protocol.cycleAnchor as currently stored. */
  storedAnchor: Date | null;
  /** The start date this write is about to persist. */
  nextStartDate: Date | null;
  /** Does this protocol have any DoseLog rows at all? */
  hasDoseLogs: boolean;
}

export interface AnchorFollowResult {
  /** Write `anchor` to Protocol.cycleAnchor. False = leave the column untouched. */
  move: boolean;
  /** The anchor to write when `move` — otherwise the stored value, unchanged. */
  anchor: Date | null;
  /** Tell the user the cycle window stayed put while the start date moved. */
  warn: boolean;
}

/**
 * Decide whether `cycleAnchor` follows a changing `startDate`.
 * Callers pass the STORED row and the value they are about to write.
 */
export function cycleAnchorFollow(input: AnchorFollowInput): AnchorFollowResult {
  const stay: AnchorFollowResult = { move: false, anchor: input.storedAnchor, warn: false };

  // The start date did not actually move — a form echo, or an unrelated field
  // on the same save. Nothing to reconcile.
  if (day(input.storedStartDate) === day(input.nextStartDate)) return stay;

  // Null already resolves to startDate at read time, so it follows on its own.
  if (!input.storedAnchor) return stay;

  // Placed away from the start on purpose. The user owns this value.
  if (day(input.storedAnchor) !== day(input.storedStartDate)) return stay;

  // Linked, and the start moved. History decides whether the anchor may follow.
  if (input.hasDoseLogs) return { ...stay, warn: true };

  return { move: true, anchor: input.nextStartDate, warn: false };
}

/**
 * Shown when a linked anchor was HELD because doses exist. Non-fatal: the start
 * date change itself still persists, so the message must say what did not move.
 */
export const ANCHOR_HELD_WARNING =
  "Start date moved, but this protocol already has logged doses, so the cycle window still counts from its original anchor. Revise the protocol if the cycle should restart from the new date.";
