import { describe, it, expect } from "vitest";
import {
  isValidTimeZone,
  dayKeyInTz,
  timeInTz,
  dayAnchor,
  sanitizeLocalDayTz,
  resolveTrackingDayStamp,
  zonedWallClockToInstant,
  trackingDayKeyInTz,
  previousDayKey,
  localeTimeLabel,
  LOCAL_DAY_RE,
} from "./tz-day";

// Example instant: 22:09 in America/Santiago (UTC-4 in July) = 2026-07-18
// 02:09 UTC = 2026-07-18 12:09 in Australia/Brisbane (UTC+10) — an evening
// dose west of the runtime zone crosses the runtime midnight.
const SAMPLE_INSTANT = new Date("2026-07-18T02:09:00Z");

describe("dayKeyInTz", () => {
  it("files the Chile-evening dose on the 17th in Santiago", () => {
    expect(dayKeyInTz(SAMPLE_INSTANT, "America/Santiago")).toBe("2026-07-17");
  });
  it("files the same instant on the 18th in Brisbane", () => {
    expect(dayKeyInTz(SAMPLE_INSTANT, "Australia/Brisbane")).toBe("2026-07-18");
  });
  it("handles UTC exactly", () => {
    expect(dayKeyInTz(SAMPLE_INSTANT, "UTC")).toBe("2026-07-18");
  });
});

describe("timeInTz", () => {
  it("renders the dose's own wall clock in Santiago", () => {
    expect(timeInTz(SAMPLE_INSTANT, "America/Santiago")).toBe("22:09");
  });
  it("renders Brisbane wall clock for the same instant", () => {
    expect(timeInTz(SAMPLE_INSTANT, "Australia/Brisbane")).toBe("12:09");
  });
  it("uses h23 (no 24:xx, no 12h clock) at midnight", () => {
    expect(timeInTz(new Date("2026-07-18T00:05:00Z"), "UTC")).toBe("00:05");
  });
});

describe("trackingDayKeyInTz", () => {
  it("uses the phone timezone for the two-hour midnight buffer", () => {
    // 05:59:59Z is 01:59:59 in Santiago but 15:59:59 in Brisbane.
    const instant = new Date("2026-07-24T05:59:59Z");
    expect(trackingDayKeyInTz(instant, "America/Santiago")).toBe("2026-07-23");
    expect(trackingDayKeyInTz(instant, "Australia/Brisbane")).toBe("2026-07-24");
  });

  it("rolls to the new phone-local day exactly at 02:00", () => {
    expect(trackingDayKeyInTz(new Date("2026-07-24T06:00:00Z"), "America/Santiago")).toBe("2026-07-24");
  });

  it("crosses month, year and leap-day boundaries safely", () => {
    expect(previousDayKey("2026-01-01")).toBe("2025-12-31");
    expect(previousDayKey("2028-03-01")).toBe("2028-02-29");
  });
});

describe("isValidTimeZone", () => {
  it("accepts real IANA zones", () => {
    expect(isValidTimeZone("America/Santiago")).toBe(true);
    expect(isValidTimeZone("Australia/Brisbane")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
  });
  it("rejects garbage and injection-shaped strings", () => {
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone("America/Santiago; DROP TABLE DoseLog")).toBe(false);
    expect(isValidTimeZone("<script>")).toBe(false);
    expect(isValidTimeZone("A".repeat(65))).toBe(false);
  });
});

describe("dayAnchor", () => {
  it("resolves back to the same runtime-TZ calendar day", () => {
    const d = dayAnchor("2026-07-17");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6);
    expect(d.getDate()).toBe(17);
    expect(d.getHours()).toBe(12);
  });
});

describe("sanitizeLocalDayTz", () => {
  it("passes a valid pair through", () => {
    expect(sanitizeLocalDayTz({ localDay: "2026-07-17", tz: "America/Santiago" })).toEqual({
      localDay: "2026-07-17",
      tz: "America/Santiago",
    });
  });
  it("nulls a malformed localDay but keeps a valid tz", () => {
    expect(sanitizeLocalDayTz({ localDay: "17/07/2026", tz: "UTC" })).toEqual({ localDay: null, tz: "UTC" });
    expect(sanitizeLocalDayTz({ localDay: "2026-13-40", tz: "UTC" }).localDay).toBeNull();
  });
  it("nulls an invalid tz but keeps a valid localDay", () => {
    expect(sanitizeLocalDayTz({ localDay: "2026-07-17", tz: "Mars/OlympusMons" })).toEqual({
      localDay: "2026-07-17",
      tz: null,
    });
  });
  it("returns nulls for empty input (legacy client)", () => {
    expect(sanitizeLocalDayTz({})).toEqual({ localDay: null, tz: null });
  });
  it("LOCAL_DAY_RE anchors the whole string", () => {
    expect(LOCAL_DAY_RE.test("2026-07-17T12:00")).toBe(false);
  });
  it("rejects day-of-month overflow that V8 would roll over instead of NaN-ing", () => {
    // new Date("2026-02-30T12:00:00") parses to Mar 2 (not NaN) — the
    // component round-trip must catch what the NaN check can't.
    expect(sanitizeLocalDayTz({ localDay: "2026-02-30", tz: "UTC" }).localDay).toBeNull();
    expect(sanitizeLocalDayTz({ localDay: "2026-04-31", tz: "UTC" }).localDay).toBeNull();
    expect(sanitizeLocalDayTz({ localDay: "2027-02-29", tz: "UTC" }).localDay).toBeNull();
    // Real leap day survives.
    expect(sanitizeLocalDayTz({ localDay: "2028-02-29", tz: "UTC" }).localDay).toBe("2028-02-29");
  });
  it("rejects non-string shapes instead of letting coercion smuggle them to Prisma", () => {
    expect(sanitizeLocalDayTz({ localDay: ["2026-07-18"] as unknown as string, tz: "UTC" }).localDay).toBeNull();
    expect(sanitizeLocalDayTz({ localDay: "2026-07-18", tz: ["America/Santiago"] as unknown as string }).tz).toBeNull();
  });
  it("bounds localDay near takenAt when an instant is provided", () => {
    const takenAt = new Date("2026-07-18T02:09:00Z");
    // The travel case: a UTC-4 Friday stamp for a runtime-Saturday instant.
    expect(sanitizeLocalDayTz({ localDay: "2026-07-17", tz: "America/Santiago" }, takenAt).localDay).toBe("2026-07-17");
    // A well-formed but absurd relabel is rejected (would be invisible in every view).
    expect(sanitizeLocalDayTz({ localDay: "0001-01-01", tz: "UTC" }, takenAt).localDay).toBeNull();
    expect(sanitizeLocalDayTz({ localDay: "2026-07-25", tz: "UTC" }, takenAt).localDay).toBeNull();
  });
});

