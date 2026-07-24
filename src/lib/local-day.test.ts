import { describe, it, expect } from "vitest";
import { localDayOf, trackingDayOf, deviceTimeZone } from "./local-day";

describe("localDayOf", () => {
  it("formats a mid-day date", () => {
    expect(localDayOf(new Date(2026, 6, 17, 12, 0))).toBe("2026-07-17");
  });
  it("stays on the local day right up to midnight", () => {
    expect(localDayOf(new Date(2026, 6, 17, 23, 59, 59))).toBe("2026-07-17");
    expect(localDayOf(new Date(2026, 6, 18, 0, 0, 0))).toBe("2026-07-18");
  });
  it("zero-pads single-digit months and days", () => {
    expect(localDayOf(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("trackingDayOf", () => {
  it("keeps phone-local midnight through 01:59 on the preceding day", () => {
    expect(trackingDayOf(new Date(2026, 6, 24, 0, 0, 0))).toBe("2026-07-23");
    expect(trackingDayOf(new Date(2026, 6, 24, 1, 59, 59, 999))).toBe("2026-07-23");
  });

  it("rolls to the new tracking day exactly at 02:00", () => {
    expect(trackingDayOf(new Date(2026, 6, 24, 2, 0, 0))).toBe("2026-07-24");
  });

  it("handles month and year boundaries", () => {
    expect(trackingDayOf(new Date(2026, 0, 1, 1, 30))).toBe("2025-12-31");
    expect(trackingDayOf(new Date(2028, 2, 1, 0, 30))).toBe("2028-02-29");
  });
});

describe("deviceTimeZone", () => {
  it("returns a non-empty IANA-looking string in this runtime", () => {
    const tz = deviceTimeZone();
    expect(typeof tz).toBe("string");
    expect((tz as string).length).toBeGreaterThan(0);
  });
});
