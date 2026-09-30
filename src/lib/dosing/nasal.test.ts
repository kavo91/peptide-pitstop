import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { pumpsToMl, mlToPumps, formatPumps } from "./nasal";

describe("pumpsToMl", () => {
  it("multiplies pumps by the metered spray increment", () => {
    expect(pumpsToMl(1, "0.1").toString()).toBe("0.1");
    expect(pumpsToMl(2, "0.1").toString()).toBe("0.2");
  });

  it("is exact (decimal, no floating-point drift)", () => {
    // 0.1 * 3 as a naive float is 0.30000000000000004 — Decimal must not do that.
    expect(pumpsToMl(3, "0.1").toString()).toBe("0.3");
  });

  it("handles a zero pump count", () => {
    expect(pumpsToMl(0, "0.1").toString()).toBe("0");
  });
});

describe("mlToPumps", () => {
  it("divides mL by the metered spray increment", () => {
    expect(mlToPumps("0.1", "0.1").toString()).toBe("1");
    expect(mlToPumps("0.2", "0.1").toString()).toBe("2");
  });

  it("is exact — a whole-pump volume yields a whole-pump count", () => {
    expect(mlToPumps("0.3", "0.1").toString()).toBe("3");
  });

  it("throws on a non-positive increment", () => {
    expect(() => mlToPumps("0.1", "0")).toThrow();
    expect(() => mlToPumps("0.1", "-0.1")).toThrow();
  });

  it("round-trips with pumpsToMl", () => {
    const ml = pumpsToMl(4, "0.1");
    expect(mlToPumps(ml, "0.1").toString()).toBe("4");
  });
});

describe("formatPumps", () => {
  it("singularises exactly 1", () => {
    expect(formatPumps(1)).toBe("1 pump");
    expect(formatPumps("1")).toBe("1 pump");
    expect(formatPumps(new Decimal(1))).toBe("1 pump");
  });

  it("pluralises everything else", () => {
    expect(formatPumps(0)).toBe("0 pumps");
    expect(formatPumps(2)).toBe("2 pumps");
    expect(formatPumps(3.5)).toBe("3.5 pumps");
  });
});
