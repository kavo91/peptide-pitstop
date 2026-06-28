import { describe, it, expect } from "vitest";
import { adherenceOverWindow, heatmapBuckets } from "./analytics-core";

// ── adherenceOverWindow ────────────────────────────────────────────────────

describe("adherenceOverWindow", () => {
  const window = {
    from: new Date("2026-05-01T00:00:00"),
    to: new Date("2026-05-31T23:59:59"),
  };

  it("returns null adherence and 0 days when no planned rows exist", () => {
    const r = adherenceOverWindow({ planned: [], logs: [], window });
    expect(r.adherencePct).toBeNull();
    expect(r.daysOfData).toBe(0);
    expect(r.taken).toBe(0);
    expect(r.missed).toBe(0);
  });

  it("100% when all planned rows are taken", () => {
    const planned = [
      { scheduledAt: new Date("2026-05-01T08:00:00"), status: "taken" as const },
      { scheduledAt: new Date("2026-05-08T08:00:00"), status: "taken" as const },
    ];
    const r = adherenceOverWindow({ planned, logs: [], window });
    expect(r.adherencePct).toBe(100);
    expect(r.taken).toBe(2);
    expect(r.missed).toBe(0);
  });

  it("50% when half missed, half taken", () => {
    const planned = [
      { scheduledAt: new Date("2026-05-01T08:00:00"), status: "taken" as const },
      { scheduledAt: new Date("2026-05-08T08:00:00"), status: "missed" as const },
      { scheduledAt: new Date("2026-05-15T08:00:00"), status: "taken" as const },
      { scheduledAt: new Date("2026-05-22T08:00:00"), status: "missed" as const },
    ];
    const r = adherenceOverWindow({ planned, logs: [], window });
    expect(r.adherencePct).toBe(50);
    expect(r.taken).toBe(2);
    expect(r.missed).toBe(2);
  });

  it("planned and skipped rows are excluded from taken+missed count", () => {
    const planned = [
      { scheduledAt: new Date("2026-05-01T08:00:00"), status: "taken" as const },
      { scheduledAt: new Date("2026-05-08T08:00:00"), status: "planned" as const },
      { scheduledAt: new Date("2026-05-15T08:00:00"), status: "skipped" as const },
    ];
    const r = adherenceOverWindow({ planned, logs: [], window });
    // Only 1 taken, 0 missed → 100%
    expect(r.adherencePct).toBe(100);
    expect(r.taken).toBe(1);
    expect(r.missed).toBe(0);
  });

  it("daysOfData spans from earliest to latest plannedDose scheduledAt (inclusive)", () => {
    const planned = [
      { scheduledAt: new Date("2026-05-01T08:00:00"), status: "taken" as const },
      { scheduledAt: new Date("2026-05-15T08:00:00"), status: "taken" as const },
    ];
    const r = adherenceOverWindow({ planned, logs: [], window });
    // May 1 → May 15 = 15 days inclusive
    expect(r.daysOfData).toBe(15);
  });

  it("filters planned rows outside the window", () => {
    const planned = [
      { scheduledAt: new Date("2026-04-01T08:00:00"), status: "taken" as const }, // before window
      { scheduledAt: new Date("2026-05-10T08:00:00"), status: "taken" as const }, // in window
      { scheduledAt: new Date("2026-06-01T08:00:00"), status: "missed" as const }, // after window
    ];
    const r = adherenceOverWindow({ planned, logs: [], window });
    expect(r.taken).toBe(1);
    expect(r.missed).toBe(0);
  });
});

// ── heatmapBuckets ─────────────────────────────────────────────────────────

describe("heatmapBuckets", () => {
  const window = {
    from: new Date("2026-06-01T00:00:00"),
    to: new Date("2026-06-07T23:59:59"),
  };

  it("returns a bucket per day in the window, all zero when no logs", () => {
    const buckets = heatmapBuckets({ logs: [], window });
    expect(buckets).toHaveLength(7);
    expect(buckets.every((b) => b.count === 0)).toBe(true);
    expect(buckets[0].dateKey).toBe("2026-06-01");
    expect(buckets[6].dateKey).toBe("2026-06-07");
  });

  it("counts logs that fall on their takenAt day", () => {
    const logs = [
      { takenAt: new Date("2026-06-01T07:00:00") },
      { takenAt: new Date("2026-06-01T19:00:00") },
      { takenAt: new Date("2026-06-03T08:00:00") },
    ];
    const buckets = heatmapBuckets({ logs, window });
    const byKey = Object.fromEntries(buckets.map((b) => [b.dateKey, b.count]));
    expect(byKey["2026-06-01"]).toBe(2);
    expect(byKey["2026-06-02"]).toBe(0);
    expect(byKey["2026-06-03"]).toBe(1);
  });

  it("excludes logs outside the window", () => {
    const logs = [
      { takenAt: new Date("2026-05-31T23:59:00") }, // before
      { takenAt: new Date("2026-06-08T00:01:00") }, // after
      { takenAt: new Date("2026-06-04T12:00:00") }, // in window
    ];
    const buckets = heatmapBuckets({ logs, window });
    const total = buckets.reduce((s, b) => s + b.count, 0);
    expect(total).toBe(1);
  });

  it("dateKey uses the Monday-first KEY convention (YYYY-MM-DD, zero-padded)", () => {
    const buckets = heatmapBuckets({ logs: [], window: { from: new Date("2026-06-09T00:00:00"), to: new Date("2026-06-09T23:59:59") } });
    expect(buckets[0].dateKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
