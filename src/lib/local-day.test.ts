import { describe, it, expect } from "vitest";
import { localDayOf, deviceTimeZone } from "./local-day";

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

describe("deviceTimeZone", () => {
  it("returns a non-empty IANA-looking string in this runtime", () => {
    const tz = deviceTimeZone();
    expect(typeof tz).toBe("string");
    expect((tz as string).length).toBeGreaterThan(0);
  });
});
