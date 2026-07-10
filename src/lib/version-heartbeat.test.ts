import { describe, it, expect } from "vitest";
import { shouldReloadForVersion } from "./version-heartbeat";

describe("shouldReloadForVersion", () => {
  it("reloads when the served version differs from the running bundle", () => {
    expect(shouldReloadForVersion("1.1.9", "1.2.0", null)).toBe(true);
  });

  it("does not reload when versions match", () => {
    expect(shouldReloadForVersion("1.1.9", "1.1.9", null)).toBe(false);
  });

  it("does not reload twice for the same served version (loop guard)", () => {
    expect(shouldReloadForVersion("1.1.9", "1.2.0", "1.2.0")).toBe(false);
  });

  it("ignores garbage payloads", () => {
    expect(shouldReloadForVersion("1.1.9", undefined, null)).toBe(false);
    expect(shouldReloadForVersion("1.1.9", "", null)).toBe(false);
    expect(shouldReloadForVersion("1.1.9", 42, null)).toBe(false);
  });
});
