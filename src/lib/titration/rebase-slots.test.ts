import { describe, it, expect } from "vitest";
import { reconstructRebasedSlots } from "./rebase-slots";
import type { DatedSlot } from "../schedule/entries";

const d = (s: string) => new Date(s + "T00:00:00");
// Local-date formatter (matches schedule/rebase.test.ts) — avoids UTC off-by-one
// that `.toISOString()` introduces for local-midnight dates in +ve timezones.
const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
// Standing Mon/Thu slots in the week of Sun 2026-06-14 .. Sat 2026-06-20.
// weekStart is the Sunday origin (matches rebaseWeek's WEEKDAYS index-0 convention
// and the resolver's weekKey, which floors any date to its Sunday).
const weekSlots: DatedSlot[] = [
  { date: d("2026-06-15"), time: null }, // Mon
  { date: d("2026-06-18"), time: null }, // Thu
];

describe("reconstructRebasedSlots", () => {
  it("fixed_anchor: Mon dose taken Tue (+1) slides Thu → Fri", () => {
    const out = reconstructRebasedSlots({
      weekSlots,
      weekStart: d("2026-06-14"),
      plannedDays: ["MO", "TH"],
      rebaseMode: "fixed_anchor",
      freq: "WEEKLY",
      delivered: [{ id: "a", takenAt: d("2026-06-16") }], // Tue
    });
    const dates = out.map((s) => iso(s.date));
    expect(dates).toContain("2026-06-19"); // Thu → Fri
    expect(dates).not.toContain("2026-06-18");
  });
  it("rolling: no shift (returns input week unchanged)", () => {
    const out = reconstructRebasedSlots({
      weekSlots, weekStart: d("2026-06-14"), plannedDays: ["MO", "TH"],
      rebaseMode: "rolling", freq: "WEEKLY",
      delivered: [{ id: "a", takenAt: d("2026-06-16") }],
    });
    expect(out.map((s) => iso(s.date))).toEqual(["2026-06-15", "2026-06-18"]);
  });
  it("on-grid dose: no shift", () => {
    const out = reconstructRebasedSlots({
      weekSlots, weekStart: d("2026-06-14"), plannedDays: ["MO", "TH"],
      rebaseMode: "fixed_anchor", freq: "WEEKLY",
      delivered: [{ id: "a", takenAt: d("2026-06-15") }],
    });
    expect(out.map((s) => iso(s.date))).toEqual(["2026-06-15", "2026-06-18"]);
  });
  it("re-anchor: satisfied slot moves to the actual dose day + flags rebased", () => {
    const out = reconstructRebasedSlots({
      weekSlots, weekStart: d("2026-06-14"), plannedDays: ["MO", "TH"],
      rebaseMode: "fixed_anchor", freq: "WEEKLY",
      delivered: [{ id: "a", takenAt: d("2026-06-16") }], // Tue
    });
    expect(out.map((s) => iso(s.date))).toEqual(["2026-06-16", "2026-06-19"]); // Tue anchor + Thu→Fri
    expect(out.every((s) => s.rebased === true)).toBe(true);
  });
  it("re-anchors a Sunday-early start (M/W/F → Sun/Tue/Thu) and does NOT collapse a past week", () => {
    const mwf: DatedSlot[] = [
      { date: d("2026-06-15"), time: null }, // Mon
      { date: d("2026-06-17"), time: null }, // Wed
      { date: d("2026-06-19"), time: null }, // Fri
    ];
    const out = reconstructRebasedSlots({
      weekSlots: mwf, weekStart: d("2026-06-14"), plannedDays: ["MO", "WE", "FR"],
      rebaseMode: "fixed_anchor", freq: "WEEKLY",
      delivered: [{ id: "a", takenAt: d("2026-06-14") }], // Sun — the start dose
    });
    // Pre-fix, the `today >= ` filter dropped Tue/Thu (past) → garbled week.
    expect(out.map((s) => iso(s.date))).toEqual(["2026-06-14", "2026-06-16", "2026-06-18"]);
    expect(out.every((s) => s.rebased === true)).toBe(true);
  });
  it("anchors off the chronologically-earliest dose regardless of input order", () => {
    // All three doses are OFF the M/W/F grid; correctness must not depend on the
    // array order the DB happens to return (a backfilled/edited dose breaks it).
    const mwf: DatedSlot[] = [
      { date: d("2026-06-15"), time: null }, // Mon
      { date: d("2026-06-17"), time: null }, // Wed
      { date: d("2026-06-19"), time: null }, // Fri
    ];
    const scrambled = [
      { id: "thu", takenAt: d("2026-06-18") },
      { id: "tue", takenAt: d("2026-06-16") },
      { id: "sun", takenAt: d("2026-06-14") },
    ];
    const out = reconstructRebasedSlots({
      weekSlots: mwf, weekStart: d("2026-06-14"), plannedDays: ["MO", "WE", "FR"],
      rebaseMode: "fixed_anchor", freq: "WEEKLY", delivered: scrambled,
    });
    expect(out.map((s) => iso(s.date))).toEqual(["2026-06-14", "2026-06-16", "2026-06-18"]);
    expect(out.every((s) => s.rebased === true)).toBe(true);
  });
});
