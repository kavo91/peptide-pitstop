import { describe, it, expect } from "vitest";
import { syncNowMessages } from "./sync-now-messages";

describe("syncNowMessages", () => {
  it("old-style answer (Garmin only, no new fields) reads exactly as before", () => {
    expect(syncNowMessages({})).toEqual({
      source: "garmin",
      other: null,
      waiting: "Getting your latest Garmin data",
      slow: "Garmin is still working. New data will show the next time you open this page",
      doneNote: "",
    });
  });

  it("both started → waits on Garmin, names both, also watches Eight Sleep", () => {
    const m = syncNowMessages({ source: "garmin", garmin: "started", eightSleep: "started" });
    expect(m).toMatchObject({ source: "garmin", other: "eight_sleep", waiting: "Getting your latest Garmin and Eight Sleep data", doneNote: "" });
  });

  it("Garmin started, Eight Sleep not set up → Garmin only, no mention of Eight Sleep", () => {
    const m = syncNowMessages({ source: "garmin", garmin: "started", eightSleep: "unavailable" });
    expect(m).toMatchObject({ other: null, waiting: "Getting your latest Garmin data", doneNote: "" });
  });

  it("Eight Sleep only user (Garmin not set up) → no Garmin complaint", () => {
    const m = syncNowMessages({ source: "eight_sleep", garmin: "unavailable", eightSleep: "started" });
    expect(m).toMatchObject({ source: "eight_sleep", other: null, waiting: "Getting your latest Eight Sleep data", doneNote: "" });
    expect(m.slow.startsWith("Eight Sleep is still working")).toBe(true);
  });

  it("Garmin refused → says so while waiting, when slow, and when done", () => {
    const m = syncNowMessages({ source: "eight_sleep", garmin: "failed", eightSleep: "started" });
    expect(m.waiting).toBe("Getting your latest Eight Sleep data · Garmin did not start");
    expect(m.slow.endsWith(" · Garmin did not start")).toBe(true);
    expect(m.doneNote).toBe(" · Garmin did not start");
  });

  it("Eight Sleep refused while Garmin started → says so", () => {
    expect(syncNowMessages({ source: "garmin", garmin: "started", eightSleep: "failed" }).doneNote).toBe(" · Eight Sleep did not start");
  });
});
