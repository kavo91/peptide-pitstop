import { describe, it, expect } from "vitest";
import { parseSchedule, slotsInRange, slotsOn, cyclePosition } from "./entries";
import { activeStep, isDueOn, occurrencesInRange, startOfDay, dateOnlyDay, dateOnlyKey, dateOnlyValue, dateOnlyFloor } from "./schedule";
import { courseEnd } from "./shift-suggest";
import { rebaseWeek } from "./rebase";
import { materializePlannedDoses, type ProtocolInput } from "../planned/materialize";
import { protocolShouldAutoComplete } from "../planned/completion";
import { ganttRow, ganttWindow } from "../protocol-gantt";
import { bucketOf } from "../protocol-bucket";
import { dueSlotsForDay } from "../today-overrides";
import { cyclePlanEnd, cycleState } from "../cycle/state";
import { buildForecastPlan } from "../forecast-slots";

/**
 * Protocol.startDate / endDate / cycleAnchor are calendar days, stored as 00:00
 * UTC of the picked day. They must land on that same day whatever the server's
 * time zone. The normal suite is pinned to Australia/Brisbane, which cannot see
 * a zone west of UTC, so `npm run test:tz` also runs this file under
 * America/New_York and America/Santiago (vitest.tz.config.ts).
 */

const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

// Stored shape: 00:00 UTC of the picked day — what every writer persists.
const D = (key: string) => new Date(`${key}T00:00:00.000Z`);
// A server-local calendar day.
const L = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const K = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const DAILY = parseSchedule("FREQ=DAILY");

