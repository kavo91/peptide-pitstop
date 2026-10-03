import { describe, it, expect } from "vitest";
import { weekCellEntries } from "./doses-week";
import type { TimelineEntry } from "./doses-timeline-core";

// A twice-daily peptide must show two glyphs on /doses?view=week.
const e = (time: string, status: TimelineEntry["status"]): TimelineEntry => ({
  date: "2027-03-01", time, protocolId: "p1", peptideId: "pep", peptideName: "Pep", doseLabel: "250 mcg", status,
});

describe("weekCellEntries", () => {
  it("a twice-daily day returns both slots, in time order", () => {
    const cell = weekCellEntries([e("20:00", "missed"), e("08:00", "taken_ontime")], "pep", "2027-03-01");
    expect(cell).toHaveLength(2);
    expect(cell.map((x) => x.time)).toEqual(["08:00", "20:00"]);
  });
  it("other peptides and other days stay out", () => {
    const other = { ...e("08:00", "planned"), peptideId: "other" };
    expect(weekCellEntries([other, e("08:00", "planned")], "pep", "2027-03-02")).toHaveLength(0);
  });
});
