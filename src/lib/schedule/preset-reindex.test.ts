import { describe, it, expect } from "vitest";
import { reindexPresetState } from "./preset-reindex";

describe("reindexPresetState", () => {
  it("3 entries, preset at index 1, remove index 0 → idx [0], n/time keys shift 1→0 with values preserved", () => {
    const result = reindexPresetState(0, {
      idx: [1],
      n: { 1: 3 },
      time: { 1: "09:00" },
    });
    expect(result.idx).toEqual([0]);
    expect(result.n).toEqual({ 0: 3 });
    expect(result.time).toEqual({ 0: "09:00" });
  });

  it("preset at index 1, remove index 2 (below) → idx stays [1], unchanged", () => {
    const result = reindexPresetState(2, {
      idx: [1],
      n: { 1: 4 },
      time: { 1: "07:30" },
    });
    expect(result.idx).toEqual([1]);
    expect(result.n).toEqual({ 1: 4 });
    expect(result.time).toEqual({ 1: "07:30" });
  });

  it("preset at index 0, remove index 0 (the preset itself) → idx [], n/time cleared of 0", () => {
    const result = reindexPresetState(0, {
      idx: [0],
      n: { 0: 5 },
      time: { 0: "08:00" },
    });
    expect(result.idx).toEqual([]);
    expect(result.n).toEqual({});
    expect(result.time).toEqual({});
  });

  it("two presets at {0,2}, remove index 1 → {0,1} with values remapped", () => {
    const result = reindexPresetState(1, {
      idx: [0, 2],
      n: { 0: 2, 2: 4 },
      time: { 0: "06:00", 2: "20:00" },
    });
    expect(result.idx).toEqual([0, 1]);
    expect(result.n).toEqual({ 0: 2, 1: 4 });
    expect(result.time).toEqual({ 0: "06:00", 1: "20:00" });
  });
});
