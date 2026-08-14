import { compareStackGrouped, compareTime } from "./stack-sort";

export type DoseStatus = "taken_ontime" | "taken_offschedule" | "taken_rebased" | "planned" | "missed";

export interface PlannedOcc {
  protocolId: string;
  peptideId: string;
  peptideName: string;
  stackId?: string | null;
  stackName?: string | null;
  doseLabel: string;
  slots: { date: string; time: string | null }[];
}
export interface LoggedDose {
  protocolId: string | null;
  peptideId: string;
  peptideName: string;
  stackId?: string | null;
  stackName?: string | null;
  doseLabel: string;
  dateKey: string;
  doseLogId: string;
  /** Actual local clock time the dose was logged, "HH:MM" — shown for taken entries
   *  instead of the scheduled slot time (a shifted dose was taken at its own time). */
  time?: string | null;
}
export interface TimelineEntry {
  date: string;
  /** Scheduled slot time "HH:MM", or null / undefined for untimed. */
  time?: string | null;
  protocolId: string | null;
  peptideId: string;
  peptideName: string;
  stackId?: string | null;
  stackName?: string | null;
  doseLabel: string;
  status: DoseStatus;
  doseLogId?: string;
  /** Titration phase index for this slot (null/undefined = non-titration). Phase 2. */
  phaseIndex?: number | null;
}

export function classifyTimeline(args: {
  todayKey: string;
  occurrences: PlannedOcc[];
  logs: LoggedDose[];
}): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  const consumed = new Set<string>();

  for (const occ of args.occurrences) {
    for (const slot of occ.slots) {
      const { date, time } = slot;
      // Log matching is time-agnostic: any log for this protocol on this date
      // consumes one planned slot (first-come-first-served).
      const log = args.logs.find(
        (l) => l.protocolId === occ.protocolId && l.dateKey === date && !consumed.has(l.doseLogId),
      );
      if (log) {
        consumed.add(log.doseLogId);
        entries.push({
          // A taken entry displays the ACTUAL phone-local clock stored on the
          // log, not the scheduled slot clock. The slot still determines its
          // planned/taken classification.
          date, time: log.time ?? time, protocolId: occ.protocolId, peptideId: occ.peptideId, peptideName: occ.peptideName,
          stackId: occ.stackId, stackName: occ.stackName,
          doseLabel: occ.doseLabel, status: "taken_ontime", doseLogId: log.doseLogId,
        });
      } else {
        entries.push({
          date, time, protocolId: occ.protocolId, peptideId: occ.peptideId, peptideName: occ.peptideName,
          stackId: occ.stackId, stackName: occ.stackName,
          doseLabel: occ.doseLabel, status: date < args.todayKey ? "missed" : "planned",
        });
      }
    }
  }

  for (const log of args.logs) {
    if (consumed.has(log.doseLogId)) continue;
    entries.push({
      date: log.dateKey, time: log.time, protocolId: log.protocolId, peptideId: log.peptideId, peptideName: log.peptideName,
      stackId: log.stackId, stackName: log.stackName,
      doseLabel: log.doseLabel, status: "taken_offschedule", doseLogId: log.doseLogId,
    });
  }

  return entries.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const timeCmp = compareTime(a.time, b.time);
    if (timeCmp !== 0) return timeCmp;
    return compareStackGrouped(a, b);
  });
}

/** Local-date key, YYYY-MM-DD — the same shape slot dates carry. */
const DATE_KEY = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export interface SupersedableProtocol {
  id: string;
  peptideId: string;
  status: string;
  startDate: Date | null;
  /**
   * Explicit revision chain (lib/protocol-revision.courseKey). Null on every
   * protocol not created by reviseProtocol, which is why the peptide heuristic
   * below stays as the fallback rather than being replaced.
   */
  courseId?: string | null;
}

/**
 * Where each RETIRED protocol's schedule stops because a replacement took over.
 *
 * The timeline deliberately expands completed protocols so a finished course
 * still shows its history — but it expands them across the whole viewed range,
 * bounded only by `endDate`. A course closed EARLY keeps an endDate weeks out
 * (a 12-week course closed after five), so it kept
 * emitting slots long after it stopped. Those slots can never match a log — the
 * doses were logged against the replacement protocol — so every one of them
 * rendered as a MISSED dose on days the user actually dosed, and sat as a second
 * slot beside the live protocol's own.
 *
 * The app already enforces one ACTIVE protocol per peptide, so the successor's
 * `startDate` is the honest stop line: from that day the peptide belongs to the
 * newer course. Days BEFORE it stay untouched, so a genuine miss at the tail of
 * a course is still a miss.
 *
 * TWO SOURCES, deliberately ordered. `reviseProtocol` records the handover
 * EXPLICITLY via `courseId`, and an explicit link cannot be wrong. The peptide
 * grouping is an INFERENCE — "the next course for this peptide" — which is
 * right for a manually closed protocol but can mis-attribute when an unrelated
 * course for the same peptide happens to start in between. So the explicit
 * successor wins where one exists, and the inference stays as the fallback for
 * every protocol predating the revision feature (all of which have a null
 * courseId, so their behaviour is unchanged).
 *
 * @returns protocolId → EXCLUSIVE date key; slots on or after it are dropped.
 */
export function supersededFrom(protocols: SupersedableProtocol[]): Map<string, string> {
  const out = new Map<string, string>();
  const byPeptide = new Map<string, SupersedableProtocol[]>();
  for (const p of protocols) {
    const list = byPeptide.get(p.peptideId) ?? [];
    list.push(p);
    byPeptide.set(p.peptideId, list);
  }

  // Same rule as lib/protocol-revision.courseKey — kept inline so this module
  // stays dependency-free and usable from the timeline core.
  const course = (p: SupersedableProtocol) => p.courseId ?? p.id;

  for (const group of byPeptide.values()) {
    for (const p of group) {
      if (p.status === "active" || !p.startDate) continue;

      const earliestAfter = (candidates: SupersedableProtocol[]): Date | null => {
        let best: Date | null = null;
        for (const other of candidates) {
          if (other.id === p.id || !other.startDate) continue;
          if (other.startDate.getTime() <= p.startDate!.getTime()) continue;
          if (best === null || other.startDate.getTime() < best.getTime()) best = other.startDate;
        }
        return best;
      };

      // Explicit chain first; the peptide-wide inference only fills the gap.
      const sameCourse = group.filter((o) => course(o) === course(p));
      const successor = earliestAfter(sameCourse) ?? earliestAfter(group);
      if (successor) out.set(p.id, DATE_KEY(successor));
    }
  }
  return out;
}
