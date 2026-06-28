import { describe, it, expect } from "vitest";
import { classifyTimeline } from "./doses-timeline-core";

/** Helper: build a PlannedOcc with untimed slots from a list of date strings. */
const occ = (protocolId: string, dates: string[]) => ({
  protocolId, peptideId: "p", peptideName: "Tα1", doseLabel: "1.5 mg",
  slots: dates.map((date) => ({ date, time: null })),
});

/** Helper: build a PlannedOcc with timed slots. */
const occTimed = (protocolId: string, entries: { date: string; time: string | null }[]) => ({
  protocolId, peptideId: "p", peptideName: "Tα1", doseLabel: "1.5 mg",
  slots: entries,
});

describe("classifyTimeline", () => {
  it("marks a grid day with a same-day log as taken_ontime", () => {
    const out = classifyTimeline({
      todayKey: "2026-06-17",
      occurrences: [occ("pr1", ["2026-06-15", "2026-06-17", "2026-06-19"])],
      logs: [{ protocolId: "pr1", peptideId: "p", peptideName: "Tα1", doseLabel: "1.5 mg", dateKey: "2026-06-15", doseLogId: "l1" }],
    });
    const byDate = Object.fromEntries(out.map((e) => [e.date, e.status]));
    expect(byDate["2026-06-15"]).toBe("taken_ontime");
    expect(byDate["2026-06-17"]).toBe("planned");
    expect(byDate["2026-06-19"]).toBe("planned");
  });
  it("marks a past grid day with no log as missed", () => {
    const out = classifyTimeline({ todayKey: "2026-06-20", occurrences: [occ("pr1", ["2026-06-15"])], logs: [] });
    expect(out[0].status).toBe("missed");
  });
  it("an off-grid log is taken_offschedule (extra entry)", () => {
    const out = classifyTimeline({
      todayKey: "2026-06-20",
      occurrences: [occ("pr1", ["2026-06-15"])],
      logs: [{ protocolId: "pr1", peptideId: "p", peptideName: "Tα1", doseLabel: "1.5 mg", dateKey: "2026-06-14", doseLogId: "l1" }],
    });
    const byDate = Object.fromEntries(out.map((e) => [e.date, e.status]));
    expect(byDate["2026-06-14"]).toBe("taken_offschedule");
    expect(byDate["2026-06-15"]).toBe("missed");
  });

  it("multi-slot day: each timed slot gets its own entry; one log consumes one slot", () => {
    const out = classifyTimeline({
      todayKey: "2026-06-20",
      occurrences: [occTimed("pr1", [
        { date: "2026-06-17", time: "08:00" },
        { date: "2026-06-17", time: "20:00" },
      ])],
      logs: [{ protocolId: "pr1", peptideId: "p", peptideName: "Tα1", doseLabel: "1.5 mg", dateKey: "2026-06-17", doseLogId: "l1" }],
    });
    // Two entries for the same date
    const dayEntries = out.filter((e) => e.date === "2026-06-17");
    expect(dayEntries).toHaveLength(2);
    const statuses = dayEntries.map((e) => e.status).sort();
    expect(statuses).toEqual(["missed", "taken_ontime"]);
    // time is preserved on entries
    const takenEntry = dayEntries.find((e) => e.status === "taken_ontime")!;
    expect(["08:00", "20:00"]).toContain(takenEntry.time);
  });

  it("carries time through to the TimelineEntry", () => {
    const out = classifyTimeline({
      todayKey: "2026-06-20",
      occurrences: [occTimed("pr1", [{ date: "2026-06-18", time: "07:30" }])],
      logs: [],
    });
    expect(out[0].time).toBe("07:30");
    expect(out[0].status).toBe("missed");
  });
});
