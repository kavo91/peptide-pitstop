/**
 * Password hashing with Node's built-in scrypt. Stored format is
 * self-describing: "scrypt:<saltB64>:<hashB64>". No external dependency.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { promisify } from "node:util";

/**
 * scrypt cost parameters, pinned explicitly. These intentionally EQUAL Node's
 * current built-in defaults (N=16384, r=8, p=1) so hashes written before the
 * params were made explicit still verify byte-for-byte — pinning them protects
 * against a future Node default change silently invalidating stored hashes.
 * `maxmem` is raised above the 32 MiB default to leave headroom; it caps the
 * allocation only and does not affect the derived key.
 */
export const SCRYPT_PARAMS: ScryptOptions = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

const SALT_BYTES = 16;
const KEY_BYTES = 64;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await scrypt(plain, salt, KEY_BYTES, SCRYPT_PARAMS);
  return `scrypt:${salt.toString("base64")}:${hash.toString("base64")}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "base64");
  const expected = Buffer.from(parts[2], "base64");
  if (salt.length === 0 || expected.length === 0) return false;
  const actual = await scrypt(plain, salt, expected.length, SCRYPT_PARAMS);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
