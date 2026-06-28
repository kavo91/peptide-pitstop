import { describe, it, expect } from "vitest";
import { parseRule, buildRule, describeRule, isDueOn, activeStep, weekdayCode, occurrencesInRange } from "./schedule";

const d = (s: string) => new Date(s + "T09:00:00");

describe("parseRule", () => {
  it("parses daily", () => expect(parseRule("FREQ=DAILY")).toEqual({ freq: "DAILY", byDay: undefined }));
  it("parses weekly by-day", () =>
    expect(parseRule("FREQ=WEEKLY;BYDAY=MO,WE,FR")).toEqual({ freq: "WEEKLY", byDay: ["MO", "WE", "FR"] }));
});

describe("describeRule", () => {
  it("daily", () => expect(describeRule("FREQ=DAILY")).toBe("Daily"));
  it("weekly by-day → day names", () => expect(describeRule("FREQ=WEEKLY;BYDAY=MO,WE,FR")).toBe("Mon, Wed, Fri"));
  it("weekly all 7 days → Daily", () => expect(describeRule("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU")).toBe("Daily"));
  it("null → No schedule", () => expect(describeRule(null)).toBe("No schedule"));
});

describe("weekly with no explicit days (anchored to start weekday)", () => {
  const start = d("2026-06-15"); // a Monday
  it("due on the same weekday as start", () =>
    expect(isDueOn({ rule: "FREQ=WEEKLY", date: d("2026-06-22"), startDate: start })).toBe(true)); // next Monday
  it("not due on other weekdays", () =>
    expect(isDueOn({ rule: "FREQ=WEEKLY", date: d("2026-06-16"), startDate: start })).toBe(false)); // Tuesday
  it("not due (not 'every day') when there is no anchor", () =>
    expect(isDueOn({ rule: "FREQ=WEEKLY", date: d("2026-06-16") })).toBe(false));
});

describe("buildRule", () => {
  it("builds daily", () => expect(buildRule("DAILY")).toBe("FREQ=DAILY"));
  it("builds weekly by-day", () => expect(buildRule("WEEKLY", ["MO", "WE", "FR"])).toBe("FREQ=WEEKLY;BYDAY=MO,WE,FR"));
  it("weekly without days falls back to plain weekly", () => expect(buildRule("WEEKLY", [])).toBe("FREQ=WEEKLY"));
  it("round-trips through parseRule", () =>
    expect(parseRule(buildRule("WEEKLY", ["TU", "TH"]))).toEqual({ freq: "WEEKLY", byDay: ["TU", "TH"] }));
});

describe("Thymosin M/W/F schedule", () => {
  const rule = "FREQ=WEEKLY;BYDAY=MO,WE,FR";
  it("due Mon/Wed/Fri, not Tue/Thu/Sat/Sun", () => {
    expect(isDueOn({ rule, date: d("2026-06-15") })).toBe(true); // Mon
    expect(isDueOn({ rule, date: d("2026-06-16") })).toBe(false); // Tue
    expect(isDueOn({ rule, date: d("2026-06-17") })).toBe(true); // Wed
    expect(isDueOn({ rule, date: d("2026-06-18") })).toBe(false); // Thu
    expect(isDueOn({ rule, date: d("2026-06-19") })).toBe(true); // Fri
    expect(isDueOn({ rule, date: d("2026-06-20") })).toBe(false); // Sat
  });
  it("weekdayCode is correct", () => expect(weekdayCode(d("2026-06-15"))).toBe("MO"));
});

describe("daily schedule + window", () => {
  it("daily is always due in-window", () => {
    expect(isDueOn({ rule: "FREQ=DAILY", date: d("2026-06-16") })).toBe(true);
  });
  it("respects start and end dates", () => {
    expect(isDueOn({ rule: "FREQ=DAILY", date: d("2026-06-10"), startDate: d("2026-06-15") })).toBe(false);
    expect(isDueOn({ rule: "FREQ=DAILY", date: d("2026-07-01"), endDate: d("2026-06-30") })).toBe(false);
  });
});

describe("BPC-157 titration (250 mcg ×14d → 400 mcg)", () => {
  const steps = [
    { stepIndex: 0, dose: "250", doseInputUnit: "mcg", durationDays: 14 },
    { stepIndex: 1, dose: "400", doseInputUnit: "mcg", durationDays: null },
  ];
  const startDate = d("2026-06-15");
  it("day 0 → 250 mcg", () => expect(activeStep({ steps, startDate, date: d("2026-06-15") })?.dose).toBe("250"));
  it("day 13 → still 250 mcg", () => expect(activeStep({ steps, startDate, date: d("2026-06-28") })?.dose).toBe("250"));
  it("day 14 → 400 mcg", () => expect(activeStep({ steps, startDate, date: d("2026-06-29") })?.dose).toBe("400"));
  it("far future → 400 mcg (indefinite)", () => expect(activeStep({ steps, startDate, date: d("2026-12-01") })?.dose).toBe("400"));
  it("before start → null", () => expect(activeStep({ steps, startDate, date: d("2026-06-14") })).toBeNull());
});

describe("occurrencesInRange", () => {
  // Local-date key (matches the app's local-midnight convention; avoids UTC offset skew).
  const k = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  it("lists weekly-by-day occurrences in a window", () => {
    const dates = occurrencesInRange({
      rule: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
      rangeStart: d("2026-06-14"),
      rangeEnd: d("2026-06-20"),
      startDate: d("2026-06-01"),
      endDate: null,
    }).map(k);
    expect(dates).toEqual(["2026-06-15", "2026-06-17", "2026-06-19"]);
  });
  it("lists daily occurrences and honours endDate", () => {
    const dates = occurrencesInRange({
      rule: "FREQ=DAILY",
      rangeStart: d("2026-06-14"),
      rangeEnd: d("2026-06-18"),
      startDate: d("2026-06-15"),
      endDate: d("2026-06-16"),
    }).map(k);
    expect(dates).toEqual(["2026-06-15", "2026-06-16"]);
  });
});
