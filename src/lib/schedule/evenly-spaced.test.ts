import { describe, it, expect } from "vitest";
import {
  evenlySpacedDays,
  isWithinDoseWindow,
  DEFAULT_DOSE_TIME,
  slotsInRange,
  scheduleSummary,
} from "./entries";
import { dosesPerWeek } from "./frequency";
import type { Schedule } from "./entries";

// Local-midnight constructor mirroring entries.test.ts (avoids TZ drift).
const d = (s: string) => new Date(s + "T09:00:00");

describe("evenlySpacedDays", () => {
  it("(2) → Mon/Thu", () => {
    expect(evenlySpacedDays(2)).toEqual(["MO", "TH"]);
  });
  it("(3) → Mon/Wed/Fri", () => {
    expect(evenlySpacedDays(3)).toEqual(["MO", "WE", "FR"]);
  });
  it("(2,'TU') → Tue/Fri (anchored)", () => {
    expect(evenlySpacedDays(2, "TU")).toEqual(["TU", "FR"]);
  });
  it("(1) → Mon", () => {
    expect(evenlySpacedDays(1)).toEqual(["MO"]);
  });
  it("clamps <1 → []", () => {
    expect(evenlySpacedDays(0)).toEqual([]);
    expect(evenlySpacedDays(-3)).toEqual([]);
  });
  it(">=7 → all 7 in DAY_ORDER", () => {
    expect(evenlySpacedDays(7)).toEqual(["MO", "TU", "WE", "TH", "FR", "SA", "SU"]);
    expect(evenlySpacedDays(10)).toEqual(["MO", "TU", "WE", "TH", "FR", "SA", "SU"]);
  });
  it("(4) → Mon/Wed/Fri/Sun (maximally even, gaps 2,2,2,1)", () => {
    expect(evenlySpacedDays(4)).toEqual(["MO", "WE", "FR", "SU"]);
  });
  it("(5) → Mon/Tue/Thu/Fri/Sun (maximally even, no three-in-a-row)", () => {
    expect(evenlySpacedDays(5)).toEqual(["MO", "TU", "TH", "FR", "SU"]);
  });
  it("(6) → Mon..Sat (one gap of 2)", () => {
    expect(evenlySpacedDays(6)).toEqual(["MO", "TU", "WE", "TH", "FR", "SA"]);
  });
  it("always returns days sorted by DAY_ORDER (Mon-first)", () => {
    const order = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
    for (let n = 1; n <= 7; n++) {
      const days = evenlySpacedDays(n);
      const idxs = days.map((x) => order.indexOf(x));
      const sorted = [...idxs].sort((a, b) => a - b);
      expect(idxs).toEqual(sorted);
    }
  });
});

describe("isWithinDoseWindow", () => {
  it("08:00 → true", () => {
    expect(isWithinDoseWindow("08:00")).toBe(true);
  });
  it("boundaries 06:00 and 20:00 → true (inclusive)", () => {
    expect(isWithinDoseWindow("06:00")).toBe(true);
    expect(isWithinDoseWindow("20:00")).toBe(true);
  });
  it("just outside → false", () => {
    expect(isWithinDoseWindow("05:59")).toBe(false);
    expect(isWithinDoseWindow("20:01")).toBe(false);
  });
  it("malformed → false", () => {
    expect(isWithinDoseWindow("")).toBe(false);
    expect(isWithinDoseWindow("nope")).toBe(false);
    expect(isWithinDoseWindow("8")).toBe(false);
    expect(isWithinDoseWindow("25:00")).toBe(false);
    expect(isWithinDoseWindow("08:99")).toBe(false);
    expect(isWithinDoseWindow("08:0")).toBe(false);
  });
  it("DEFAULT_DOSE_TIME is within the window", () => {
    expect(DEFAULT_DOSE_TIME).toBe("08:00");
    expect(isWithinDoseWindow(DEFAULT_DOSE_TIME)).toBe(true);
  });
});

describe("N×/week preset round-trip (no engine change)", () => {
  it("evenlySpacedDays(2) @ 08:00 yields 4 slots over 14 days on Mon/Thu", () => {
    const schedule: Schedule = [
      { dayPattern: { kind: "weekly", byDays: evenlySpacedDays(2) }, times: [DEFAULT_DOSE_TIME] },
    ];
    // 2026-06-15 is a Monday. 14-day inclusive range → 2 Mondays + 2 Thursdays.
    const slots = slotsInRange(schedule, d("2026-06-15"), d("2026-06-28"));
    expect(slots.length).toBe(4);
    for (const s of slots) expect(s.time).toBe("08:00");
    const weekdays = slots.map((s) => s.date.getDay()); // 1=Mon, 4=Thu
    expect(weekdays).toEqual([1, 4, 1, 4]);
  });
  it("dosesPerWeek round-trips to 2", () => {
    const schedule: Schedule = [
      { dayPattern: { kind: "weekly", byDays: evenlySpacedDays(2) }, times: [DEFAULT_DOSE_TIME] },
    ];
    expect(dosesPerWeek(JSON.stringify(schedule))).toBe(2);
  });
  it("scheduleSummary reads sensibly (Mon, Thu · 08:00)", () => {
    const schedule: Schedule = [
      { dayPattern: { kind: "weekly", byDays: evenlySpacedDays(2) }, times: [DEFAULT_DOSE_TIME] },
    ];
    expect(scheduleSummary(schedule)).toBe("Mon, Thu · 08:00");
  });
});
