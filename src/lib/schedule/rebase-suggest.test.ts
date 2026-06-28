import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the DB so the suggestion runs against an in-memory protocol stub
// (mirrors src/lib/auth/ownership.test.ts).
const { protocolFindFirst } = vi.hoisted(() => ({ protocolFindFirst: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { protocol: { findFirst: protocolFindFirst } } }));

import { computeRebaseSuggestion } from "./rebase-suggest";

const USER = "user-1";
// M/W/F weekly, fixed-anchor — the real TA1 shape.
const MWF = { id: "p1", scheduleRule: "FREQ=WEEKLY;BYDAY=MO,WE,FR", rebaseMode: "fixed_anchor" };
// Local-constructed dates (TZ-independent): 2026-06-24 = Wed, 06-25 = Thu, 06-26 = Fri.
const WED = new Date(2026, 5, 24);
const THU = new Date(2026, 5, 25);

beforeEach(() => vi.clearAllMocks());

describe("computeRebaseSuggestion", () => {
  it("no protocol → undefined (no DB hit)", async () => {
    expect(await computeRebaseSuggestion({ protocolId: undefined, userId: USER, takenAt: THU, matchedPlanned: false })).toBeUndefined();
    expect(protocolFindFirst).not.toHaveBeenCalled();
  });

  it("THE FIX: on-plan dose (matchedPlanned) never prompts — even off the raw grid", async () => {
    // A Thursday dose is off the M/W/F grid, but it already linked to a planned
    // (e.g. already-shifted) slot. Must NOT re-offer a shift, and must not even
    // query the protocol.
    const out = await computeRebaseSuggestion({ protocolId: "p1", userId: USER, takenAt: THU, matchedPlanned: true });
    expect(out).toBeUndefined();
    expect(protocolFindFirst).not.toHaveBeenCalled();
  });

  it("off-grid dose with no planned match → suggests shifting the rest of the week", async () => {
    protocolFindFirst.mockResolvedValue(MWF);
    const out = await computeRebaseSuggestion({ protocolId: "p1", userId: USER, takenAt: THU, matchedPlanned: false });
    expect(out).toBeDefined();
    // Thu snaps to Wed (nearest grid, +1); the remaining Fri slot shifts to Sat.
    expect(out!.suggestedDays).toEqual(["SA"]);
    expect(out!.protocolId).toBe("p1");
  });

  it("on-grid dose (lands on a grid day) → undefined even when not plan-matched", async () => {
    protocolFindFirst.mockResolvedValue(MWF);
    const out = await computeRebaseSuggestion({ protocolId: "p1", userId: USER, takenAt: WED, matchedPlanned: false });
    expect(out).toBeUndefined();
  });

  it("non-fixed_anchor protocol → undefined", async () => {
    protocolFindFirst.mockResolvedValue({ ...MWF, rebaseMode: "rolling" });
    const out = await computeRebaseSuggestion({ protocolId: "p1", userId: USER, takenAt: THU, matchedPlanned: false });
    expect(out).toBeUndefined();
  });
});
