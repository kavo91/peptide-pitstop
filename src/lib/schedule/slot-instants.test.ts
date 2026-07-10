import { describe, it, expect } from "vitest";
import { slotInstantsOn } from "./slot-instants";

// Mirrors the Today card's client-side composition: `viewKey + "T" + time + ":00"`,
// parsed in the runtime's local TZ. Server and card must agree on this construction.
const local = (day: string, time: string) => new Date(`${day}T${time}:00`);

describe("slotInstantsOn", () => {
  // 2026-07-11 is a Saturday.
  const day = new Date("2026-07-11T09:30:00");

  it("returns the local instant of a timed daily slot", () => {
    const rule = JSON.stringify([{ dayPattern: { kind: "daily" }, times: ["06:00"] }]);
    expect(slotInstantsOn(rule, day).map((d) => d.getTime())).toEqual([
      local("2026-07-11", "06:00").getTime(),
    ]);
  });

  it("returns [] for an untimed schedule", () => {
    const rule = JSON.stringify([{ dayPattern: { kind: "daily" }, times: [] }]);
    expect(slotInstantsOn(rule, day)).toEqual([]);
  });

  it("returns [] when the day-pattern is not due that day", () => {
    const rule = JSON.stringify([{ dayPattern: { kind: "weekly", byDays: ["MO"] }, times: ["06:00"] }]);
    expect(slotInstantsOn(rule, day)).toEqual([]);
  });

  it("returns every timed slot on a multi-time day, ascending", () => {
    const rule = JSON.stringify([{ dayPattern: { kind: "daily" }, times: ["20:00", "06:00"] }]);
    expect(slotInstantsOn(rule, day).map((d) => d.getTime())).toEqual([
      local("2026-07-11", "06:00").getTime(),
      local("2026-07-11", "20:00").getTime(),
    ]);
  });

  it("applies the start-date window (before start → no instants)", () => {
    const rule = JSON.stringify([{ dayPattern: { kind: "daily" }, times: ["06:00"] }]);
    expect(slotInstantsOn(rule, day, new Date("2026-08-01T00:00:00"))).toEqual([]);
  });

  it("returns [] for null or unparseable rules", () => {
    expect(slotInstantsOn(null, day)).toEqual([]);
    expect(slotInstantsOn(undefined, day)).toEqual([]);
    expect(slotInstantsOn("FREQ=DAILY", day)).toEqual([]); // legacy rules are untimed
  });
});
