import { describe, it, expect } from "vitest";
import { bucketOf } from "./protocol-bucket";
import { startOfDay } from "@/lib/schedule/schedule";

/**
 * Fixtures are synthetic. The reference "today" is fixed so the boundary cases
 * (starts today / ends today) stay deterministic rather than drifting with the
 * clock.
 */
const today = startOfDay(new Date("2030-06-15T09:30:00"));
const d = (s: string) => new Date(`${s}T00:00:00`);

describe("bucketOf", () => {
  it("status wins over dates: completed stays completed even with a future endDate", () => {
    // Guards a real shape: a protocol closed by hand while its endDate still
    // points forward must not be dragged back into an active bucket.
    expect(bucketOf({ status: "completed", startDate: d("2030-05-01"), endDate: d("2030-08-01") }, today))
      .toBe("completed");
  });

  it("status wins over dates: paused stays paused mid-window", () => {
    expect(bucketOf({ status: "paused", startDate: d("2030-06-01"), endDate: d("2030-07-30") }, today))
      .toBe("paused");
  });

  it("a protocol queued to start later is scheduled, not active", () => {
    expect(bucketOf({ status: "active", startDate: d("2030-06-29"), endDate: d("2030-07-23") }, today))
      .toBe("scheduled");
  });

  it("starting today counts as active, not scheduled", () => {
    expect(bucketOf({ status: "active", startDate: d("2030-06-15"), endDate: d("2030-07-10") }, today))
      .toBe("active");
  });

  it("running inside its window is active", () => {
    expect(bucketOf({ status: "active", startDate: d("2030-06-10"), endDate: d("2030-06-24") }, today))
      .toBe("active");
  });

  it("ending today is still active, not ended", () => {
    expect(bucketOf({ status: "active", startDate: d("2030-06-01"), endDate: d("2030-06-15") }, today))
      .toBe("active");
  });

  it("active but past its end date lands in ended", () => {
    expect(bucketOf({ status: "active", startDate: d("2030-05-01"), endDate: d("2030-06-14") }, today))
      .toBe("ended");
  });

  it("null dates fall through to active", () => {
    expect(bucketOf({ status: "active", startDate: null, endDate: null }, today)).toBe("active");
  });

  it("open-ended protocol with only a past startDate is active", () => {
    expect(bucketOf({ status: "active", startDate: d("2030-04-01"), endDate: null }, today)).toBe("active");
  });

  it("accepts ISO strings as well as Date objects", () => {
    expect(bucketOf({ status: "active", startDate: "2030-06-29", endDate: "2030-07-23" }, today))
      .toBe("scheduled");
  });

  it("scheduled takes precedence over ended when both would apply", () => {
    // Degenerate data (start after end); scheduled is the safer read — it keeps
    // the protocol visible as upcoming rather than filing it away as finished.
    expect(bucketOf({ status: "active", startDate: d("2030-06-29"), endDate: d("2030-06-01") }, today))
      .toBe("scheduled");
  });

  it("sorts a mixed set into every bucket", () => {
    const set = [
      { name: "running", status: "active", startDate: d("2030-06-15"), endDate: d("2030-07-10") },
      { name: "openEnded", status: "active", startDate: d("2030-04-01"), endDate: null },
      { name: "queued", status: "active", startDate: d("2030-06-29"), endDate: d("2030-07-23") },
      { name: "onHold", status: "paused", startDate: d("2030-06-01"), endDate: d("2030-07-30") },
      { name: "overrun", status: "active", startDate: d("2030-05-01"), endDate: d("2030-06-14") },
      { name: "finished", status: "completed", startDate: d("2030-05-01"), endDate: d("2030-08-01") },
    ];
    expect(Object.fromEntries(set.map((p) => [p.name, bucketOf(p, today)]))).toEqual({
      running: "active",
      openEnded: "active",
      queued: "scheduled",
      onHold: "paused",
      overrun: "ended",
      finished: "completed",
    });
  });
});
