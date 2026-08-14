/**
 * "One protocol per peptide" — what the rule actually means.
 *
 * The real invariant is **one ACTIVE protocol per peptide**: two active
 * protocols for one compound would both generate planned doses, so /today would
 * show the peptide twice and adherence would double-count.
 *
 * The rule used to be enforced by counting protocols of ANY status, which was
 * wrong in a way the app's own guidance guarantees you hit. Editing a titration
 * protocol's scheduleRule re-times every step and orphans logged doses, so the
 * documented workflow is "close the protocol, start a new one" — which leaves a
 * `completed` row behind forever. That stale row then read as a conflict, and
 * the peptide's live protocol could never be saved again ("That peptide already
 * has a protocol — edit it instead", on the very page you were told to use).
 * Seen wherever a peptide is run, cycled off, and started again.
 *
 * Finished and paused courses are history, not competition. PURE — no I/O.
 */

/** The status that means "this protocol is live and generating doses". */
const ACTIVE = "active";

/**
 * Would saving `saving` leave two active protocols on one peptide?
 *
 * `existing` is every protocol already stored FOR THAT PEPTIDE (id + status).
 * The row being edited is excluded by id, so a protocol never conflicts with
 * itself. Saving a protocol as paused/completed never conflicts — parking a
 * course is always allowed.
 */
export function hasActiveProtocolConflict(
  existing: readonly { id: string; status: string }[],
  saving: { id?: string; status: string },
): boolean {
  if (saving.status !== ACTIVE) return false;
  return existing.some((p) => p.id !== saving.id && p.status === ACTIVE);
}

/**
 * Peptide ids that already have a LIVE protocol, for filtering the new-protocol
 * picker. A peptide whose only protocol is completed is free to be run again —
 * which is the whole point of cycling off and back on.
 */
export function peptidesWithActiveProtocol(
  rows: readonly { peptideId: string; status: string }[],
): Set<string> {
  return new Set(rows.filter((r) => r.status === ACTIVE).map((r) => r.peptideId));
}
