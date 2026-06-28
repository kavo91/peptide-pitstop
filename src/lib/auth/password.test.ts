import { describe, it, expect } from "vitest";
import { scrypt as scryptCb, randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { hashPassword, verifyPassword, SCRYPT_PARAMS } from "./password";

// Bare scrypt with NO options — produces hashes using Node's built-in defaults.
// Used below to prove our pinned params equal those defaults (back-compat).
const scryptDefault = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

describe("password", () => {
  it("verifies a correct password", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", stored)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("wrong password", stored)).toBe(false);
  });

  it("produces a different hash each time (random salt)", async () => {
    const a = await hashPassword("same");
    const b = await hashPassword("same");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same", a)).toBe(true);
    expect(await verifyPassword("same", b)).toBe(true);
  });

  it("rejects a malformed stored value", async () => {
    expect(await verifyPassword("x", "garbage")).toBe(false);
    expect(await verifyPassword("x", "scrypt::")).toBe(false);
  });

  it("pins scrypt cost params explicitly", () => {
    expect(SCRYPT_PARAMS).toEqual({ N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  });

  it("verifies a hash produced with Node's bare default scrypt (back-compat)", async () => {
    // Mirrors how the existing owner hash was stored before params were pinned.
    // If our pinned params differed from the defaults, this would not verify.
    const salt = randomBytes(16);
    const hash = await scryptDefault("legacy secret", salt, 64);
    const stored = `scrypt:${salt.toString("base64")}:${hash.toString("base64")}`;
    expect(await verifyPassword("legacy secret", stored)).toBe(true);
  });

  it("keeps the same on-disk format (scrypt:<saltB64>:<hashB64>)", async () => {
    const stored = await hashPassword("format check");
    const parts = stored.split(":");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("scrypt");
    expect(Buffer.from(parts[1], "base64")).toHaveLength(16); // salt
    expect(Buffer.from(parts[2], "base64")).toHaveLength(64); // key
  });
});
