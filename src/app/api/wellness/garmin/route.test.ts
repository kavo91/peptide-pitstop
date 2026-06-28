import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the server-only / DB-touching deps so importing the route never pulls in
// `server-only` (which throws outside an RSC build) or a real Prisma client.
// `vi.hoisted` lets the mock factories (also hoisted) reference these safely.
const { importWellnessDays, getOwner } = vi.hoisted(() => ({
  importWellnessDays: vi.fn(),
  getOwner: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/auth/owner", () => ({ getOwner }));
vi.mock("@/lib/crypto/fieldEncryption", () => ({ encryptField: (s: string) => s }));
vi.mock("@/lib/wearable-import", () => ({ importWellnessDays }));

import { POST } from "./route";

function post(headers: Record<string, string>, body: unknown) {
  return new Request("http://localhost/api/wellness/garmin", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  }) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.WELLNESS_IMPORT_TOKEN;
});

describe("POST /api/wellness/garmin", () => {
  it("503 when WELLNESS_IMPORT_TOKEN is unset (fail closed)", async () => {
    const res = await POST(post({ authorization: "Bearer whatever" }, { days: [] }));
    expect(res.status).toBe(503);
    expect(importWellnessDays).not.toHaveBeenCalled();
  });

  it("401 on a missing or wrong bearer token", async () => {
    process.env.WELLNESS_IMPORT_TOKEN = "s3cret-token-value";
    const none = await POST(post({}, { days: [] }));
    expect(none.status).toBe(401);
    const wrong = await POST(post({ authorization: "Bearer nope" }, { days: [] }));
    expect(wrong.status).toBe(401);
    expect(importWellnessDays).not.toHaveBeenCalled();
  });

  it("400 when the body is not { days: [...] }", async () => {
    process.env.WELLNESS_IMPORT_TOKEN = "s3cret-token-value";
    const res = await POST(post({ authorization: "Bearer s3cret-token-value" }, { nope: 1 }));
    expect(res.status).toBe(400);
  });

  it("upserts on a valid token and returns the count", async () => {
    process.env.WELLNESS_IMPORT_TOKEN = "s3cret-token-value";
    getOwner.mockResolvedValue({ id: "owner-1" });
    importWellnessDays.mockResolvedValue({ upserted: 2 });

    const days = [{ date: "2026-06-20" }, { date: "2026-06-19" }];
    const res = await POST(post({ authorization: "Bearer s3cret-token-value" }, { days }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ upserted: 2 });
    expect(importWellnessDays).toHaveBeenCalledWith({}, "owner-1", days, expect.any(Function));
  });

  it("503 when no owner user exists", async () => {
    process.env.WELLNESS_IMPORT_TOKEN = "s3cret-token-value";
    getOwner.mockResolvedValue(null);
    const res = await POST(post({ authorization: "Bearer s3cret-token-value" }, { days: [] }));
    expect(res.status).toBe(503);
    expect(importWellnessDays).not.toHaveBeenCalled();
  });
});
