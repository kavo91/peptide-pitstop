import { describe, it, expect } from "vitest";
import { materializePlannedDoses, type PlannedDoseInput, type ProtocolInput } from "./materialize";
import { classifyOverrideDays, dueSlotsForDay, dayKey } from "../today-overrides";
import { rebaseWeekStart, addDays } from "../schedule/schedule";
import { todayOverrideWeekStart } from "../today";

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
