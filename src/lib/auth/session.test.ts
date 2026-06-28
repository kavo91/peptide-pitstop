import { describe, it, expect, beforeAll } from "vitest";
import { SignJWT } from "jose";
import { createSessionToken, verifySessionToken, sessionTokenVersionValid } from "./session";

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret-test-secret-test-secret-1234";
});

describe("session token", () => {
  it("round-trips a valid token", async () => {
    const token = await createSessionToken({ uid: "u1", role: "owner", tv: 0 });
    const data = await verifySessionToken(token);
    expect(data).toEqual({ uid: "u1", role: "owner", tv: 0 });
  });

  it("carries the token version (tv) claim", async () => {
    const token = await createSessionToken({ uid: "u1", role: "owner", tv: 3 });
    const data = await verifySessionToken(token);
    expect(data?.tv).toBe(3);
  });

  it("treats a legacy token with no tv claim as tv=0 (non-breaking)", async () => {
    const legacy = await new SignJWT({ uid: "u1", role: "owner" }) // no tv claim
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("30d")
      .sign(new TextEncoder().encode(process.env.AUTH_SECRET!));
    expect(await verifySessionToken(legacy)).toEqual({ uid: "u1", role: "owner", tv: 0 });
  });

  it("rejects a tampered token", async () => {
    const token = await createSessionToken({ uid: "u1", role: "owner", tv: 0 });
    const tampered = token.slice(0, -2) + (token.endsWith("a") ? "bb" : "aa");
    expect(await verifySessionToken(tampered)).toBeNull();
  });

  it("rejects a token signed with a different key", async () => {
    const other = await new SignJWT({ uid: "u1", role: "owner" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("30d")
      .sign(new TextEncoder().encode("a-totally-different-secret-key-000000"));
    expect(await verifySessionToken(other)).toBeNull();
  });

  it("rejects a too-short AUTH_SECRET (fail closed)", async () => {
    const orig = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "short";
    await expect(createSessionToken({ uid: "u1", role: "owner", tv: 0 })).rejects.toThrow(/AUTH_SECRET/);
    process.env.AUTH_SECRET = orig;
  });

  it("rejects an expired token", async () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    const token = await new SignJWT({ uid: "u1", role: "owner" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(past - 60)
      .setExpirationTime(past)
      .sign(new TextEncoder().encode(process.env.AUTH_SECRET!));
    expect(await verifySessionToken(token)).toBeNull();
  });
});

describe("sessionTokenVersionValid (revocation)", () => {
  it("accepts a tv=0 token while the user is at tokenVersion 0", () => {
    expect(sessionTokenVersionValid({ uid: "u1", role: "owner", tv: 0 }, 0)).toBe(true);
  });

  it("rejects a tv=0 token after the user's tokenVersion bumps to 1", () => {
    expect(sessionTokenVersionValid({ uid: "u1", role: "owner", tv: 0 }, 1)).toBe(false);
  });

  it("accepts a token whose tv matches a non-zero user tokenVersion", () => {
    expect(sessionTokenVersionValid({ uid: "u1", role: "owner", tv: 2 }, 2)).toBe(true);
  });

  it("rejects a stale token after a further bump", () => {
    expect(sessionTokenVersionValid({ uid: "u1", role: "owner", tv: 1 }, 2)).toBe(false);
  });
});
