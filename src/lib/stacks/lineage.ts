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
 *   2. else the latest startDate (revisions always start after their
 *      predecessor; null sorts earliest);
 *   3. else the largest id (cuids are time-ordered; stable final tie-break).
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
