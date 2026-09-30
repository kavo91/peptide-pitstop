import { describe, it, expect } from "vitest";
import {
  SAVED_FLASH_MS,
  savedFlashKey,
  savedFlashRemaining,
  stampSavedFlash,
} from "./saved-flash";

const T0 = 1_757_000_000_000; // arbitrary fixed epoch-ms "now"

describe("savedFlashKey", () => {
  it("separates the two editors that share one protocol id", () => {
    expect(savedFlashKey("protocol", "abc")).not.toBe(savedFlashKey("gantt-row", "abc"));
  });
  it("separates rows within one editor", () => {
    expect(savedFlashKey("protocol", "abc")).not.toBe(savedFlashKey("protocol", "def"));
  });
});

describe("savedFlashRemaining", () => {
  it("gives the full window to a stamp read back in the same instant — the remount case", () => {
    expect(savedFlashRemaining(stampSavedFlash(T0), T0)).toBe(SAVED_FLASH_MS);
  });

  it("counts down while the flash is live", () => {
    expect(savedFlashRemaining(stampSavedFlash(T0), T0 + 1000)).toBe(SAVED_FLASH_MS - 1000);
  });

  it("is spent exactly at the window edge", () => {
    expect(savedFlashRemaining(stampSavedFlash(T0), T0 + SAVED_FLASH_MS)).toBe(0);
  });

  it("is spent after the window — a stale 'Saved' never outlives it", () => {
    expect(savedFlashRemaining(stampSavedFlash(T0), T0 + SAVED_FLASH_MS + 1)).toBe(0);
    expect(savedFlashRemaining(stampSavedFlash(T0), T0 + 600_000)).toBe(0);
  });

  it("shows nothing when there is no stamp", () => {
    expect(savedFlashRemaining(null, T0)).toBe(0);
    expect(savedFlashRemaining("", T0)).toBe(0);
    expect(savedFlashRemaining("   ", T0)).toBe(0);
  });

  it("shows nothing for a stamp that is not a number", () => {
    expect(savedFlashRemaining("Saved", T0)).toBe(0);
    expect(savedFlashRemaining("NaN", T0)).toBe(0);
    expect(savedFlashRemaining("Infinity", T0)).toBe(0);
  });

  it("treats a future stamp as stale rather than pinning 'Saved' until the clock catches up", () => {
    expect(savedFlashRemaining(stampSavedFlash(T0 + 60_000), T0)).toBe(0);
  });

  it("honours an explicit window", () => {
    expect(savedFlashRemaining(stampSavedFlash(T0), T0 + 500, 2000)).toBe(1500);
    expect(savedFlashRemaining(stampSavedFlash(T0), T0 + 2500, 2000)).toBe(0);
  });
});
