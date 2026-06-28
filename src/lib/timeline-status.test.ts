import { describe, it, expect } from "vitest";
import {
  buildTimelineEntries,
  clipSlotsToRange,
  STATUS_LABEL,
  STATUS_DESCRIPTION,
  STATUS_DOT_CLASS,
  STATUS_CHIP_CLASS,
  LEGEND_ORDER,
  type ResolvedOcc,
} from "./timeline-status";
import type { DoseStatus, LoggedDose } from "./doses-timeline-core";

const ALL_STATUSES: DoseStatus[] = ["taken_ontime", "taken_offschedule", "taken_rebased", "planned", "missed"];

const occ = (slots: ResolvedOcc["slots"]): ResolvedOcc => ({
  protocolId: "p1", peptideId: "pep1", peptideName: "Reta", slots,
});

describe("buildTimelineEntries", () => {
  it("maps resolver status → DoseStatus and carries per-slot dose label + phase", () => {
    const entries = buildTimelineEntries({
      todayKey: "2026-06-19",
      occurrences: [occ([
        { date: "2026-06-15", time: null, status: "taken", doseLabel: "4 mg", phaseIndex: 0, doseLogId: "L1" },
        { date: "2026-06-18", time: null, status: "missed", doseLabel: "4 mg", phaseIndex: 0 },
        { date: "2026-06-22", time: null, status: "projected", doseLabel: "6 mg", phaseIndex: 1 },
      ])],
      logs: [],
    });
    expect(entries.map((e) => e.status)).toEqual(["taken_ontime", "missed", "planned"]);
    expect(entries[2].doseLabel).toBe("6 mg");
    expect(entries[2].phaseIndex).toBe(1);
    expect(entries[0].doseLogId).toBe("L1");
  });
  it("maps a matched rebased slot → taken_rebased (distinct shifted colour)", () => {
    const entries = buildTimelineEntries({
      todayKey: "2026-06-20",
      occurrences: [occ([
        { date: "2026-06-14", time: null, status: "taken", doseLabel: "0.5 mg", phaseIndex: null, doseLogId: "L1", rebased: true },
        { date: "2026-06-16", time: null, status: "taken", doseLabel: "0.5 mg", phaseIndex: null, doseLogId: "L2", rebased: false },
      ])],
      logs: [],
    });
    expect(entries.map((e) => e.status)).toEqual(["taken_rebased", "taken_ontime"]);
  });
  it("emits taken_offschedule for a log matching no resolved slot", () => {
    const logs: LoggedDose[] = [{ protocolId: "p1", peptideId: "pep1", peptideName: "Reta", doseLabel: "200 mcg", dateKey: "2026-06-16", doseLogId: "L9" }];
    const entries = buildTimelineEntries({ todayKey: "2026-06-19", occurrences: [occ([])], logs });
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe("taken_offschedule");
  });
});

describe("status presentation maps", () => {
  const maps = { STATUS_LABEL, STATUS_DESCRIPTION, STATUS_DOT_CLASS, STATUS_CHIP_CLASS } as const;
  for (const [name, map] of Object.entries(maps)) {
    it(`${name} has every DoseStatus key exactly once`, () => {
      expect(Object.keys(map).sort()).toEqual([...ALL_STATUSES].sort());
      for (const s of ALL_STATUSES) expect(typeof map[s]).toBe("string");
    });
  }

  it("LEGEND_ORDER contains every DoseStatus exactly once", () => {
    expect([...LEGEND_ORDER].sort()).toEqual([...ALL_STATUSES].sort());
    expect(new Set(LEGEND_ORDER).size).toBe(LEGEND_ORDER.length);
  });

  it("labels Shifted vs Off-schedule clearly", () => {
    expect(STATUS_LABEL.taken_rebased).toBe("Shifted");
    expect(STATUS_LABEL.taken_offschedule).toBe("Off-schedule");
    expect(STATUS_LABEL.taken_ontime).toBe("Taken");
    expect(STATUS_LABEL.planned).toBe("Planned");
    expect(STATUS_LABEL.missed).toBe("Missed");
  });

  it("Shifted description explains the schedule moved / snaps back", () => {
    expect(STATUS_DESCRIPTION.taken_rebased.toLowerCase()).toMatch(/moved|snaps/);
  });

  it("Off-schedule description explains schedule unchanged / dosed off the planned day", () => {
    const d = STATUS_DESCRIPTION.taken_offschedule.toLowerCase();
    expect(d).toContain("schedule");
    expect(d).toMatch(/unchanged|off/);
  });

  it("dot classes are copied verbatim from the component maps (colour-stable)", () => {
    expect(STATUS_DOT_CLASS.taken_ontime).toBe("bg-ok");
    expect(STATUS_DOT_CLASS.taken_offschedule).toBe("bg-warn");
    expect(STATUS_DOT_CLASS.taken_rebased).toBe("bg-accent2");
    expect(STATUS_DOT_CLASS.planned).toBe("border-2 border-accent");
    expect(STATUS_DOT_CLASS.missed).toBe("bg-danger");
  });

  it("chip classes are copied verbatim from DayDetail", () => {
    expect(STATUS_CHIP_CLASS.taken_ontime).toBe("bg-ok/10 text-ok");
    expect(STATUS_CHIP_CLASS.taken_offschedule).toBe("bg-warn/10 text-warn");
    expect(STATUS_CHIP_CLASS.taken_rebased).toBe("bg-accent2/10 text-accent2Strong");
    expect(STATUS_CHIP_CLASS.planned).toBe("bg-accent/10 text-accentStrong");
    expect(STATUS_CHIP_CLASS.missed).toBe("bg-danger/10 text-danger");
  });
});

describe("clipSlotsToRange", () => {
  const slot = (date: string): ResolvedOcc["slots"][number] => ({
    date, time: null, status: "projected", doseLabel: "4 mg", phaseIndex: 0,
  });
  it("drops slots outside [startKey, endKey] (the expanded-range buffer)", () => {
    const slots = ["2026-06-14", "2026-06-15", "2026-06-30", "2026-07-15"].map(slot);
    const out = clipSlotsToRange(slots, "2026-06-15", "2026-06-30");
    expect(out.map((s) => s.date)).toEqual(["2026-06-15", "2026-06-30"]); // boundaries inclusive, buffer dropped
  });
});
