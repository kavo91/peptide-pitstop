import { beforeEach, describe, expect, it, vi } from "vitest";

const { protocolFindMany, doseLogFindMany, computeShiftPlanMock } = vi.hoisted(() => ({
  protocolFindMany: vi.fn(),
  doseLogFindMany: vi.fn(),
  computeShiftPlanMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    protocol: { findMany: protocolFindMany },
    doseLog: { findMany: doseLogFindMany },
  },
}));

vi.mock("server-only", () => ({}));

// Wrap (not replace) the real engine: by default every call is forwarded to
// the actual `computeShiftPlan`, so most tests exercise real eligibility/
// plan-building logic while letting us inspect exactly what the loader built
// (`computeShiftPlanMock.mock.calls`). One test overrides it with
// `mockImplementationOnce` to prove an engine throw never escapes the loader.
vi.mock("@/lib/schedule/shift-suggest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/schedule/shift-suggest")>();
  computeShiftPlanMock.mockImplementation((args: Parameters<typeof actual.computeShiftPlan>[0]) =>
    actual.computeShiftPlan(args),
  );
  return { ...actual, computeShiftPlan: computeShiftPlanMock };
});

import { getShiftPanelData } from "./server";

const USER = "user-1";
// Local-midnight construction, same house style as shift-suggest.test.ts —
// vitest pins TZ=Australia/Brisbane. Fri 2026-09-04.
const TODAY = new Date(2026, 8, 4);

const weeklyRule = (byDays: string[], times: string[] = []) =>
  JSON.stringify([{ dayPattern: { kind: "weekly", byDays }, times }]);

function protoRow(over: Record<string, unknown> & { id: string; peptideName?: string }) {
  const { peptideName, ...rest } = over;
  return {
    name: rest.id,
    status: "active",
    scheduleRule: weeklyRule(["MO", "WE", "FR"], ["07:00"]),
    startDate: new Date(2026, 0, 1),
    endDate: null,
    cycleOnWeeks: null,
    cycleOffWeeks: null,
    cycleAnchor: null,
    stackId: null,
    shiftPinned: false,
    peptide: { name: peptideName ?? `${rest.id}-peptide` },
    ...rest,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  doseLogFindMany.mockResolvedValue([]);
});

