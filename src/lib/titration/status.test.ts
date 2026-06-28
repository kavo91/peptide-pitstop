import { describe, it, expect } from "vitest";
import { slotStatus } from "./status";

const d = (s: string) => new Date(s);

describe("slotStatus", () => {
  const base = { now: d("2026-06-19T12:00:00"), adherenceWindowMin: 120, nextSlotStart: d("2026-06-22T08:00:00") };
  it("future slot → projected", () => {
    expect(slotStatus({ ...base, slotStart: d("2026-06-25T08:00:00"), matchedLog: null })).toBe("projected");
  });
  it("past slot with matched log → taken", () => {
    expect(slotStatus({ ...base, slotStart: d("2026-06-18T08:00:00"), matchedLog: { id: "x", takenAt: d("2026-06-18T08:30:00") } })).toBe("taken");
  });
  it("past slot, no log, next slot not yet passed → pending", () => {
    expect(slotStatus({ ...base, slotStart: d("2026-06-18T08:00:00"), matchedLog: null })).toBe("pending");
  });
  it("past slot, no log, next slot already passed → missed", () => {
    expect(slotStatus({ ...base, now: d("2026-06-23T09:00:00"), slotStart: d("2026-06-18T08:00:00"), matchedLog: null })).toBe("missed");
  });
});
