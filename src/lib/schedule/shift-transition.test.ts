import { describe, it, expect } from "vitest";
import type { WeekdayCode } from "./schedule";
import { parseDayKey, snapStartToPattern, transitionPreview } from "./shift-transition";

// Local-midnight construction (vitest pins TZ=Australia/Brisbane) — same house
// style as shift-suggest.test.ts.
const D = (y: number, m: number, d: number) => new Date(y, m - 1, d);

const FRI_4_SEP = D(2026, 9, 4);
const MWF: WeekdayCode[] = ["MO", "WE", "FR"];
const TU_TH_SA: WeekdayCode[] = ["TU", "TH", "SA"];

describe("parseDayKey", () => {
  it("parses as a LOCAL day, never new Date(key)'s UTC parse", () => {
    const d = parseDayKey("2026-09-05");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8); // 0-indexed September
    expect(d.getDate()).toBe(5);
    expect(d.getHours()).toBe(0);
  });
});

describe("snapStartToPattern", () => {
  it("earliest already on-pattern → unchanged", () => {
    const d = snapStartToPattern({
      toDays: TU_TH_SA,
      earliest: D(2026, 9, 5), // Sat, in pattern
      today: FRI_4_SEP,
      todayLogged: false,
      protocolStartDate: null,
    });
    expect(d).toEqual(D(2026, 9, 5));
  });

  it("earliest off-pattern → the next matching day forward", () => {
    // Monday is not in TU/TH/SA, so the snap must move forward to the next matching day.
    const d = snapStartToPattern({
      toDays: TU_TH_SA,
      earliest: D(2026, 9, 7), // Mon
      today: FRI_4_SEP,
      todayLogged: false,
      protocolStartDate: null,
    });
    expect(d).toEqual(D(2026, 9, 8)); // Tue
  });

  it("todayLogged pushes the floor to tomorrow even when earliest is today", () => {
    const d = snapStartToPattern({
      toDays: TU_TH_SA,
      earliest: FRI_4_SEP, // today
      today: FRI_4_SEP,
      todayLogged: true,
      protocolStartDate: null,
    });
    // tomorrow (Sat) is on-pattern, so this also proves "never a same-day
    // second dose" without needing to walk further.
    expect(d).toEqual(D(2026, 9, 5));
  });

  it("todayLogged with a pattern that skips tomorrow lands later than tomorrow", () => {
    const d = snapStartToPattern({
      toDays: ["WE", "FR", "SU"],
      earliest: FRI_4_SEP,
      today: FRI_4_SEP,
      todayLogged: true,
      protocolStartDate: null,
    });
    expect(d).toEqual(D(2026, 9, 6)); // Sun — later than tomorrow (Sat)
  });

  it("a protocolStartDate at/after earliest wins — first match strictly after it", () => {
    const d = snapStartToPattern({
      toDays: TU_TH_SA,
      earliest: D(2026, 9, 6), // Sun, <= protocolStartDate
      today: FRI_4_SEP,
      todayLogged: false,
      protocolStartDate: D(2026, 9, 10), // Thu
    });
    // Must be > Sep 10, so Sep 11 (Fri, not in pattern) is skipped too.
    expect(d).toEqual(D(2026, 9, 12)); // Sat
  });

  it("an earliest date before today is still floored at today", () => {
    const d = snapStartToPattern({
      toDays: TU_TH_SA,
      earliest: D(2026, 8, 1),
      today: FRI_4_SEP,
      todayLogged: false,
      protocolStartDate: null,
    });
    expect(d).toEqual(D(2026, 9, 5));
  });
});

describe("transitionPreview", () => {
  it("an off-pattern pick retires every skipped dose and reports the true gap: Mon/Wed/Fri -> Tue/Thu/Sat, user picks Mon 7 Sep", () => {
    // Without this: the sheet listed only "Fri 4 Sep" removed (Mon 7 Sep was also
    // retired) and said the gap was 5 days when the real gap is 6.
    const preview = transitionPreview({
      fromDays: MWF,
      toDays: TU_TH_SA,
      today: FRI_4_SEP,
      earliest: D(2026, 9, 7), // Mon, user's pick
      todayLogged: false,
      lastDoseDate: "2026-09-02", // last logged Wed
      usualGapDays: 2,
      protocolStartDate: null,
    });
    expect(preview.startDate).toBe("2026-09-08"); // real first dose: Tue
    expect(preview.removedDoseDates).toEqual(["2026-09-04", "2026-09-07"]); // Fri AND Mon
    expect(preview.gapDays).toBe(6); // not 5
    expect(preview.shorterThanUsual).toBe(false);
  });

  it("todayLogged excludes today from removedDoseDates and measures the gap from it", () => {
    const preview = transitionPreview({
      fromDays: MWF,
      toDays: TU_TH_SA,
      today: FRI_4_SEP,
      earliest: FRI_4_SEP,
      todayLogged: true,
      lastDoseDate: "2026-09-04",
      usualGapDays: 2,
      protocolStartDate: null,
    });
    expect(preview.startDate).toBe("2026-09-05");
    expect(preview.removedDoseDates).toEqual([]);
    expect(preview.gapDays).toBe(1);
    expect(preview.shorterThanUsual).toBe(true);
  });

  it("lastDoseDate null → gapDays null, never shorter than usual", () => {
    const preview = transitionPreview({
      fromDays: MWF,
      toDays: TU_TH_SA,
      today: FRI_4_SEP,
      earliest: FRI_4_SEP,
      todayLogged: false,
      lastDoseDate: null,
      usualGapDays: 2,
      protocolStartDate: null,
    });
    expect(preview.gapDays).toBeNull();
    expect(preview.shorterThanUsual).toBe(false);
  });

  // Same scenario as the off-pattern test above (which gets
  // ["2026-09-04", "2026-09-07"] with no courseEnd at all) — a course that
  // ends inside the transition window must stop listing removed doses once
  // past its own end, since a day after it was never a planned dose.
  it("a course end inside the window truncates removedDoseDates — days after it are not listed", () => {
    const preview = transitionPreview({
      fromDays: MWF,
      toDays: TU_TH_SA,
      today: FRI_4_SEP,
      earliest: D(2026, 9, 7), // Mon, user's pick
      todayLogged: false,
      lastDoseDate: "2026-09-02",
      usualGapDays: 2,
      protocolStartDate: null,
      courseEnd: D(2026, 9, 5), // Saturday — ends before Monday's would-be removal
    });
    expect(preview.startDate).toBe("2026-09-08");
    // 2026-09-07 (Monday) is past the course end, so it never appears —
    // unlike the identical scenario above with no courseEnd, where it does.
    expect(preview.removedDoseDates).toEqual(["2026-09-04"]);
  });
});
