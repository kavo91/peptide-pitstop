import { describe, it, expect } from "vitest";
import { matchPlannedDose, doseDeltaMinutes, plannedDayWindow, pickNearestPlanned, type PlannableSlot } from "./match";

/** Midnight-local Date from YYYY-MM-DD (avoids UTC-offset skew). */
const d = (s: string): Date => new Date(s + "T00:00:00");
const dt = (s: string): Date => new Date(s);

function slot(overrides: Partial<PlannableSlot> = {}): PlannableSlot {
  return {
    id: "pd-1",
    scheduledAt: d("2026-06-22"),
    status: "planned",
    hasDoseLog: false,
    ...overrides,
  };
}

describe("matchPlannedDose", () => {
  it("links a log to the planned slot on the same day → sets plannedDoseId", () => {
    const m = matchPlannedDose(dt("2026-06-22T09:30:00"), [slot({ id: "pd-mon" })]);
    expect(m).not.toBeNull();
    expect(m?.plannedDoseId).toBe("pd-mon");
    expect(m?.scheduledAt).toEqual(d("2026-06-22"));
  });

  it("picks the EARLIEST eligible slot when several share a day", () => {
    const m = matchPlannedDose(dt("2026-06-22T20:00:00"), [
      slot({ id: "pm", scheduledAt: dt("2026-06-22T18:00:00") }),
      slot({ id: "am", scheduledAt: dt("2026-06-22T08:00:00") }),
    ]);
    expect(m?.plannedDoseId).toBe("am");
  });

  it("ignores already-linked slots (doseLog present)", () => {
    const m = matchPlannedDose(dt("2026-06-22T09:00:00"), [slot({ id: "taken", hasDoseLog: true })]);
    expect(m).toBeNull();
  });

  it("ignores non-planned slots (taken/missed/skipped)", () => {
    const m = matchPlannedDose(dt("2026-06-22T09:00:00"), [slot({ id: "missed", status: "missed" })]);
    expect(m).toBeNull();
  });

  it("ignores slots on a different day", () => {
    const m = matchPlannedDose(dt("2026-06-22T09:00:00"), [slot({ id: "tue", scheduledAt: d("2026-06-23") })]);
    expect(m).toBeNull();
  });

  it("returns null when there are no slots (off-day / ad-hoc log)", () => {
    expect(matchPlannedDose(dt("2026-06-22T09:00:00"), [])).toBeNull();
  });
});

describe("pickNearestPlanned", () => {
  const row = (id: string, at: string) => ({ id, scheduledAt: dt(at) });

  it("picks the PM slot for an evening log on a two-slot AM/PM day (not the earliest)", () => {
    const candidates = [row("am", "2026-06-22T08:00:00"), row("pm", "2026-06-22T18:00:00")];
    expect(pickNearestPlanned(candidates, dt("2026-06-22T19:30:00"))?.id).toBe("pm");
  });

  it("picks the AM slot for a morning log on a two-slot AM/PM day", () => {
    const candidates = [row("am", "2026-06-22T08:00:00"), row("pm", "2026-06-22T18:00:00")];
    expect(pickNearestPlanned(candidates, dt("2026-06-22T09:00:00"))?.id).toBe("am");
  });

  it("is order-independent — same nearest result regardless of input order", () => {
    const am = row("am", "2026-06-22T08:00:00");
    const pm = row("pm", "2026-06-22T18:00:00");
    expect(pickNearestPlanned([pm, am], dt("2026-06-22T19:30:00"))?.id).toBe("pm");
  });

  it("breaks an exact distance tie toward the earliest slot", () => {
    // 13:00 is equidistant (5h) from the 08:00 and 18:00 slots → earliest wins.
    const candidates = [row("pm", "2026-06-22T18:00:00"), row("am", "2026-06-22T08:00:00")];
    expect(pickNearestPlanned(candidates, dt("2026-06-22T13:00:00"))?.id).toBe("am");
  });

  it("returns the single slot unchanged when there is only one candidate", () => {
    const candidates = [row("only", "2026-06-22T08:00:00")];
    expect(pickNearestPlanned(candidates, dt("2026-06-22T23:00:00"))?.id).toBe("only");
  });

  it("returns undefined when there are no candidates", () => {
    expect(pickNearestPlanned([], dt("2026-06-22T09:00:00"))).toBeUndefined();
  });
});

describe("plannedDayWindow", () => {
  it("is the [00:00, next 00:00) window for the local day of takenAt", () => {
    const { dayStart, dayEnd } = plannedDayWindow(dt("2026-06-22T23:59:00"));
    expect(dayStart).toEqual(d("2026-06-22"));
    expect(dayEnd).toEqual(d("2026-06-23"));
  });
});

describe("doseDeltaMinutes", () => {
  it("returns signed minutes between takenAt and scheduledAt", () => {
    expect(doseDeltaMinutes(dt("2026-06-22T09:30:00"), dt("2026-06-22T09:00:00"))).toBe(30);
    expect(doseDeltaMinutes(dt("2026-06-22T08:45:00"), dt("2026-06-22T09:00:00"))).toBe(-15);
  });

  it("returns null when there is no scheduled time", () => {
    expect(doseDeltaMinutes(dt("2026-06-22T09:30:00"), null)).toBeNull();
  });
});
