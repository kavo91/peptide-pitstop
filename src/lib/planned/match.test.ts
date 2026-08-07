import { describe, it, expect } from "vitest";
import {
  matchPlannedDose,
  doseDeltaMinutes,
  plannedDayWindow,
  plannedMatchDay,
  pickNearestPlanned,
  scheduledSlotInstant,
  unlinkedPlannedStatus,
  type PlannableSlot,
} from "./match";

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

  it("reclaims an unlinked row the cron already marked missed", () => {
    const m = matchPlannedDose(dt("2026-06-22T09:00:00"), [slot({ id: "missed", status: "missed" })]);
    expect(m?.plannedDoseId).toBe("missed");
  });

  it("ignores taken and skipped rows", () => {
    expect(matchPlannedDose(dt("2026-06-22T09:00:00"), [slot({ status: "taken" })])).toBeNull();
    expect(matchPlannedDose(dt("2026-06-22T09:00:00"), [slot({ status: "skipped" })])).toBeNull();
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

  it("uses the frozen tracking day instead of takenAt's runtime day", () => {
    const takenAt = dt("2026-07-24T15:03:00");
    const reference = plannedMatchDay(takenAt, "2026-07-23");
    const { dayStart, dayEnd } = plannedDayWindow(reference);
    expect(dayStart).toEqual(d("2026-07-23"));
    expect(dayEnd).toEqual(d("2026-07-24"));
  });

  it("falls back to the actual instant for legacy unstamped logs", () => {
    const takenAt = dt("2026-07-24T15:03:00");
    expect(plannedMatchDay(takenAt, null)).toBe(takenAt);
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

describe("unlinkedPlannedStatus", () => {
  const now = dt("2026-07-24T15:00:00");

  it("restores a past row to missed", () => {
    expect(unlinkedPlannedStatus(dt("2026-07-23T12:00:00"), now)).toBe("missed");
  });

  it("restores a current/future row to planned", () => {
    expect(unlinkedPlannedStatus(dt("2026-07-24T00:00:00"), now)).toBe("planned");
    expect(unlinkedPlannedStatus(dt("2026-07-25T00:00:00"), now)).toBe("planned");
  });
});

describe("scheduledSlotInstant", () => {
  // Weekday-evening protocol: Mon–Fri at 21:00. 2027-03-11 is a Thursday.
  const WEEKNIGHT = JSON.stringify([
    { dayPattern: { kind: "weekly", byDays: ["MO", "TU", "WE", "TH", "FR"] }, times: ["21:00"] },
  ]);

  it("returns the slot's real clock time, not the day anchor", () => {
    const got = scheduledSlotInstant({
      scheduleRule: WEEKNIGHT,
      day: d("2027-03-11"),
      takenAt: dt("2027-03-11T23:52:00"),
    });
    expect(got).toEqual(dt("2027-03-11T21:00:00"));
  });

  it("REGRESSION: a late evening dose reads minutes late, not a whole day late", () => {
    // The defect: DoseLog.scheduledAt inherited PlannedDose's LOCAL-MIDNIGHT
    // day anchor, so a dose taken 2h52m after a 21:00 slot exported as
    // ~1432 min late instead of 172. Export + PDF report showed the inflated value.
    const takenAt = dt("2027-03-11T23:52:00");
    const anchorDelta = doseDeltaMinutes(takenAt, d("2027-03-11")); // old behaviour
    const slot = scheduledSlotInstant({ scheduleRule: WEEKNIGHT, day: d("2027-03-11"), takenAt });
    const realDelta = doseDeltaMinutes(takenAt, slot);

    expect(anchorDelta).toBe(1432); // midnight-anchored: the bug
    expect(realDelta).toBe(172); // 21:00 -> 23:52
  });

  it("picks the nearest slot on a multi-slot day (evening dose -> PM slot)", () => {
    const twice = JSON.stringify([{ dayPattern: { kind: "daily" }, times: ["08:00", "20:00"] }]);
    const got = scheduledSlotInstant({
      scheduleRule: twice,
      day: d("2027-03-11"),
      takenAt: dt("2027-03-11T19:30:00"),
    });
    expect(got).toEqual(dt("2027-03-11T20:00:00"));
  });

  it("returns null for an untimed schedule so callers keep the day anchor", () => {
    const untimed = JSON.stringify([{ dayPattern: { kind: "daily" }, times: [] }]);
    expect(
      scheduledSlotInstant({ scheduleRule: untimed, day: d("2027-03-11"), takenAt: dt("2027-03-11T10:00:00") }),
    ).toBeNull();
  });

  it("returns null when the day is off-grid or the rule is absent", () => {
    // 2027-03-13 is a Saturday — not on a Mon-Fri grid.
    expect(
      scheduledSlotInstant({ scheduleRule: WEEKNIGHT, day: d("2027-03-13"), takenAt: dt("2027-03-13T21:10:00") }),
    ).toBeNull();
    expect(
      scheduledSlotInstant({ scheduleRule: null, day: d("2027-03-11"), takenAt: dt("2027-03-11T21:10:00") }),
    ).toBeNull();
  });

  it("respects the protocol's start/end window", () => {
    expect(
      scheduledSlotInstant({
        scheduleRule: WEEKNIGHT,
        day: d("2027-03-11"),
        takenAt: dt("2027-03-11T21:10:00"),
        endDate: d("2027-03-10"),
      }),
    ).toBeNull();
  });
});
