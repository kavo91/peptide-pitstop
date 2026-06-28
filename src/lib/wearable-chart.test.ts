import { describe, it, expect } from "vitest";
import {
  extent,
  buildLinePath,
  average,
  latestNonNull,
  secondsToHours,
  formatDayKeyShort,
} from "./wearable-chart";

describe("extent", () => {
  it("returns null when there are no finite values", () => {
    expect(extent([])).toBeNull();
    expect(extent([null, undefined, NaN, Infinity])).toBeNull();
  });

  it("ignores nulls/NaN and returns min/max of the finite values", () => {
    expect(extent([5, null, 2, NaN, 9, undefined])).toEqual({ min: 2, max: 9 });
  });

  it("handles a single value (min === max)", () => {
    expect(extent([4, null])).toEqual({ min: 4, max: 4 });
  });
});

describe("buildLinePath", () => {
  it("joins consecutive points with L and starts with M", () => {
    expect(
      buildLinePath([
        { x: 0, y: 0 },
        { x: 10, y: 5 },
        { x: 20, y: 2 },
      ]),
    ).toBe("M0.0,0.0 L10.0,5.0 L20.0,2.0");
  });

  it("breaks the line at nulls so gaps are not bridged", () => {
    expect(
      buildLinePath([
        { x: 0, y: 0 },
        null,
        { x: 20, y: 2 },
        { x: 30, y: 3 },
      ]),
    ).toBe("M0.0,0.0 M20.0,2.0 L30.0,3.0");
  });

  it("returns an empty string for no drawable points", () => {
    expect(buildLinePath([])).toBe("");
    expect(buildLinePath([null, null])).toBe("");
  });
});

describe("average", () => {
  it("averages only the finite values", () => {
    expect(average([2, 4, null, 6, NaN])).toBe(4);
  });

  it("returns null when there are no finite values", () => {
    expect(average([null, undefined])).toBeNull();
  });
});

describe("latestNonNull", () => {
  it("returns the last finite value", () => {
    expect(latestNonNull([1, 2, null])).toBe(2);
    expect(latestNonNull([1, null, 3])).toBe(3);
  });

  it("returns null when there are no finite values", () => {
    expect(latestNonNull([null, undefined, NaN])).toBeNull();
  });
});

describe("secondsToHours", () => {
  it("converts seconds to hours", () => {
    expect(secondsToHours(3600)).toBe(1);
    expect(secondsToHours(5400)).toBe(1.5);
  });

  it("is null-safe", () => {
    expect(secondsToHours(null)).toBeNull();
    expect(secondsToHours(undefined)).toBeNull();
  });
});

describe("formatDayKeyShort", () => {
  it("formats a YYYY-MM-DD key as 'D Mon'", () => {
    expect(formatDayKeyShort("2026-06-20")).toBe("20 Jun");
    expect(formatDayKeyShort("2026-01-05")).toBe("5 Jan");
  });
});
