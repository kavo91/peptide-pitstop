import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  currentUser: vi.fn(),
  aggregate: vi.fn(),
  count: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: { wearableDaily: { aggregate: m.aggregate, count: m.count } } }));
vi.mock("@/lib/auth/owner", () => ({ getCurrentUser: m.currentUser }));

import { GET } from "./route";

const call = (qs = "") => GET(new Request(`http://localhost/api/wellness/sync-status${qs}`));

beforeEach(() => {
  vi.clearAllMocks();
  m.currentUser.mockResolvedValue({ id: "owner" });
  m.aggregate.mockResolvedValue({ _max: { syncedAt: new Date("2026-06-20T08:00:16.000Z") } });
  m.count.mockResolvedValue(3);
});

describe("GET /api/wellness/sync-status", () => {
  it("401 before any lookup when signed out", async () => {
    m.currentUser.mockResolvedValueOnce(null);
    const res = await call();
    expect(res.status).toBe(401);
    expect(m.aggregate).not.toHaveBeenCalled();
    expect(m.count).not.toHaveBeenCalled();
  });

  it("400 on an unparseable since", async () => {
    const res = await call("?since=not-a-date");
    expect(res.status).toBe(400);
    expect(m.aggregate).not.toHaveBeenCalled();
  });

  it("counts only this user's Garmin days written after since, uncached", async () => {
    const res = await call("?since=2026-06-20T08%3A00%3A00.000Z");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, latestSyncedAt: "2026-06-20T08:00:16.000Z", updated: 3 });
    expect(m.aggregate.mock.calls[0][0].where).toEqual({ userId: "owner", source: "garmin" });
    expect(m.count.mock.calls[0][0].where).toEqual({
      userId: "owner",
      source: "garmin",
      syncedAt: { gt: new Date("2026-06-20T08:00:00.000Z") },
    });
  });

  it("without since (first-ever sync) counts every Garmin day", async () => {
    await call();
    expect(m.count.mock.calls[0][0].where).toEqual({ userId: "owner", source: "garmin" });
  });

  it("latestSyncedAt is null when nothing has synced yet", async () => {
    m.aggregate.mockResolvedValueOnce({ _max: { syncedAt: null } });
    m.count.mockResolvedValueOnce(0);
    const res = await call();
    expect(await res.json()).toEqual({ ok: true, latestSyncedAt: null, updated: 0 });
  });
});
