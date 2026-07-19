import { describe, it, expect } from "vitest";
import { shouldRefreshOnActive, dayRolled, MIN_REFRESH_INTERVAL_MS } from "./active-refresh";

describe("shouldRefreshOnActive", () => {
  it("refreshes when the interval has fully elapsed", () => {
    expect(shouldRefreshOnActive(100_000, 100_000 - MIN_REFRESH_INTERVAL_MS)).toBe(true);
  });
  it("suppresses a refresh inside the throttle window", () => {
    expect(shouldRefreshOnActive(100_000, 100_000 - MIN_REFRESH_INTERVAL_MS + 1)).toBe(false);
    expect(shouldRefreshOnActive(100_000, 100_000)).toBe(false);
  });
  it("honours a custom interval", () => {
    expect(shouldRefreshOnActive(10_000, 4_000, 5_000)).toBe(true);
    expect(shouldRefreshOnActive(10_000, 6_000, 5_000)).toBe(false);
  });
});

describe("dayRolled", () => {
  it("detects a midnight rollover", () => {
    expect(dayRolled("2026-07-17", "2026-07-18")).toBe(true);
  });
  it("is quiet within the same day", () => {
    expect(dayRolled("2026-07-17", "2026-07-17")).toBe(false);
  });
});
