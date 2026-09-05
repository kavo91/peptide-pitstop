import { describe, it, expect } from "vitest";
import type { CombinedMove, ShiftSuggestion } from "@/lib/schedule/shift-suggest";
import { formatDayKey, dayList, timeList, gapSentence, addDayKey, dayOfMonth, confirmInputForMove } from "./format";

describe("formatDayKey", () => {
  it("parses the key as a LOCAL date and renders a fixed 'Sat 5 Sep' form", () => {
    expect(formatDayKey("2026-09-05")).toBe("Sat 5 Sep");
    // Year/month boundary — would go off-by-one under UTC parsing.
    expect(formatDayKey("2026-01-01")).toBe("Thu 1 Jan");
    expect(formatDayKey("2026-12-31")).toBe("Thu 31 Dec");
  });
});

describe("dayList", () => {
  it("joins weekday codes via DAY_LABELS, single or multiple", () => {
    expect(dayList(["MO", "WE", "FR"])).toBe("Mon, Wed, Fri");
    expect(dayList(["SU"])).toBe("Sun");
  });
});

describe("timeList", () => {
  it("joins HH:MM times with a comma-space", () => {
    expect(timeList(["07:00"])).toBe("07:00");
    expect(timeList(["07:00", "20:00"])).toBe("07:00, 20:00");
  });
});

describe("gapSentence", () => {
  it("no lastDoseDate/gapDays → the no-earlier-dose sentence", () => {
    expect(gapSentence({ lastDoseDate: null, gapDays: null, usualGapDays: 2, shorterThanUsual: false })).toBe(
      "No earlier dose to measure the gap from.",
    );
  });

  it("ordinary gap → the one factual sentence, no extra note", () => {
    expect(gapSentence({ lastDoseDate: "2026-09-01", gapDays: 4, usualGapDays: 2, shorterThanUsual: false })).toBe(
      `Gap from your last dose (${formatDayKey("2026-09-01")}) to the first new one: 4 days.`,
    );
  });

  it("shorter than usual → appends the factual note, never a recommendation", () => {
    expect(gapSentence({ lastDoseDate: "2026-09-01", gapDays: 1, usualGapDays: 2, shorterThanUsual: true })).toBe(
      `Gap from your last dose (${formatDayKey("2026-09-01")}) to the first new one: 1 day. That is shorter than your usual gap of 2 days.`,
    );
  });
});

describe("addDayKey", () => {
  it("walks a week from a Monday, one key per grid column", () => {
    const week = [0, 1, 2, 3, 4, 5, 6].map((i) => addDayKey("2026-09-14", i));
    expect(week).toEqual([
      "2026-09-14",
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
      "2026-09-19",
      "2026-09-20",
    ]);
  });

  it("rolls over month, year and leap day in both directions", () => {
    expect(addDayKey("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDayKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDayKey("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDayKey("2026-02-28", 1)).toBe("2026-03-01");
    // 2028 IS a leap year — the platform's own calendar, not a table of ours.
    expect(addDayKey("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDayKey("2028-03-01", -1)).toBe("2028-02-29");
  });

  it("crosses a midnight DST transition without losing or repeating a day", () => {
    // The suite pins TZ=Australia/Brisbane for every other test in this file,
    // which has no DST at all — so a bug that added milliseconds to a
    // timestamp instead of setting the day field could pass there by
    // accident. America/Santiago's clocks spring forward AT local midnight on
    // 2026-09-06 (verified against Node's own tz data: local 00:00-01:00 that
    // day does not exist and resolves to 01:00), which is the sharpest version
    // of this bug: addDayKey never touches the hour, so if it worked by adding
    // n*86400000ms to a timestamp instead of setting `d + n` on the date
    // constructor, this exact transition would shift the printed day. TZ is
    // restored in `finally` so it cannot leak into a later test.
    const original = process.env.TZ;
    process.env.TZ = "America/Santiago";
    try {
      expect(addDayKey("2026-09-05", 1)).toBe("2026-09-06");
      expect(addDayKey("2026-09-06", 1)).toBe("2026-09-07");
      expect(addDayKey("2026-08-30", 7)).toBe("2026-09-06");
      expect(addDayKey("2026-09-01", 5)).toBe("2026-09-06");
    } finally {
      process.env.TZ = original;
    }
  });

  it("zero-pads month and day so the result is a valid day key", () => {
    expect(addDayKey("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDayKey("2026-09-09", 0)).toBe("2026-09-09");
  });
});

describe("dayOfMonth", () => {
  it("returns the day number the grid header prints", () => {
    expect(dayOfMonth("2026-09-14")).toBe(14);
    expect(dayOfMonth("2026-01-01")).toBe(1);
    expect(dayOfMonth("2026-12-31")).toBe(31);
  });

  it("agrees with formatDayKey on the same key, so header and captions cannot disagree", () => {
    expect(formatDayKey("2026-09-14")).toBe("Mon 14 Sep");
    expect(dayOfMonth("2026-09-14")).toBe(14);
  });
});

describe("confirmInputForMove", () => {
  /** A move of the combined plan, with only the fields this choice reads set. */
  const move = (protocolId: string, k: number): CombinedMove => ({
    protocolId,
    protocolName: "Course",
    peptideName: "BPC-157",
    k,
    fromDays: ["MO", "WE", "FR"],
    toDays: ["TU", "TH", "SA"],
    times: ["07:00"],
    startDate: "2026-09-08",
    removedDoseDates: [],
    lastDoseDate: "2026-09-04",
    gapDays: 4,
    usualGapDays: 2,
    shorterThanUsual: false,
    fingerprint: "a".repeat(64),
    protocolStartDate: "2026-08-01",
    courseEndDate: null,
    standaloneAfter: [1, 0, 1, 0, 1, 0, 0],
  });

  /** The standalone card for the same protocol, distinguishable by fingerprint. */
  const suggestion = (protocolId: string, k: number): ShiftSuggestion => {
    const { standaloneAfter, ...shared } = move(protocolId, k);
    void standaloneAfter;
    return {
      ...shared,
      before: [1, 0, 1, 0, 1, 0, 0],
      after: [0, 1, 0, 1, 0, 1, 0],
      rows: [],
      perTime: [],
      sameTimeDays: { before: 0, after: 0 },
      weekStart: "2026-09-07",
      fingerprint: "b".repeat(64),
    };
  };

  it("takes the standalone card when it is the same protocol AND the same rotation", () => {
    const m = move("p1", 1);
    expect(confirmInputForMove(m, [suggestion("p1", 1)]).fingerprint).toBe("b".repeat(64));
  });

  it("takes the move when the card for that protocol is a DIFFERENT rotation", () => {
    // The card would open a sheet naming days the move's own row never showed.
    const m = move("p1", 1);
    expect(confirmInputForMove(m, [suggestion("p1", 3)])).toBe(m);
  });

  it("takes the move when no card exists for that protocol at all", () => {
    const m = move("p1", 1);
    expect(confirmInputForMove(m, [suggestion("p2", 1)])).toBe(m);
    expect(confirmInputForMove(m, [])).toBe(m);
  });
});