describe("getShiftPanelData", () => {
  it("builds loggedDayKeys per protocol — dedupes, localDay wins over takenAt, takenAt is the fallback", async () => {
    protocolFindMany.mockResolvedValue([protoRow({ id: "P1" })]);
    doseLogFindMany.mockResolvedValue([
      // Plain localDay row.
      { protocolId: "P1", localDay: "2026-08-10", takenAt: new Date("2026-08-10T09:00:00.000Z") },
      // localDay must win even though takenAt's UTC date ("2026-09-02") differs.
      { protocolId: "P1", localDay: "2026-09-03", takenAt: new Date("2026-09-02T23:00:00.000Z") },
      // A second dose the same tracking day — must collapse into one key.
      { protocolId: "P1", localDay: "2026-09-03", takenAt: new Date("2026-09-03T01:00:00.000Z") },
      // No localDay (legacy row/client) — falls back to takenAt's UTC date.
      { protocolId: "P1", localDay: null, takenAt: new Date("2026-09-01T04:00:00.000Z") },
      // A different protocol's dose must never leak into P1's keys.
      { protocolId: "OTHER", localDay: "2026-09-04", takenAt: new Date("2026-09-04T00:00:00.000Z") },
    ]);

    await getShiftPanelData(USER, TODAY);

    const passed = computeShiftPlanMock.mock.calls[0][0].protocols as { id: string; loggedDayKeys: string[] }[];
    const p1 = passed.find((p) => p.id === "P1")!;
    // 4 raw P1 rows dedupe to 3 distinct day keys.
    expect(p1.loggedDayKeys).toHaveLength(3);
    expect(new Set(p1.loggedDayKeys)).toEqual(new Set(["2026-08-10", "2026-09-03", "2026-09-01"]));
  });

  // cycleOffWeeks is load-bearing, not decoration: courseEnd() reads it to tell
  // a terminal cycle plan from a repeating one. Dropping it here would
  // silently reinstate the "repeating course ends within a week for ever" bug.
  it("passes cycleOnWeeks, cycleOffWeeks, cycleAnchor, stackId and shiftPinned through unchanged", async () => {
    const anchor = new Date(2026, 7, 1);
    protocolFindMany.mockResolvedValue([
      protoRow({
        id: "P1",
        peptideName: "Retatrutide",
        cycleOnWeeks: 8,
        cycleOffWeeks: 4,
        cycleAnchor: anchor,
        stackId: "stack-99",
        shiftPinned: true,
      }),
    ]);

    await getShiftPanelData(USER, TODAY);

    const passed = computeShiftPlanMock.mock.calls[0][0].protocols as {
      id: string;
      name: string;
      peptideName: string;
      cycleOnWeeks: number | null;
      cycleOffWeeks: number | null;
      cycleAnchor: Date | null;
      stackId: string | null;
      shiftPinned: boolean;
    }[];
    const p1 = passed.find((p) => p.id === "P1")!;
    expect(p1.name).toBe("P1");
    expect(p1.peptideName).toBe("Retatrutide");
    expect(p1.cycleOnWeeks).toBe(8);
    expect(p1.cycleOffWeeks).toBe(4);
    expect(p1.cycleAnchor).toEqual(anchor);
    expect(p1.stackId).toBe("stack-99");
    expect(p1.shiftPinned).toBe(true);
  });

  it("fills pinned and ineligible with display names from the joined protocol rows", async () => {
    protocolFindMany.mockResolvedValue([
      protoRow({ id: "P-STACK", peptideName: "BPC-157", stackId: "stack-1" }),
      protoRow({ id: "P-PIN", peptideName: "TB-500", shiftPinned: true }),
    ]);

    const result = await getShiftPanelData(USER, TODAY);

    expect(result.unavailable).toBe(false);
    expect(result.ineligible).toEqual([
      { protocolId: "P-STACK", name: "P-STACK", peptideName: "BPC-157", reason: "stack" },
    ]);
    expect(result.pinned).toEqual([{ protocolId: "P-PIN", name: "P-PIN", peptideName: "TB-500" }]);
  });

  it("an engine throw never escapes — returns an empty, unavailable plan", async () => {
    protocolFindMany.mockResolvedValue([protoRow({ id: "P1" })]);
    computeShiftPlanMock.mockImplementationOnce(() => {
      throw new Error("boom");
    });

    const result = await getShiftPanelData(USER, TODAY);

    expect(result.unavailable).toBe(true);
    // Even the fallback plan labels its strip from the engine's own rule
    // (the first Monday on/after today — Fri 2026-09-04 → Mon 2026-09-07).
    expect(result.plan).toEqual({
      current: [0, 0, 0, 0, 0, 0, 0],
      weekStart: "2026-09-07",
      suggestions: [],
      combined: null,
      skipped: [],
      pinned: [],
    });
    expect(result.pinned).toEqual([]);
    expect(result.ineligible).toEqual([]);
  });

  it("today is the viewer day key for the date passed in", async () => {
    protocolFindMany.mockResolvedValue([]);
    const result = await getShiftPanelData(USER, TODAY);
    expect(result.today).toBe("2026-09-04");
  });

  // Both queries this loader runs must be scoped to the VIEWER's own
  // userId — never a global protocol/doseLog scan.
  it("scopes both queries to the viewer's own userId", async () => {
    protocolFindMany.mockResolvedValue([]);
    await getShiftPanelData(USER, TODAY);

    expect(protocolFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: USER, status: "active" }) }),
    );
    expect(doseLogFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: USER }) }),
    );
  });
});
