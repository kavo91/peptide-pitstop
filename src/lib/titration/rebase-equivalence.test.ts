import { describe, it, expect } from "vitest";
import { rebaseWeek } from "../schedule/rebase";
import { reconstructRebasedSlots } from "./rebase-slots";

const d = (s: string) => new Date(s + "T00:00:00");
// Local-date formatter — avoids the UTC off-by-one `.toISOString()` introduces
// for local-midnight dates in positive timezones (matches schedule/rebase.test.ts).
const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;

describe("resolver delay handling == rebaseWeek", () => {
  it("produces the same shifted dates rebaseWeek would", () => {
    // Sunday week origin (rebaseWeek's WEEKDAYS index-0 convention; the resolver's
    // weekKey floors any date to its Sunday). Mon=06-15, Thu=06-18.
    const weekStart = d("2026-06-14");
    const shifted = rebaseWeek({
      rebaseMode: "fixed_anchor", freq: "WEEKLY", weekStart, plannedDays: ["MO", "TH"],
      actual: { plannedDate: d("2026-06-15"), actualDate: d("2026-06-16") }, today: d("2026-06-16"),
    }).map(iso);

    const recon = reconstructRebasedSlots({
      weekSlots: [{ date: d("2026-06-15"), time: null }, { date: d("2026-06-18"), time: null }],
      weekStart, plannedDays: ["MO", "TH"], rebaseMode: "fixed_anchor", freq: "WEEKLY",
      delivered: [{ id: "a", takenAt: d("2026-06-16") }],
    }).map((s) => iso(s.date));

    for (const day of shifted) expect(recon).toContain(day);
  });
});
