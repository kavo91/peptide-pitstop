import { describe, it, expect } from "vitest";
import { classifyTimeline, supersededFrom } from "./doses-timeline-core";

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
      logs: [{ protocolId: "pr1", peptideId: "p", peptideName: "Tα1", doseLabel: "1.5 mg", dateKey: "2026-06-17", doseLogId: "l1", time: "21:03" }],
    });
    // Two entries for the same date
    const dayEntries = out.filter((e) => e.date === "2026-06-17");
    expect(dayEntries).toHaveLength(2);
    const statuses = dayEntries.map((e) => e.status).sort();
    expect(statuses).toEqual(["missed", "taken_ontime"]);
    // A taken entry shows its actual phone-local time, not the scheduled slot.
    const takenEntry = dayEntries.find((e) => e.status === "taken_ontime")!;
    expect(takenEntry.time).toBe("21:03");
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

describe("supersededFrom — a closed course stops where its replacement starts", () => {
  const d = (s: string) => new Date(s + "T00:00:00");

  it("stops a completed protocol at the successor's start date", () => {
    // A course closed early while its endDate still reads weeks out,
    // replaced the same day. Without a stop line the old course kept emitting
    // slots that no log could match — rendered as misses on days he did dose.
    const cuts = supersededFrom([
      { id: "old", peptideId: "tesa", status: "completed", startDate: d("2026-07-07") },
      { id: "new", peptideId: "tesa", status: "active", startDate: d("2026-08-11") },
    ]);

    expect(cuts.get("old")).toBe("2026-08-11");
    expect(cuts.has("new")).toBe(false);
  });

  it("leaves a completed protocol with no successor alone", () => {
    const cuts = supersededFrom([
      { id: "solo", peptideId: "ghk", status: "completed", startDate: d("2026-06-24") },
    ]);
    expect(cuts.size).toBe(0);
  });

  it("never cuts across peptides", () => {
    const cuts = supersededFrom([
      { id: "old", peptideId: "tesa", status: "completed", startDate: d("2026-07-07") },
      { id: "other", peptideId: "mots", status: "active", startDate: d("2026-08-11") },
    ]);
    expect(cuts.size).toBe(0);
  });

  it("picks the EARLIEST successor when a peptide has been restarted twice", () => {
    const cuts = supersededFrom([
      { id: "first", peptideId: "bpc", status: "completed", startDate: d("2026-05-01") },
      { id: "second", peptideId: "bpc", status: "completed", startDate: d("2026-06-01") },
      { id: "third", peptideId: "bpc", status: "active", startDate: d("2026-07-01") },
    ]);
    expect(cuts.get("first")).toBe("2026-06-01");
    expect(cuts.get("second")).toBe("2026-07-01");
  });

  it("ignores a protocol with no start date — nothing to order it by", () => {
    const cuts = supersededFrom([
      { id: "old", peptideId: "tesa", status: "completed", startDate: null },
      { id: "new", peptideId: "tesa", status: "active", startDate: d("2026-08-11") },
    ]);
    expect(cuts.size).toBe(0);
  });
});

describe("supersededFrom — explicit course chain beats the heuristic", () => {
  const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

  it("uses courseId when a revision records its predecessor explicitly", () => {
    // A revised into B: B carries courseId = A.id. The stop line is B's start.
    const out = supersededFrom([
      { id: "A", peptideId: "p1", status: "completed", startDate: d("2026-06-01"), courseId: null },
      { id: "B", peptideId: "p1", status: "active", startDate: d("2026-07-01"), courseId: "A" },
    ]);
    expect(out.get("A")).toBe("2026-07-01");
  });

  it("prefers the course successor over an unrelated protocol for the same peptide", () => {
    // U is a separate course for the same peptide that happens to start between
    // A and its real replacement B. The explicit chain must win.
    const out = supersededFrom([
      { id: "A", peptideId: "p1", status: "completed", startDate: d("2026-06-01"), courseId: null },
      { id: "U", peptideId: "p1", status: "completed", startDate: d("2026-06-15"), courseId: "U" },
      { id: "B", peptideId: "p1", status: "active", startDate: d("2026-07-01"), courseId: "A" },
    ]);
    expect(out.get("A")).toBe("2026-07-01");
  });

  it("falls back to the peptide heuristic when no course link exists", () => {
    // Every pre-existing protocol has courseId null — behaviour must not change.
    const out = supersededFrom([
      { id: "A", peptideId: "p1", status: "completed", startDate: d("2026-06-01"), courseId: null },
      { id: "B", peptideId: "p1", status: "active", startDate: d("2026-07-01"), courseId: null },
    ]);
    expect(out.get("A")).toBe("2026-07-01");
  });

  it("still emits nothing for an active protocol", () => {
    const out = supersededFrom([
      { id: "A", peptideId: "p1", status: "active", startDate: d("2026-06-01"), courseId: null },
      { id: "B", peptideId: "p1", status: "completed", startDate: d("2026-05-01"), courseId: null },
    ]);
    expect(out.has("A")).toBe(false);
  });

  it("chains three revisions, each stopping where the next begins", () => {
    const out = supersededFrom([
      { id: "A", peptideId: "p1", status: "completed", startDate: d("2026-06-01"), courseId: null },
      { id: "B", peptideId: "p1", status: "completed", startDate: d("2026-07-01"), courseId: "A" },
      { id: "C", peptideId: "p1", status: "active", startDate: d("2026-08-01"), courseId: "A" },
    ]);
    expect(out.get("A")).toBe("2026-07-01");
    expect(out.get("B")).toBe("2026-08-01");
  });
});
