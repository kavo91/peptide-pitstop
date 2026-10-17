import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const m = vi.hoisted(() => ({
  currentUser: vi.fn(),
  aggregate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: { wearableDaily: { aggregate: m.aggregate } } }));
vi.mock("@/lib/auth/owner", () => ({ getCurrentUser: m.currentUser }));

import { POST } from "./route";

const sidecar = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", sidecar);
  m.currentUser.mockResolvedValue({ id: "owner" });
  m.aggregate.mockResolvedValue({ _max: { syncedAt: new Date("2026-06-20T08:00:00.000Z") } });
  sidecar.mockResolvedValue(new Response('{"ok":true,"status":"started"}', { status: 202 }));
});

afterEach(() => vi.unstubAllGlobals());

describe("POST /api/wellness/sync-now", () => {
  it("401 before any DB read or sidecar kick when signed out", async () => {
    m.currentUser.mockResolvedValueOnce(null);
    const res = await POST();
    expect(res.status).toBe(401);
    expect(m.aggregate).not.toHaveBeenCalled();
    expect(sidecar).not.toHaveBeenCalled();
  });

  it("returns the newest Garmin syncedAt as the baseline, read BEFORE the kick", async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, baseline: "2026-06-20T08:00:00.000Z" });
    expect(m.aggregate.mock.calls[0][0].where).toEqual({ userId: "owner", source: "garmin" });
    expect(m.aggregate.mock.invocationCallOrder[0]).toBeLessThan(sidecar.mock.invocationCallOrder[0]);
  });

  it("baseline is null when no Garmin day has ever synced", async () => {
    m.aggregate.mockResolvedValueOnce({ _max: { syncedAt: null } });
    const res = await POST();
    expect(await res.json()).toEqual({ ok: true, baseline: null });
  });

  it("502 with the sidecar status when the sidecar refuses", async () => {
    sidecar.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    const res = await POST();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: "Sidecar error (500)" });
  });

  it("502 when the sidecar is unreachable", async () => {
    sidecar.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const res = await POST();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: "Could not reach garmin-sync" });
  });
});
