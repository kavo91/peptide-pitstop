import { describe, expect, it } from "vitest";

import { ANCHOR_HELD_WARNING, cycleAnchorFollow } from "./anchor";

const D = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("cycleAnchorFollow", () => {
  // Created with startDate = cycleAnchor on the same day, no doses yet, start
  // moved five days later. The anchor must come with it, or the first ON block
  // of the cycle plan ends five days early.
  it("moves a linked anchor with the start date when no doses are logged", () => {
    const res = cycleAnchorFollow({
      storedStartDate: D("2027-03-02"),
      storedAnchor: D("2027-03-02"),
      nextStartDate: D("2027-03-07"),
      hasDoseLogs: false,
    });
    expect(res).toEqual({ move: true, anchor: D("2027-03-07"), warn: false });
  });

  it("holds a linked anchor and warns once doses exist", () => {
    const res = cycleAnchorFollow({
      storedStartDate: D("2027-03-02"),
      storedAnchor: D("2027-03-02"),
      nextStartDate: D("2027-03-07"),
      hasDoseLogs: true,
    });
    expect(res.move).toBe(false);
    expect(res.anchor).toEqual(D("2027-03-02"));
    expect(res.warn).toBe(true);
  });

  it("never rewrites an anchor the user placed away from the start", () => {
    // GanttRowEditor lets the anchor be set independently. That is intent.
    const res = cycleAnchorFollow({
      storedStartDate: D("2027-03-02"),
      storedAnchor: D("2027-03-30"),
      nextStartDate: D("2027-03-07"),
      hasDoseLogs: false,
    });
    expect(res).toEqual({ move: false, anchor: D("2027-03-30"), warn: false });
  });

  it("leaves a null anchor null — it already follows startDate at read time", () => {
    const res = cycleAnchorFollow({
      storedStartDate: D("2027-03-02"),
      storedAnchor: null,
      nextStartDate: D("2027-03-07"),
      hasDoseLogs: false,
    });
    expect(res).toEqual({ move: false, anchor: null, warn: false });
  });

  it("does nothing when the start date is merely echoed back unchanged", () => {
    // ProtocolForm posts the whole form on every save, changed or not.
    const res = cycleAnchorFollow({
      storedStartDate: D("2027-03-02"),
      storedAnchor: D("2027-03-02"),
      nextStartDate: D("2027-03-02"),
      hasDoseLogs: false,
    });
    expect(res).toEqual({ move: false, anchor: D("2027-03-02"), warn: false });
  });

  it("compares by DAY, so a same-day time-of-day difference is not a move", () => {
    const res = cycleAnchorFollow({
      storedStartDate: D("2027-03-02"),
      storedAnchor: D("2027-03-02"),
      nextStartDate: new Date("2027-03-02T13:45:00.000Z"),
      hasDoseLogs: false,
    });
    expect(res.move).toBe(false);
    expect(res.warn).toBe(false);
  });

  it("clearing the start date carries a linked anchor to null with it", () => {
    const res = cycleAnchorFollow({
      storedStartDate: D("2027-03-02"),
      storedAnchor: D("2027-03-02"),
      nextStartDate: null,
      hasDoseLogs: false,
    });
    expect(res).toEqual({ move: true, anchor: null, warn: false });
  });

  it("treats an anchor on a protocol with no stored start date as deliberate", () => {
    const res = cycleAnchorFollow({
      storedStartDate: null,
      storedAnchor: D("2027-03-02"),
      nextStartDate: D("2027-03-07"),
      hasDoseLogs: false,
    });
    expect(res.move).toBe(false);
    expect(res.warn).toBe(false);
  });

  it("stays linked across successive edits — the rule is not one-shot", () => {
    const first = cycleAnchorFollow({
      storedStartDate: D("2027-03-02"),
      storedAnchor: D("2027-03-02"),
      nextStartDate: D("2027-03-07"),
      hasDoseLogs: false,
    });
    const second = cycleAnchorFollow({
      storedStartDate: D("2027-03-07"),
      storedAnchor: first.anchor,
      nextStartDate: D("2027-03-14"),
      hasDoseLogs: false,
    });
    expect(second).toEqual({ move: true, anchor: D("2027-03-14"), warn: false });
  });

  it("names what did NOT move, since the start date change itself still lands", () => {
    expect(ANCHOR_HELD_WARNING).toMatch(/cycle window/i);
    expect(ANCHOR_HELD_WARNING).toMatch(/logged doses/i);
  });
});
