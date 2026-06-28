import { describe, it, expect } from "vitest";
import { filterByRange, rollingAverage } from "./wearable-aggregate";

const pts = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ date: `2026-06-${String(i + 1).padStart(2, "0")}`, value: i + 1 }));

describe("filterByRange", () => {
  it("keeps the last N points", () => {
    expect(filterByRange(pts(30), 7).length).toBe(7);
    expect(filterByRange(pts(30), 7)[0].value).toBe(24);
  });
  it("'all' returns everything", () => {
    expect(filterByRange(pts(30), "all").length).toBe(30);
  });
  it("a range larger than the data returns all of it", () => {
    expect(filterByRange(pts(3), 7).length).toBe(3);
  });
});

describe("rollingAverage", () => {
  it("computes a trailing-window mean over value", () => {
    const r = rollingAverage(
      [{ date: "a", value: 2 }, { date: "b", value: 4 }, { date: "c", value: 6 }],
      2,
    );
    expect(r.map((p) => p.value)).toEqual([2, 3, 5]);
  });
  it("ignores nulls in the window", () => {
    const r = rollingAverage([{ date: "a", value: null }, { date: "b", value: 4 }], 2);
    expect(r[1].value).toBe(4);
  });
  it("yields null when the window is entirely null", () => {
    const r = rollingAverage([{ date: "a", value: null }, { date: "b", value: null }], 2);
    expect(r[1].value).toBeNull();
  });
});