describe("resolveTrackingDayStamp", () => {
  it("server-corrects a calendar-day client stamp using takenAt + phone timezone", () => {
    const takenAt = new Date("2026-07-24T05:03:00Z"); // 01:03 in Santiago
    expect(resolveTrackingDayStamp(
      { localDay: "2026-07-24", tz: "America/Santiago" },
      takenAt,
    )).toEqual({
      localDay: "2026-07-23",
      tz: "America/Santiago",
    });
  });

  it("keeps the sanitized client day as a fallback when no valid timezone exists", () => {
    const takenAt = new Date("2026-07-24T05:03:00Z");
    expect(resolveTrackingDayStamp({ localDay: "2026-07-24" }, takenAt)).toEqual({
      localDay: "2026-07-24",
      tz: null,
    });
  });
});

describe("localeTimeLabel", () => {
  it("uses one locale format for stamped and legacy rows", () => {
    const d = new Date("2026-07-18T02:09:00Z");
    const legacy = localeTimeLabel(d, null);
    const stampedHome = localeTimeLabel(d, "Australia/Brisbane");
    // Runtime TZ is Brisbane (vitest config) — same zone, so identical output.
    expect(stampedHome).toBe(legacy);
  });
  it("renders the dose's own wall clock for a foreign zone", () => {
    const label = localeTimeLabel(new Date("2026-07-18T02:09:00Z"), "America/Santiago");
    expect(label).toMatch(/10[:.]09|22[:.]09/); // 12h or 24h per runtime locale, but Chile wall clock
  });
  it("falls back to the runtime zone when a stored tz is rejected by ICU", () => {
    const d = new Date("2026-07-18T02:09:00Z");
    expect(localeTimeLabel(d, "Not/AZone")).toBe(localeTimeLabel(d, null));
  });
});

describe("zonedWallClockToInstant", () => {
  const at = (parts: { year: number; month: number; day: number; hour: number; minute: number }, tz: string) =>
    zonedWallClockToInstant(parts, tz).toISOString();

  it("reads a printed local time as the instant the clock there showed it", () => {
    expect(at({ year: 2024, month: 6, day: 12, hour: 9, minute: 17 }, "Australia/Brisbane")).toBe("2024-06-11T23:17:00.000Z");
    expect(at({ year: 2024, month: 6, day: 12, hour: 9, minute: 17 }, "Europe/London")).toBe("2024-06-12T08:17:00.000Z");
    expect(at({ year: 2024, month: 6, day: 12, hour: 9, minute: 17 }, "UTC")).toBe("2024-06-12T09:17:00.000Z");
  });

  it("uses the offset in force on the day, not today's", () => {
    // London: BST in July (UTC+1), GMT in January (UTC+0).
    expect(at({ year: 2026, month: 7, day: 1, hour: 12, minute: 0 }, "Europe/London")).toBe("2026-07-01T11:00:00.000Z");
    expect(at({ year: 2026, month: 1, day: 1, hour: 12, minute: 0 }, "Europe/London")).toBe("2026-01-01T12:00:00.000Z");
  });

  it("lands either side of a daylight-saving change correctly", () => {
    // New York springs forward at 02:00 on 8 March 2026.
    expect(at({ year: 2026, month: 3, day: 8, hour: 1, minute: 30 }, "America/New_York")).toBe("2026-03-08T06:30:00.000Z");
    expect(at({ year: 2026, month: 3, day: 8, hour: 3, minute: 30 }, "America/New_York")).toBe("2026-03-08T07:30:00.000Z");
  });

  it("still returns an instant for a wall-clock time the clock skipped", () => {
    // 02:30 never happens on that date in New York — the clock jumps 02:00 → 03:00.
    // It resolves to the moment before the gap (01:30 EST) rather than throwing.
    const skipped = at({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, "America/New_York");
    expect(skipped).toBe("2026-03-08T06:30:00.000Z");
  });

  it("round-trips through the day key it will be stored under", () => {
    const d = zonedWallClockToInstant({ year: 2024, month: 6, day: 12, hour: 23, minute: 45 }, "Australia/Brisbane");
    expect(dayKeyInTz(d, "Australia/Brisbane")).toBe("2024-06-12");
    // The same instant is still the 12th in UTC (13:45) and in New York (09:45).
    expect(dayKeyInTz(d, "America/New_York")).toBe("2024-06-12");
  });
});
