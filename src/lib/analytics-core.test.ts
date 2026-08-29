import { describe, it, expect } from "vitest";
import { adherenceOverWindow, heatmapBuckets, buildExposureRollup } from "./analytics-core";

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

  it("buckets a stamped late-night dose by its phone-local tracking day", () => {
    const logs = [
      {
        // Runtime day is June 2, but the phone's 01:03 grace-period stamp is June 1.
        takenAt: new Date("2026-06-02T15:03:00"),
        localDay: "2026-06-01",
      },
    ];
    const buckets = heatmapBuckets({ logs, window });
    const byKey = Object.fromEntries(buckets.map((b) => [b.dateKey, b.count]));
    expect(byKey["2026-06-01"]).toBe(1);
    expect(byKey["2026-06-02"]).toBe(0);
  });

  it("dateKey uses the Monday-first KEY convention (YYYY-MM-DD, zero-padded)", () => {
    const buckets = heatmapBuckets({ logs: [], window: { from: new Date("2026-06-09T00:00:00"), to: new Date("2026-06-09T23:59:59") } });
    expect(buckets[0].dateKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("buildExposureRollup — the 'all time' cumulative exposure table", () => {
  const ref = (peptideId: string, name: string) => ({ peptideId, name });
  const base = () => ({
    prepPeptide: new Map([
      ["prep-a", ref("pep-a", "Alpha")],
      ["prep-b", ref("pep-b", "Beta")],
      ["prep-blend", ref("pep-blend", "Blendo")],
    ]),
    protoPeptide: new Map([
      ["proto-a", ref("pep-a", "Alpha")],
      ["proto-b", ref("pep-b", "Beta")],
    ]),
    componentsByBlendId: new Map<string, { name: string; mg: number }[]>([
      ["pep-blend", [{ name: "Alpha", mg: 30 }, { name: "Gamma", mg: 10 }]],
    ]),
  });
  const find = (rows: ReturnType<typeof buildExposureRollup>, name: string) =>
    rows.find((r) => r.peptideName === name);

  it("counts an AD-HOC dose — no protocol — which the protocol-only query dropped", () => {
    const rows = buildExposureRollup({
      ...base(),
      doseSums: [
        { preparationId: "prep-a", protocolId: "proto-a", totalMcg: 1000 },
        { preparationId: "prep-a", protocolId: null, totalMcg: 250 },
      ],
    });
    expect(find(rows, "Alpha")!.totalMcg).toBe(1250);
  });

  it("resolves PREPARATION-first when preparation and protocol disagree, matching the exports", () => {
    const rows = buildExposureRollup({
      ...base(),
      // Logged against Beta's protocol but drawn from an Alpha preparation.
      doseSums: [{ preparationId: "prep-a", protocolId: "proto-b", totalMcg: 400 }],
    });
    expect(find(rows, "Alpha")!.totalMcg).toBe(400);
    expect(find(rows, "Beta")).toBeUndefined();
  });

  it("falls back to the protocol when the dose has no preparation", () => {
    const rows = buildExposureRollup({
      ...base(),
      doseSums: [{ preparationId: null, protocolId: "proto-b", totalMcg: 700 }],
    });
    expect(find(rows, "Beta")!.totalMcg).toBe(700);
  });

  it("skips a dose that resolves to neither, rather than inventing a row", () => {
    const rows = buildExposureRollup({
      ...base(),
      doseSums: [
        { preparationId: "gone", protocolId: "also-gone", totalMcg: 999 },
        { preparationId: null, protocolId: null, totalMcg: 999 },
        { preparationId: "prep-a", protocolId: null, totalMcg: 100 },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(find(rows, "Alpha")!.totalMcg).toBe(100);
  });

  it("expands a BLEND parent's mass into its components instead of listing the blend", () => {
    const rows = buildExposureRollup({
      ...base(),
      // 40 mg of blend = 75% Alpha, 25% Gamma.
      doseSums: [{ preparationId: "prep-blend", protocolId: null, totalMcg: 4000 }],
    });
    expect(find(rows, "Blendo")).toBeUndefined();
    expect(find(rows, "Alpha")).toMatchObject({ standaloneMcg: 0, blendMcg: 3000, totalMcg: 3000, hasDerived: true });
    expect(find(rows, "Gamma")).toMatchObject({ blendMcg: 1000, totalMcg: 1000, hasDerived: true });
  });

  it("merges blend-delivered mass onto the same compound's standalone history", () => {
    const rows = buildExposureRollup({
      ...base(),
      doseSums: [
        { preparationId: "prep-a", protocolId: "proto-a", totalMcg: 500 },
        { preparationId: "prep-blend", protocolId: null, totalMcg: 4000 },
      ],
    });
    expect(find(rows, "Alpha")).toMatchObject({
      standaloneMcg: 500,
      blendMcg: 3000,
      totalMcg: 3500,
      hasDerived: true,
    });
  });

  it("ACCUMULATES two distinct peptide ids that share a name — never drops one", () => {
    const rows = buildExposureRollup({
      prepPeptide: new Map([
        ["prep-1", ref("pep-1", "Alpha")],
        ["prep-2", ref("pep-2", "Alpha")], // same NAME, different id — no unique constraint
      ]),
      protoPeptide: new Map(),
      componentsByBlendId: new Map(),
      doseSums: [
        { preparationId: "prep-1", protocolId: null, totalMcg: 1000 },
        { preparationId: "prep-2", protocolId: null, totalMcg: 500 },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(find(rows, "Alpha")!.totalMcg).toBe(1500);
  });

  it("sorts by total mass descending", () => {
    const rows = buildExposureRollup({
      ...base(),
      doseSums: [
        { preparationId: "prep-a", protocolId: null, totalMcg: 100 },
        { preparationId: "prep-b", protocolId: null, totalMcg: 900 },
      ],
    });
    expect(rows.map((r) => r.peptideName)).toEqual(["Beta", "Alpha"]);
  });
});
