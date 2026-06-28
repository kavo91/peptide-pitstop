import { describe, it, expect } from "vitest";
import { rebaseWeek } from "./rebase";

const d = (s: string) => new Date(s + "T09:00:00");
const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;

// Week of Sun 2026-06-14 .. Sat 2026-06-20. M/W/F = Mon15/Wed17/Fri19.
describe("rebaseWeek (snap-back)", () => {
  it("Tα1 taken Sunday instead of Monday → upcoming shifts to Tue/Thu", () => {
    const out = rebaseWeek({
      rebaseMode: "fixed_anchor", freq: "WEEKLY",
      weekStart: d("2026-06-14"), plannedDays: ["MO", "WE", "FR"],
      actual: { plannedDate: d("2026-06-15"), actualDate: d("2026-06-14") },
      today: d("2026-06-14"),
    }).map(iso);
    expect(out).toEqual(["2026-06-16", "2026-06-18"]);
  });
  it("miss Monday, take Tuesday → upcoming shifts to Thu/Sat", () => {
    const out = rebaseWeek({
      rebaseMode: "fixed_anchor", freq: "WEEKLY",
      weekStart: d("2026-06-14"), plannedDays: ["MO", "WE", "FR"],
      actual: { plannedDate: d("2026-06-15"), actualDate: d("2026-06-16") },
      today: d("2026-06-16"),
    }).map(iso);
    expect(out).toEqual(["2026-06-18", "2026-06-20"]);
  });
  it("daily → no rebase", () => {
    expect(rebaseWeek({
      rebaseMode: "fixed_anchor", freq: "DAILY",
      weekStart: d("2026-06-14"), plannedDays: [],
      actual: { plannedDate: d("2026-06-15"), actualDate: d("2026-06-14") },
      today: d("2026-06-14"),
    })).toEqual([]);
  });
  it("on-day dose (delta 0) → no shift", () => {
    expect(rebaseWeek({
      rebaseMode: "fixed_anchor", freq: "WEEKLY",
      weekStart: d("2026-06-14"), plannedDays: ["MO", "WE", "FR"],
      actual: { plannedDate: d("2026-06-15"), actualDate: d("2026-06-15") },
      today: d("2026-06-15"),
    })).toEqual([]);
  });
  it("drops a shifted occurrence that would spill past Saturday", () => {
    const out = rebaseWeek({
      rebaseMode: "fixed_anchor", freq: "WEEKLY",
      weekStart: d("2026-06-14"), plannedDays: ["MO", "WE", "FR"],
      actual: { plannedDate: d("2026-06-19"), actualDate: d("2026-06-18") },
      today: d("2026-06-18"),
    }).map(iso);
    expect(out).toEqual([]);
  });
});
