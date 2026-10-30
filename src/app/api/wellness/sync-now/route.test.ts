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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const GARMIN_URL = "http://garmin-sync:8080/sync";
const EIGHT_URL = "http://localhost:8081/sync";
const ok = () => new Response('{"ok":true,"status":"started"}', { status: 202 });
/** Route each sidecar URL to its own outcome. */
function sidecars(garmin: () => Promise<Response>, eight: () => Promise<Response>) {
  sidecar.mockImplementation((url: string) => (url === EIGHT_URL ? eight() : garmin()));
}
const refused = () => Promise.reject(new Error("ECONNREFUSED"));

describe("POST /api/wellness/sync-now", () => {
  it("401 before any DB read or sidecar kick when signed out", async () => {
    m.currentUser.mockResolvedValueOnce(null);
    const res = await POST();
    expect(res.status).toBe(401);
    expect(m.aggregate).not.toHaveBeenCalled();
    expect(sidecar).not.toHaveBeenCalled();
  });

  it("kicks both sidecars; waits on Garmin with its baseline, read BEFORE any kick", async () => {
    m.aggregate.mockImplementation(async ({ where }: { where: { source: string } }) => ({
      _max: { syncedAt: new Date(where.source === "garmin" ? "2026-06-20T10:00:00.000Z" : "2026-06-20T09:00:00.000Z") },
    }));
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      source: "garmin",
      baseline: "2026-06-20T10:00:00.000Z",
      otherBaseline: "2026-06-20T09:00:00.000Z",
      garmin: "started",
      eightSleep: "started",
    });
    expect(m.aggregate.mock.calls.map((c) => c[0].where)).toEqual([
      { userId: "owner", source: "garmin" },
      { userId: "owner", source: "eight_sleep" },
    ]);
    expect(sidecar.mock.calls.map((c) => c[0]).sort()).toEqual([GARMIN_URL, EIGHT_URL].sort());
    const lastRead = Math.max(...m.aggregate.mock.invocationCallOrder);
    expect(lastRead).toBeLessThan(Math.min(...sidecar.mock.invocationCallOrder));
  });

  it("both kicks carry a timeout so a hung sidecar can't hold the button", async () => {
    await POST();
    for (const url of [GARMIN_URL, EIGHT_URL]) {
      expect(sidecar.mock.calls.find((c) => c[0] === url)![1].signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("baseline is null when no Garmin day has ever synced", async () => {
    m.aggregate.mockResolvedValue({ _max: { syncedAt: null } });
    const res = await POST();
    expect(await res.json()).toMatchObject({ ok: true, source: "garmin", baseline: null });
  });

  it("Garmin only (Eight Sleep sidecar not running) → ok, waits on Garmin", async () => {
    sidecars(async () => ok(), refused);
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, source: "garmin", garmin: "started", eightSleep: "unavailable" });
  });

  it("Eight Sleep only (Garmin not running) → ok, waits on Eight Sleep with its own baseline", async () => {
    m.aggregate.mockImplementation(async ({ where }: { where: { source: string } }) => ({
      _max: { syncedAt: where.source === "eight_sleep" ? new Date("2026-06-27T05:00:00.000Z") : null },
    }));
    sidecars(refused, async () => ok());
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      source: "eight_sleep",
      baseline: "2026-06-27T05:00:00.000Z",
      otherBaseline: null,
      garmin: "unavailable",
      eightSleep: "started",
    });
  });

  it("Garmin answers but refuses → 'failed' (not 'unavailable'), Eight Sleep still carries the sync", async () => {
    sidecars(async () => new Response("nope", { status: 500 }), async () => ok());
    const res = await POST();
    expect(await res.json()).toMatchObject({ ok: true, source: "eight_sleep", garmin: "failed", eightSleep: "started" });
  });

  it("Eight Sleep pulled moments ago → 'recent', not started; Garmin carries the sync", async () => {
    sidecars(async () => ok(), async () => new Response('{"ok":true,"status":"cooldown"}', { status: 200 }));
    expect(await (await POST()).json()).toMatchObject({ ok: true, source: "garmin", eightSleep: "recent" });
  });

  it("Eight Sleep running pull counts as started (its data will land)", async () => {
    sidecars(refused, async () => new Response('{"ok":true,"status":"running"}', { status: 202 }));
    expect(await (await POST()).json()).toMatchObject({ ok: true, source: "eight_sleep", eightSleep: "started" });
  });

  it("Eight-Sleep-only setup pressed twice → ok with recent: true (not an error)", async () => {
    vi.stubEnv("GARMIN_EMAIL", "");
    vi.stubEnv("TOKENS_DIR", "/nonexistent-tokens-dir");
    sidecars(refused, async () => new Response('{"ok":true,"status":"cooldown"}', { status: 200 }));
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, recent: true, source: "eight_sleep", eightSleep: "recent" });
  });

  it("Garmin set up but its sidecar down, Eight Sleep in cooldown → 502, the outage is not hidden", async () => {
    vi.stubEnv("GARMIN_EMAIL", "someone@example.test");
    sidecars(refused, async () => new Response('{"ok":true,"status":"cooldown"}', { status: 200 }));
    const res = await POST();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: "Could not reach garmin-sync" });
  });

  it("Garmin set up by a saved token file only → also treated as an outage", async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "garmin-tokens-"));
    try {
      writeFileSync(join(dir, "garmin_tokens.json"), "{}");
      vi.stubEnv("GARMIN_EMAIL", "");
      vi.stubEnv("TOKENS_DIR", dir);
      sidecars(refused, async () => new Response('{"ok":true,"status":"cooldown"}', { status: 200 }));
      expect((await POST()).status).toBe(502);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("Garmin set up but down, Eight Sleep starts → ok, Garmin reported 'failed' (button notes it)", async () => {
    vi.stubEnv("GARMIN_EMAIL", "someone@example.test");
    sidecars(refused, async () => ok());
    expect(await (await POST()).json()).toMatchObject({ ok: true, source: "eight_sleep", garmin: "failed", eightSleep: "started" });
  });

  it("Garmin not set up and not running, Eight Sleep starts → Garmin stays 'unavailable'", async () => {
    vi.stubEnv("GARMIN_EMAIL", "");
    vi.stubEnv("TOKENS_DIR", "/nonexistent-tokens-dir");
    sidecars(refused, async () => ok());
    expect(await (await POST()).json()).toMatchObject({ ok: true, source: "eight_sleep", garmin: "unavailable" });
  });

  it("Garmin refuses while Eight Sleep is in cooldown → 502 with Garmin's error", async () => {
    sidecars(async () => new Response("nope", { status: 500 }), async () => new Response('{"ok":true,"status":"cooldown"}', { status: 200 }));
    const res = await POST();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: "Sidecar error (500)" });
  });

  it("Eight Sleep logins paused → 'failed'", async () => {
    sidecars(async () => ok(), async () => new Response('{"ok":true,"status":"paused"}', { status: 200 }));
    expect(await (await POST()).json()).toMatchObject({ eightSleep: "failed" });
  });

  it("502 with the Garmin sidecar status when neither sidecar starts", async () => {
    sidecars(async () => new Response("nope", { status: 500 }), refused);
    const res = await POST();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: "Sidecar error (500)" });
  });

  it("502 when both sidecars are unreachable", async () => {
    sidecars(refused, refused);
    const res = await POST();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: "Could not reach garmin-sync" });
  });

  it("honours EIGHT_SLEEP_SYNC_URL", async () => {
    vi.stubEnv("EIGHT_SLEEP_SYNC_URL", "http://eight-sleep-sync:8081/sync");
    await POST();
    expect(sidecar.mock.calls.map((c) => c[0])).toContain("http://eight-sleep-sync:8081/sync");
  });
});
