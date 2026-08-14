import { describe, it, expect } from "vitest";
import { cycleChip } from "./label";

const d = (iso: string) => new Date(`${iso}T00:00:00`);
const ANCHOR = d("2026-07-05");

const chip = (today: string, onWeeks: number | null = 8, offWeeks: number | null = null) =>
  cycleChip({ anchor: ANCHOR, onWeeks, offWeeks, today: d(today) });

describe("cycleChip", () => {
  it("is null when there is no cycle plan", () => {
    expect(chip("2026-08-14", null)).toBeNull();
  });

  it("shows day-of-cycle and the planned stop while on", () => {
    const c = chip("2026-08-14")!;
    expect(c.text).toBe("Day 41/56 · ends 29 Aug");
    expect(c.tone).toBe("neutral");
  });

  it("turns urgent inside the last week", () => {
    expect(chip("2026-08-25")!.tone).toBe("warn");
  });

  it("marks the completed cycle", () => {
    const c = chip("2026-09-10")!;
    expect(c.text).toMatch(/complete/i);
    expect(c.tone).toBe("warn");
  });

  it("shows the restart date while off cycle", () => {
    const c = chip("2026-09-05", 8, 4)!;
    expect(c.text).toBe("Off cycle · restart 27 Sep");
    expect(c.tone).toBe("neutral");
  });

  it("numbers later cycles", () => {
    expect(chip("2026-09-27", 8, 4)!.text).toContain("Cycle 2");
  });
});
