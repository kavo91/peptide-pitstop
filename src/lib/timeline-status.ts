import type { DoseStatus, LoggedDose, TimelineEntry } from "./doses-timeline-core";
import type { ResolvedStatus } from "./titration/types";

/** A protocol's resolved slots for the timeline range (built from resolveTitration). */
export interface ResolvedOcc {
  protocolId: string;
  peptideId: string;
  peptideName: string;
  slots: {
    date: string;          // "YYYY-MM-DD"
    time: string | null;
    status: ResolvedStatus;
    doseLabel: string;     // per-slot per-injection label, e.g. "4 mg"
    phaseIndex: number | null;
    doseLogId?: string;    // set when status === "taken" and a log matched
    rebased?: boolean;     // slot produced by a fixed_anchor within-week rebase
  }[];
}

/**
 * Clip a protocol's resolved slots to the inclusive date-key range the user is
 * viewing. The resolver is run over an EXPANDED range (rangeEnd + buffer) so the
 * trailing in-range slot has a real successor for the missed/pending decision
 * (§4a); this drops the buffer slots before display. Keys are "YYYY-MM-DD", so
 * lexical comparison is chronological.
 */
export function clipSlotsToRange(
  slots: ResolvedOcc["slots"],
  startKey: string,
  endKey: string,
): ResolvedOcc["slots"] {
  return slots.filter((s) => s.date >= startKey && s.date <= endKey);
}

/**
 * Single source of truth for dose-status presentation (labels, explainers, dot +
 * chip Tailwind classes, legend order). Previously these maps were triplicated
 * across DosesMonth / DosesWeek / DayDetail and had drifted. Keyed by every
 * DoseStatus member. Colour classes are copied VERBATIM from the components — do
 * not alter them (color-contrast.test.ts asserts on the resulting tokens).
 */

/** Short human label for each status. */
export const STATUS_LABEL: Record<DoseStatus, string> = {
  taken_ontime: "Taken",
  taken_offschedule: "Off-schedule",
  taken_rebased: "Shifted",
  planned: "Planned",
  missed: "Missed",
};

/** One-sentence explainer for each status (legend caption + chip tooltip). */
export const STATUS_DESCRIPTION: Record<DoseStatus, string> = {
  taken_ontime: "Dose taken on its planned day.",
  taken_offschedule: "Dose taken off the planned day; your schedule is unchanged and stays on its original grid.",
  taken_rebased: "Dose taken off the planned day, and that week's schedule moved to match; it snaps back to the original grid next week.",
  planned: "Dose planned for a future day.",
  missed: "Planned dose with no matching log on a past day.",
};

/** Status-dot Tailwind classes — copied verbatim from DosesMonth/DosesWeek. */
export const STATUS_DOT_CLASS: Record<DoseStatus, string> = {
  taken_ontime: "bg-ok",
  taken_offschedule: "bg-warn",
  taken_rebased: "bg-accent2",
  planned: "border-2 border-accent",
  missed: "bg-danger",
};

/** Chip Tailwind classes — copied verbatim from DayDetail's CHIP map. */
export const STATUS_CHIP_CLASS: Record<DoseStatus, string> = {
  taken_ontime: "bg-ok/10 text-ok",
  taken_offschedule: "bg-warn/10 text-warn",
  taken_rebased: "bg-accent2/10 text-accent2Strong",
  planned: "bg-accent/10 text-accentStrong",
  missed: "bg-danger/10 text-danger",
};

/** Legend display order: taken, shifted, off-schedule, planned, missed. */
export const LEGEND_ORDER: DoseStatus[] = [
  "taken_ontime",
  "taken_rebased",
  "taken_offschedule",
  "planned",
  "missed",
];

const MAP: Record<ResolvedStatus, DoseStatus> = {
  taken: "taken_ontime",
  pending: "planned",
  missed: "missed",
  projected: "planned",
  skipped: "planned",
};

/**
 * Build timeline entries from resolver-derived per-slot status (§4a), so the
 * calendar agrees with Today. Logged doses not matched to any resolved slot are
 * appended as taken_offschedule (same as the legacy classifier).
 */
export function buildTimelineEntries(args: {
  todayKey: string;
  occurrences: ResolvedOcc[];
  logs: LoggedDose[];
}): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  const consumed = new Set<string>();
  // For a TAKEN slot we show the ACTUAL logged time (the dose was taken then), not
  // the scheduled slot time — a shifted dose was taken at its own clock time.
  const logById = new Map(args.logs.map((l) => [l.doseLogId, l]));

  for (const occ of args.occurrences) {
    for (const s of occ.slots) {
      if (s.doseLogId) consumed.add(s.doseLogId);
      // A matched dose on a rebased (shifted) slot gets its own status/colour so
      // the schedule shift is visible — distinct from a normal on-grid "taken".
      const status: DoseStatus = s.status === "taken" && s.rebased ? "taken_rebased" : MAP[s.status];
      const time = s.doseLogId ? (logById.get(s.doseLogId)?.time ?? s.time) : s.time;
      entries.push({
        date: s.date, time, protocolId: occ.protocolId,
        peptideId: occ.peptideId, peptideName: occ.peptideName,
        doseLabel: s.doseLabel, status, phaseIndex: s.phaseIndex,
        doseLogId: s.doseLogId,
      });
    }
  }

  for (const log of args.logs) {
    if (consumed.has(log.doseLogId)) continue;
    entries.push({
      date: log.dateKey, time: log.time, protocolId: log.protocolId, peptideId: log.peptideId,
      peptideName: log.peptideName, doseLabel: log.doseLabel,
      status: "taken_offschedule", doseLogId: log.doseLogId,
    });
  }

  return entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.peptideName.localeCompare(b.peptideName)));
}
