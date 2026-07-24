import { describe, expect, it } from "vitest";
import { doseTakenAt } from "./dose-clock";

describe("doseTakenAt", () => {
  const serverNow = new Date("2026-07-24T05:03:12.345Z");

  it("uses the server UTC instant for an untouched Log now action", () => {
    const clientClock = "2026-07-24T05:01:00.000Z";
    expect(doseTakenAt(clientClock, true, serverNow)).toBe(serverNow);
  });

  it("preserves an explicitly selected historical instant", () => {
    const selected = "2026-07-23T18:30:00.000Z";
    expect(doseTakenAt(selected, false, serverNow).toISOString()).toBe(selected);
  });

  it("uses the server instant when a legacy client supplies no timestamp", () => {
    expect(doseTakenAt(undefined, false, serverNow)).toBe(serverNow);
  });
});
