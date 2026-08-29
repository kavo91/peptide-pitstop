/**
 * Course lineage inside a stack — pure, no I/O.
 *
 * reviseProtocol keeps BOTH the completed predecessor and its successor in the
 * stack (successor carries stackId; courseId chains them). Every stack surface
 * that iterates `stack.protocols` must therefore distinguish the course TIP
 * (the operable row) from superseded history: display, schedule writes, status
 * cascades, due-gating and same-day dedup all go wrong otherwise — from
 * double-logging a peptide on revision day to resurrecting a closed course.
 *
 * Tip selection per course group (`courseId ?? id`):
 *   1. a non-completed member if one exists (the live successor);
 *   2. else a SUCCESSOR over the course ORIGIN — within one course only the
 *      origin carries `courseId === null`. This outranks the date because a
 *      revision's startDate is user-supplied: a backdated revision would
 *      otherwise invert the lineage here once both rows are completed, electing
 *      the frozen predecessor as the operable tip. reviseProtocol now refuses
 *      such a revision; this rule additionally covers rows created before that
 *      guard existed. SCOPE: courses are FLAT — reviseProtocol writes
 *      `courseId: old.courseId ?? old.id`, so every successor in a chain carries
 *      the ORIGIN's id, not its immediate predecessor's. This rule therefore
 *      separates origin from successors, but CANNOT order two successors of the
 *      same origin; a 3+ revision chain still falls through to the date below.
 *      Ordering those would need a real predecessor pointer or a createdAt
 *      column, neither of which the schema has;
 *   3. else the latest startDate (null sorts earliest);
 *   4. else the largest id (cuids are time-ordered; stable final tie-break).
 * A never-revised protocol is its own group's tip, so pre-revision stacks —
 * including fully completed legacy ones — behave byte-identically.
 */

export interface LineageProtocol {
  id: string;
  courseId: string | null;
  status: string;
  startDate: Date | null;
}

export const courseKey = (p: { id: string; courseId: string | null }): string => p.courseId ?? p.id;

export function courseTips<T extends LineageProtocol>(protocols: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const p of protocols) {
    const k = courseKey(p);
    const g = groups.get(k);
    if (g) g.push(p);
    else groups.set(k, [p]);
  }
  const tips: T[] = [];
  for (const g of groups.values()) {
    const live = g.filter((p) => p.status !== "completed");
    const pool = live.length > 0 ? live : g;
    tips.push(
      pool.reduce((best, p) => {
        // Structure before date: only the course ORIGIN has courseId === null, and
        // a successor is by definition later in the lineage. startDate cannot be
        // trusted for this — it is user-supplied and a backdated revision would
        // flip the order, handing tip status to the row that is frozen history.
        // Separates origin from successors only; two successors of the same
        // origin are indistinguishable here (flat courseId) and fall to the date.
        const bestIsOrigin = best.courseId === null;
        const pIsOrigin = p.courseId === null;
        if (pIsOrigin !== bestIsOrigin) return pIsOrigin ? best : p;
        const a = best.startDate?.getTime() ?? -Infinity;
        const b = p.startDate?.getTime() ?? -Infinity;
        if (b !== a) return b > a ? p : best;
        return p.id > best.id ? p : best;
      }),
    );
  }
  // Preserve the caller's ordering (stack views sort by id asc upstream).
  const tipIds = new Set(tips.map((t) => t.id));
  return protocols.filter((p) => tipIds.has(p.id));
}

/** Ids of superseded (non-tip) rows — frozen history no write may touch. */
export function supersededIds<T extends LineageProtocol>(protocols: T[]): Set<string> {
  const tips = new Set(courseTips(protocols).map((t) => t.id));
  return new Set(protocols.filter((p) => !tips.has(p.id)).map((p) => p.id));
}

/** All ids sharing a course with `p` (itself included) — the dedup scope for "already dosed today". */
export function courseGroupIds<T extends LineageProtocol>(protocols: T[], p: T): string[] {
  const k = courseKey(p);
  return protocols.filter((q) => courseKey(q) === k).map((q) => q.id);
}
