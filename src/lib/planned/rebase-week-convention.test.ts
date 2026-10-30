import { describe, it, expect } from "vitest";
import { materializePlannedDoses, type PlannedDoseInput, type ProtocolInput } from "./materialize";
import { classifyOverrideDays, dueSlotsForDay, dayKey, keptGridSlots } from "../today-overrides";
import { resolveTitration } from "../titration/resolve";
import { buildResolveInput } from "../titration/from-protocol";
import { rebaseWeekStart, addDays } from "../schedule/schedule";
import { todayOverrideWeekStart, buildTodayOverrideWhere } from "../today";

// Regression: a WE/FR/SU fixed_anchor protocol dosed on Sunday and then on
// Tuesday (one day early). confirmRebase works in a SUNDAY-start week: it
// deletes the Wed + Fri rows and writes one shifted row on Thursday. The
// materializer and Today used to bucket by a MONDAY-start week, which also
// holds next Sunday's routine on-grid row — so the week read as an
// on-grid/off-grid "mix", the shift was treated as stale, the cron re-created
// Wed + Fri, and Today showed Wednesday as due while the week view (resolver,
// Sunday-start) showed the shift.

const d = (s: string): Date => new Date(s + "T00:00:00");
const RULE = JSON.stringify([{ dayPattern: { kind: "weekly", byDays: ["WE", "FR", "SU"] }, times: ["08:00"] }]);

const proto: ProtocolInput = {
  id: "p1",
  userId: "u",
  status: "active",
  scheduleRule: RULE,
  targetDose: "1",
  doseInputUnit: "mg",
  doseBasis: "per_injection",
  rebaseMode: "fixed_anchor",
  adherenceWindowMin: 120,
  startDate: d("2030-02-17"),
  endDate: d("2030-05-10"),
  steps: [],
  scheduleType: "fixed_times",
  deliveredLogs: [
    { id: "sun", takenAt: new Date("2030-03-03T08:00:00"), localDay: "2030-03-03" },
    { id: "tue", takenAt: new Date("2030-03-05T08:00:00"), localDay: "2030-03-05" },
  ],
};

// The rows confirmRebase leaves behind: the shifted Thursday, plus next
// Sunday's routine grid row (outside confirmRebase's Sunday-start week).
const rows: PlannedDoseInput[] = [
  { id: "sun-taken", protocolId: "p1", scheduledAt: d("2030-03-03"), status: "taken", hasDoseLog: true },
  { id: "thu-shift", protocolId: "p1", scheduledAt: d("2030-03-07"), status: "planned", hasDoseLog: false },
  { id: "sun-grid", protocolId: "p1", scheduledAt: d("2030-03-10"), status: "planned", hasDoseLog: false },
];

describe("rebase week convention (Sunday-start, matching confirmRebase)", () => {
  it("rebaseWeekStart puts Wednesday and Saturday in the week of the Sunday before, and the next Sunday in the next week", () => {
    expect(dayKey(rebaseWeekStart(d("2030-03-06")))).toBe("2030-03-03");
    expect(dayKey(rebaseWeekStart(d("2030-03-09")))).toBe("2030-03-03");
    expect(dayKey(rebaseWeekStart(d("2030-03-10")))).toBe("2030-03-10");
  });

  it("the cron does not re-create the Wed/Fri grid rows the shift removed", () => {
    const today = d("2030-03-05");
    const { upserts } = materializePlannedDoses({
      protocols: [proto],
      horizonStart: today,
      horizonEnd: addDays(today, 13),
      existing: rows,
      today,
    });
    const keys = upserts.map((u) => dayKey(u.scheduledAt));
    expect(keys).not.toContain("2030-03-06");
    expect(keys).not.toContain("2030-03-08");
    // Next week's grid is untouched.
    expect(keys).toContain("2030-03-10");
    expect(keys).toContain("2030-03-13");
  });

  it("Today reads the shift: Wednesday is not due, Thursday is", () => {
    const today = d("2030-03-06");
    const ws = todayOverrideWeekStart(today);
    const weekRows = rows.filter((r) => r.status === "planned" && r.scheduledAt >= ws && r.scheduledAt < addDays(ws, 7));
    const overrides = classifyOverrideDays([proto], weekRows).get("p1");
    expect(overrides ? [...overrides] : []).toEqual(["2030-03-07"]);
    expect(dueSlotsForDay(RULE, overrides, d("2030-03-06"), proto.startDate, proto.endDate)).toEqual([]);
    expect(dueSlotsForDay(RULE, overrides, d("2030-03-07"), proto.startDate, proto.endDate)).toHaveLength(1);
  });
});