describe(`date-only protocol fields under ${zone}`, () => {
  it("runs in the zone it was asked for (no silent Brisbane fallback)", () => {
    expect(zone).toBe(process.env.TZ);
    if (process.env.TZ_MATRIX) {
      // The matrix run exists to exercise zones WEST of UTC.
      expect(new Date(2026, 0, 15).getTimezoneOffset()).toBeGreaterThan(0);
      expect(new Date(2026, 6, 15).getTimezoneOffset()).toBeGreaterThan(0);
    }
  });

  describe("dateOnlyDay", () => {
    // Instants across two years at an awkward stride, plus every 00:00Z and
    // every local midnight in that span.
    const instants: Date[] = [];
    for (let t = Date.UTC(2025, 11, 1); t < Date.UTC(2027, 1, 1); t += 7 * 3_600_000 + 37 * 60_000) instants.push(new Date(t));
    for (let d = 0; d < 430; d++) instants.push(new Date(Date.UTC(2025, 11, 1 + d)), new Date(2025, 11, 1 + d));
    const isUtcMidnight = (d: Date) => d.getTime() % 86_400_000 === 0;
    const eastOrUtc = instants.every((d) => d.getTimezoneOffset() <= 0);

    it("reads a 00:00Z value as its UTC calendar day", () => {
      for (const d of instants.filter(isUtcMidnight)) {
        expect(dateOnlyKey(d)).toBe(d.toISOString().slice(0, 10));
        expect(dateOnlyValue(dateOnlyDay(d)).getTime()).toBe(d.getTime());
      }
    });

    it("equals startOfDay for every non-00:00Z input, and is idempotent", () => {
      for (const d of instants) {
        if (!isUtcMidnight(d)) expect(dateOnlyDay(d).getTime()).toBe(startOfDay(d).getTime());
        expect(dateOnlyDay(dateOnlyDay(d)).getTime()).toBe(dateOnlyDay(d).getTime());
      }
    });

    it("equals startOfDay for EVERY input at or east of UTC (Brisbane is unchanged)", () => {
      if (!eastOrUtc) return;
      for (const d of instants) expect(dateOnlyDay(d).getTime()).toBe(startOfDay(d).getTime());
    });
  });

  it("dateOnlyFloor: both stored forms of the day pass, both forms of the day before fail", () => {
    for (let i = 0; i < 400; i++) {
      const day = L("2026-12-31");
      day.setDate(day.getDate() + i);
      const prev = new Date(day.getFullYear(), day.getMonth(), day.getDate() - 1);
      const floor = dateOnlyFloor(day).getTime();
      expect(dateOnlyValue(day).getTime()).toBeGreaterThanOrEqual(floor);
      expect(startOfDay(day).getTime()).toBeGreaterThanOrEqual(floor);
      expect(dateOnlyValue(prev).getTime()).toBeLessThan(floor);
      expect(startOfDay(prev).getTime()).toBeLessThan(floor);
      // At or east of UTC it is exactly the pre-v1.25.5 `startOfDay(day)` bound.
      if (day.getTimezoneOffset() <= 0) expect(floor).toBe(startOfDay(day).getTime());
    }
  });

  it("a local-midnight row (as the cycle actions write it) lands on its day", () => {
    // startNextCycle / endCycle write cycleAnchor/endDate as server-local midnights.
    const startDate = L("2027-10-01");
    const endDate = L("2027-10-28");
    const slots = slotsInRange(DAILY, L("2027-08-31"), L("2027-11-29"), startDate, endDate).map((s) => K(s.date));
    expect(slots[0]).toBe("2027-10-01");
    expect(slots.at(-1)).toBe("2027-10-28");
    expect(K(cyclePlanEnd(L("2027-10-01"), 4)!)).toBe("2027-10-28");
    const today = L("2027-10-28");
    const row = ganttRow(
      { id: "p", name: "p", peptideName: "p", status: "active", startDate, endDate, cycleAnchor: startDate, cycleOnWeeks: 4, cycleOffWeeks: null },
      ganttWindow(today),
      today,
    )!;
    expect(K(row.segments.at(-1)!.to)).toBe("2027-10-28");
    expect(row.onToday).toBe(true);
  });

  // Windows straddling each zone's DST changes as well as plain weeks.
  const windows: [string, string][] = [
    ["2027-09-27", "2027-10-11"], // plain
    ["2027-08-31", "2027-09-09"], // Chile DST starts 2027-09-05
    ["2027-03-31", "2027-04-07"], // Chile DST ends 2027-04-04
    ["2027-11-03", "2027-11-10"], // US DST ends 2027-11-07
    ["2027-03-11", "2027-03-18"], // US DST starts 2027-03-14
  ];

  for (const [start, end] of windows) {
    describe(`window ${start} → ${end}`, () => {
      const startDate = D(start);
      const endDate = D(end);

      it("slotsInRange: first slot on the start day, end-day slot present, none outside", () => {
        const slots = slotsInRange(DAILY, L(start), L(end), startDate, endDate).map((s) => K(s.date));
        expect(slots[0]).toBe(start);
        expect(slots.at(-1)).toBe(end);
        // A wider range must not add a slot before the start or after the end.
        const wide = slotsInRange(DAILY, L("2026-12-31"), L("2027-12-30"), startDate, endDate).map((s) => K(s.date));
        expect(wide[0]).toBe(start);
        expect(wide.at(-1)).toBe(end);
        expect(wide.every((k) => k >= start && k <= end)).toBe(true);
      });

      it("slotsOn / isDueOn / dueSlotsForDay agree on the boundary days", () => {
        expect(slotsOn(DAILY, L(start), startDate, endDate)).toHaveLength(1);
        expect(slotsOn(DAILY, L(end), startDate, endDate)).toHaveLength(1);
        expect(isDueOn({ rule: "FREQ=DAILY", date: L(start), startDate, endDate })).toBe(true);
        expect(isDueOn({ rule: "FREQ=DAILY", date: L(end), startDate, endDate })).toBe(true);
        const dayBefore = new Date(L(start).getFullYear(), L(start).getMonth(), L(start).getDate() - 1);
        const dayAfter = new Date(L(end).getFullYear(), L(end).getMonth(), L(end).getDate() + 1);
        expect(isDueOn({ rule: "FREQ=DAILY", date: dayBefore, startDate, endDate })).toBe(false);
        expect(isDueOn({ rule: "FREQ=DAILY", date: dayAfter, startDate, endDate })).toBe(false);
        expect(dueSlotsForDay("FREQ=DAILY", undefined, L(end), startDate, endDate)).toHaveLength(1);
        expect(dueSlotsForDay("FREQ=DAILY", undefined, dayBefore, startDate, endDate)).toHaveLength(0);
      });

      it("occurrencesInRange (legacy rule) spans exactly start..end", () => {
        const occ = occurrencesInRange({ rule: "FREQ=DAILY", rangeStart: L("2026-12-31"), rangeEnd: L("2027-12-30"), startDate, endDate }).map(K);
        expect(occ[0]).toBe(start);
        expect(occ.at(-1)).toBe(end);
      });
    });
  }

  it("bare WEEKLY anchors to the START weekday", () => {
    const startDate = D("2027-09-29"); // a Wednesday
    const occ = occurrencesInRange({ rule: "FREQ=WEEKLY", rangeStart: L("2027-08-31"), rangeEnd: L("2027-10-30"), startDate, endDate: null }).map(K);
    expect(occ.slice(0, 3)).toEqual(["2027-09-29", "2027-10-06", "2027-10-13"]);
    const slots = slotsInRange(parseSchedule("FREQ=WEEKLY"), L("2027-08-31"), L("2027-10-30"), startDate, null).map((s) => K(s.date));
    expect(slots.slice(0, 3)).toEqual(["2027-09-29", "2027-10-06", "2027-10-13"]);
  });

  it("interval and cycle schedules count from the start day", () => {
    const interval = parseSchedule(JSON.stringify([{ dayPattern: { kind: "interval", everyDays: 3 }, times: ["20:00"] }]));
    const iv = slotsInRange(interval, L("2027-09-19"), L("2027-10-09"), D("2027-09-28"), null).map((s) => K(s.date));
    expect(iv.slice(0, 3)).toEqual(["2027-09-28", "2027-10-01", "2027-10-04"]);

    const cycle = parseSchedule(JSON.stringify([{ dayPattern: { kind: "cycle", onDays: 5, offDays: 2 }, times: ["21:00"] }]));
    const cy = slotsInRange(cycle, L("2027-09-14"), L("2027-10-03"), D("2027-09-20"), null).map((s) => K(s.date));
    expect(cy[0]).toBe("2027-09-20");
    expect(cy).toEqual(["2027-09-20", "2027-09-21", "2027-09-22", "2027-09-23", "2027-09-24", "2027-09-27", "2027-09-28", "2027-09-29", "2027-09-30", "2027-10-01"]);
    expect(cyclePosition(D("2027-09-20"), 5, 2, L("2027-09-20"))).toEqual({ phase: "on", dayOfPhase: 1, phaseDays: 5 });
  });

  it("activeStep: the start day is step 0, not 'before start'", () => {
    const steps = [
      { stepIndex: 0, dose: "500", doseInputUnit: "mcg", durationDays: 10 },
      { stepIndex: 1, dose: "800", doseInputUnit: "mcg", durationDays: null },
    ];
    expect(activeStep({ steps, startDate: D("2027-09-30"), date: L("2027-09-30") })?.stepIndex).toBe(0);
    expect(activeStep({ steps, startDate: D("2027-09-30"), date: L("2027-10-09") })?.stepIndex).toBe(0);
    expect(activeStep({ steps, startDate: D("2027-09-30"), date: L("2027-10-10") })?.stepIndex).toBe(1);
  });

  it("cycle plan: anchor day is on-day 1 and the plan ends on anchor + weeks×7 − 1", () => {
    expect(K(cyclePlanEnd(D("2027-09-17"), 8)!)).toBe("2027-11-11");
    const s = cycleState({ anchor: D("2027-09-13"), onWeeks: 4, offWeeks: 2, today: L("2027-09-13") });
    expect(s).not.toBeNull();
    const s2 = cycleState({ anchor: D("2027-09-13"), onWeeks: 4, offWeeks: 2, today: L("2027-10-10") });
    const s3 = cycleState({ anchor: D("2027-09-13"), onWeeks: 4, offWeeks: 2, today: L("2027-10-11") });
    expect(s2?.phase).toBe("on");
    expect(s3?.phase).toBe("off");
    expect(K(courseEnd({ startDate: D("2027-09-17"), endDate: null, cycleAnchor: D("2027-09-17"), cycleOnWeeks: 8, cycleOffWeeks: null })!)).toBe("2027-11-11");
    expect(K(courseEnd({ startDate: D("2027-09-17"), endDate: D("2027-10-11"), cycleAnchor: null, cycleOnWeeks: null, cycleOffWeeks: null })!)).toBe("2027-10-11");
  });

  it("Gantt bar and protocol bucket use the picked days", () => {
    const today = L("2027-10-01");
    const row = ganttRow(
      { id: "p", name: "p", peptideName: "p", status: "active", startDate: D("2027-09-27"), endDate: D("2027-10-11"), cycleAnchor: null, cycleOnWeeks: null, cycleOffWeeks: null },
      ganttWindow(today),
      today,
    )!;
    expect(row.segments.map((s) => `${K(s.from)}..${K(s.to)}`)).toEqual(["2027-09-27..2027-10-11"]);
    // ISO strings, as a client component receives them.
    const fromStrings = ganttRow(
      { id: "p", name: "p", peptideName: "p", status: "active", startDate: D("2027-09-27").toISOString(), endDate: D("2027-10-11").toISOString(), cycleAnchor: null, cycleOnWeeks: null, cycleOffWeeks: null },
      ganttWindow(today),
      today,
    )!;
    expect(fromStrings.segments.map((s) => `${K(s.from)}..${K(s.to)}`)).toEqual(["2027-09-27..2027-10-11"]);

    expect(bucketOf({ status: "active", startDate: D("2027-10-01"), endDate: null }, L("2027-10-01"))).toBe("active");
    expect(bucketOf({ status: "active", startDate: D("2027-10-02"), endDate: null }, L("2027-10-01"))).toBe("scheduled");
    expect(bucketOf({ status: "active", startDate: D("2027-08-31"), endDate: D("2027-10-01") }, L("2027-10-01"))).toBe("active");
    expect(bucketOf({ status: "active", startDate: D("2027-08-31"), endDate: D("2027-09-30") }, L("2027-10-01"))).toBe("ended");
  });

  it("auto-complete waits for the end day's slot", () => {
    const p = { id: "p", status: "active", scheduleRule: "FREQ=DAILY", startDate: D("2027-09-27"), endDate: D("2027-10-11"), deliveredLogs: [] };
    expect(protocolShouldAutoComplete(p, L("2027-10-11"))).toBe(false);
    expect(protocolShouldAutoComplete(p, L("2027-10-12"))).toBe(true);
  });

  it("rebase never shifts a dose past the end day, but keeps the end day itself", () => {
    // MO/WE/FR week from Sun 2027-10-03; Mon dose taken Tue → WE/FR shift to TH 10-07 / SA 10-09.
    const shifted = rebaseWeek({
      rebaseMode: "fixed_anchor", freq: "WEEKLY", weekStart: L("2027-10-03"), plannedDays: ["MO", "WE", "FR"],
      actual: { plannedDate: L("2027-10-04"), actualDate: L("2027-10-05") }, today: L("2027-10-05"), endDate: D("2027-10-09"),
    }).map(K);
    expect(shifted).toContain("2027-10-09");
    const clipped = rebaseWeek({
      rebaseMode: "fixed_anchor", freq: "WEEKLY", weekStart: L("2027-10-03"), plannedDays: ["MO", "WE", "FR"],
      actual: { plannedDate: L("2027-10-04"), actualDate: L("2027-10-05") }, today: L("2027-10-05"), endDate: D("2027-10-08"),
    }).map(K);
    expect(clipped).not.toContain("2027-10-09");
  });

  it("forecast ends on the end day", () => {
    const fc = buildForecastPlan({
      protocol: {
        doseBasis: null, targetDose: "100", doseInputUnit: "mcg", scheduleRule: "FREQ=DAILY", rebaseMode: "rolling",
        startDate: D("2027-09-27"), endDate: D("2027-10-11"), adherenceWindowMin: null, steps: [],
        cycleAnchor: null, cycleOnWeeks: null, cycleOffWeeks: null,
      },
      deliveredLogs: [],
      now: new Date(2027, 9, 1, 12),
    });
    expect(K(fc.courseEndDate!)).toBe("2027-10-11");
    expect(K(fc.slots.at(-1)!.date)).toBe("2027-10-11");
  });

  describe("planned-dose materialisation", () => {
    const proto: ProtocolInput = {
      id: "p", userId: "u", status: "active", scheduleRule: "FREQ=DAILY", targetDose: "100", doseInputUnit: "mcg",
      doseBasis: null, rebaseMode: "rolling", adherenceWindowMin: null, startDate: D("2027-09-27"), endDate: D("2027-10-11"),
      steps: [], scheduleType: "fixed_times", deliveredLogs: [],
    };

    it("upserts start on the start day and include the end day", () => {
      const res = materializePlannedDoses({ protocols: [proto], horizonStart: L("2027-09-19"), horizonEnd: L("2027-10-19"), existing: [], today: L("2027-09-19") });
      const days = res.upserts.map((u) => K(u.scheduledAt));
      expect(days[0]).toBe("2027-09-27");
      expect(days.at(-1)).toBe("2027-10-11");
      expect(days.every((k) => k >= "2027-09-27" && k <= "2027-10-11")).toBe(true);
    });

    it("reconciliation deletes rows outside the window and keeps the boundary days", () => {
      const row = (id: string, key: string) => {
        const [y, m, d] = key.split("-").map(Number);
        return { id, protocolId: "p", scheduledAt: new Date(y, m - 1, d, 8), status: "planned", hasDoseLog: false };
      };
      const res = materializePlannedDoses({
        protocols: [proto], horizonStart: L("2027-09-27"), horizonEnd: L("2027-10-19"),
        existing: [row("pre", "2027-09-26"), row("first", "2027-09-27"), row("last", "2027-10-11"), row("post", "2027-10-12")],
        today: L("2027-09-27"),
      });
      expect([...res.deletions].sort()).toEqual(["post", "pre"]);
    });
  });
});
