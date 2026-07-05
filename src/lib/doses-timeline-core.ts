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
          date, time, protocolId: occ.protocolId, peptideId: occ.peptideId, peptideName: occ.peptideName,
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