// Regression: the same WE/FR/SU protocol, a later week. A Tuesday dose and a
// confirmed shift left one row, Thursday. Logging Thursday turned
// that row "taken", so no "planned" off-grid row was left: Today fell back to the
// grid and showed Friday as due, and the cron re-created Friday, which then aged
// into a false "missed". The week view (resolver) stayed right, it reads the logs.
describe("a confirmed shift outlives its last shifted dose", () => {
  const onTue = { id: "tue", takenAt: new Date("2030-03-19T08:00:00"), localDay: "2030-03-19" };
  const onThu = { id: "thu", takenAt: new Date("2030-03-21T08:00:00"), localDay: "2030-03-21" };
  const wk = { ...proto, deliveredLogs: [onTue, onThu] };
  const sunMissed: PlannedDoseInput = { id: "sun", protocolId: "p1", scheduledAt: d("2030-03-17"), status: "missed", hasDoseLog: false };
  const thu = (status: string, hasDoseLog: boolean): PlannedDoseInput => ({ id: "thu", protocolId: "p1", scheduledAt: d("2030-03-21"), status, hasDoseLog });
  const cronKeys = (p: ProtocolInput, existing: PlannedDoseInput[], today: Date) =>
    materializePlannedDoses({ protocols: [p], horizonStart: today, horizonEnd: addDays(today, 13), existing, today }).upserts.map((u) => dayKey(u.scheduledAt));

  it("Today: once the last shifted dose is taken, the grid Friday stays gone", () => {
    const overrides = classifyOverrideDays([wk], [sunMissed, thu("taken", true)]).get("p1");
    expect(dueSlotsForDay(RULE, overrides, d("2030-03-22"), wk.startDate, wk.endDate)).toEqual([]);
  });

  it("Today: the shifted day itself stays on Today after it is logged", () => {
    const overrides = classifyOverrideDays([wk], [sunMissed, thu("taken", true)]).get("p1");
    expect(dueSlotsForDay(RULE, overrides, d("2030-03-21"), wk.startDate, wk.endDate)).toHaveLength(1);
  });

  it("the cron does not re-create Friday after the last shifted dose is taken", () => {
    const keys = cronKeys(wk, [sunMissed, thu("taken", true)], d("2030-03-21"));
    expect(keys).not.toContain("2030-03-22");
    expect(keys).toContain("2030-03-24"); // next week's grid is untouched
  });

  it("a shifted day that was missed keeps the week shifted, in Today and the cron", () => {
    const rows = [sunMissed, thu("missed", false)];
    const overrides = classifyOverrideDays([wk], rows).get("p1");
    expect(dueSlotsForDay(RULE, overrides, d("2030-03-22"), wk.startDate, wk.endDate)).toEqual([]);
    expect(cronKeys(wk, rows, d("2030-03-22"))).not.toContain("2030-03-22");
  });

  it("an on-grid taken or missed row is history, never a reason to drop the shift", () => {
    const rows = [{ ...sunMissed, status: "taken", hasDoseLog: true }, thu("planned", false)];
    expect([...classifyOverrideDays([wk], rows).get("p1")!]).toEqual(["2030-03-21"]);
  });

  it("an on-grid PLANNED row still wins: that week's grid is live", () => {
    const fri: PlannedDoseInput = { id: "fri", protocolId: "p1", scheduledAt: d("2030-03-22"), status: "planned", hasDoseLog: false };
    const rows = [thu("taken", true), fri];
    expect(classifyOverrideDays([wk], rows).get("p1")).toBeUndefined();
    expect(cronKeys(wk, rows, d("2030-03-21"))).toContain("2030-03-22");
  });

  it("past rows do not mark a week shifted for a rolling protocol", () => {
    const rolling = { ...wk, rebaseMode: "rolling" };
    expect(cronKeys(rolling, [thu("taken", true)], d("2030-03-21"))).toContain("2030-03-22");
  });

  it("past rows do not mark a week shifted for an interval protocol", () => {
    const rule = JSON.stringify([{ dayPattern: { kind: "interval", everyDays: 3 }, times: ["08:00"] }]);
    const every3 = { ...wk, scheduleRule: rule, startDate: d("2030-02-21"), deliveredLogs: [] };
    const taken = { id: "off", protocolId: "p1", scheduledAt: d("2030-03-18"), status: "taken", hasDoseLog: true };
    expect(classifyOverrideDays([every3], [taken]).get("p1")).toBeUndefined();
    expect(cronKeys(every3, [taken], d("2030-03-18")).filter((k) => k < "2030-03-24")).toContain("2030-03-20");
  });

  // /today also opens past days, so the shift must not swallow the grid days it
  // left alone: the same day-only resolve that getTodayDoses runs decides them.
  const keptOn = (day: string) => {
    const dayD = d(day);
    const { slots } = resolveTitration(buildResolveInput({ protocol: wk, deliveredLogs: wk.deliveredLogs, range: { start: dayD, end: dayD }, now: d("2030-03-22") }));
    return keptGridSlots(slots.filter((s) => dayKey(s.date) === day));
  };

  it("a grid day from before the shift stays on Today when opened later", () => {
    expect(keptOn("2030-03-17")).toEqual([{ time: "08:00" }]);
  });

  it("the grid days the shift moved are not kept", () => {
    expect(keptOn("2030-03-20")).toEqual([]);
    expect(keptOn("2030-03-22")).toEqual([]);
  });

  it("a missed shifted day marks the week, but is not offered as due", () => {
    const overrides = classifyOverrideDays([wk], [thu("missed", false)]).get("p1");
    expect(overrides ? [...overrides] : null).toEqual([]);
  });

  it("Today reads every row of the week, not only the planned ones", () => {
    const ws = d("2030-03-17");
    const where = buildTodayOverrideWhere("u", ws);
    expect(where).toEqual({ userId: "u", scheduledAt: { gte: ws, lt: addDays(ws, 7) } });
  });
});
