import { describe, it, expect } from "vitest";
import { mergeWearableRows, type SourcedRow } from "./wearable-merge";

const day = (iso: string) => new Date(`${iso}T00:00:00`);

function row(partial: Partial<SourcedRow> & { date: Date; source: string }): SourcedRow {
  return { ...partial } as SourcedRow;
}

describe("mergeWearableRows", () => {
  it("passes garmin-only rows through untouched", () => {
    const rows = [row({ date: day("2026-07-10"), source: "garmin", steps: 9000, hrvMs: 55 })];
    const out = mergeWearableRows(rows);
    expect(out).toHaveLength(1);
    expect(out[0].steps).toBe(9000);
    expect(out[0].hrvMs).toBe(55);
  });

  it("fills gaps from healthkit but garmin wins on conflict", () => {
    const rows = [
      row({ date: day("2026-07-10"), source: "garmin", steps: 9000, weightKg: null }),
      row({ date: day("2026-07-10"), source: "healthkit", steps: 4000, weightKg: 82.5 }),
    ];
    const out = mergeWearableRows(rows);
    expect(out).toHaveLength(1);
    expect(out[0].steps).toBe(9000);      // garmin wins
    expect(out[0].weightKg).toBe(82.5);   // healthkit fills the gap
  });

  it("never fills hrvMs from healthkit (SDNN must not mix with RMSSD)", () => {
    const rows = [
      row({ date: day("2026-07-10"), source: "garmin", hrvMs: null, steps: 100 }),
      row({ date: day("2026-07-10"), source: "healthkit", hrvMs: 48, steps: null }),
    ];
    expect(mergeWearableRows(rows)[0].hrvMs).toBeNull();
  });

  it("includes healthkit-only days with hrvMs stripped", () => {
    const rows = [row({ date: day("2026-07-11"), source: "healthkit", steps: 7000, hrvMs: 48 })];
    const out = mergeWearableRows(rows);
    expect(out).toHaveLength(1);
    expect(out[0].steps).toBe(7000);
    expect(out[0].hrvMs ?? null).toBeNull();
  });

  it("keeps days sorted ascending and distinct", () => {
    const rows = [
      row({ date: day("2026-07-11"), source: "healthkit", steps: 1 }),
      row({ date: day("2026-07-10"), source: "garmin", steps: 2 }),
    ];
    const out = mergeWearableRows(rows);
    expect(out.map((r) => r.date.getTime())).toEqual([day("2026-07-10").getTime(), day("2026-07-11").getTime()]);
  });

  it("tags a garmin-only day as source 'garmin'", () => {
    const out = mergeWearableRows([row({ date: day("2026-07-10"), source: "garmin", steps: 9000 })]);
    expect(out[0].mergedSource).toBe("garmin");
  });

  it("tags a healthkit-only day as source 'healthkit'", () => {
    const out = mergeWearableRows([row({ date: day("2026-07-11"), source: "healthkit", steps: 7000 })]);
    expect(out[0].mergedSource).toBe("healthkit");
  });

  it("tags a garmin day that healthkit filled as source 'mixed'", () => {
    const out = mergeWearableRows([
      row({ date: day("2026-07-10"), source: "garmin", steps: 9000, weightKg: null }),
      row({ date: day("2026-07-10"), source: "healthkit", weightKg: 82.5 }),
    ]);
    expect(out[0].weightKg).toBe(82.5);        // filled
    expect(out[0].mergedSource).toBe("mixed");
  });

  it("tags a garmin day with nothing to fill as source 'garmin'", () => {
    const out = mergeWearableRows([
      row({ date: day("2026-07-10"), source: "garmin", steps: 9000, weightKg: 80 }),
      row({ date: day("2026-07-10"), source: "healthkit", steps: 4000, weightKg: 82.5 }),
    ]);
    expect(out[0].mergedSource).toBe("garmin");  // garmin had every field; nothing filled
  });
});
