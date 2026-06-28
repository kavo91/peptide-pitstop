/**
 * App-level field encryption for sensitive columns (AES-256-GCM).
 *
 * Locked decision: full-disk encryption on Unraid PLUS field encryption on
 * identifying free-text and lab values, so even a DB exfiltration is unreadable.
 *
 * Rules:
 *  - Encrypted fields are stored as opaque strings; NEVER use them in SQL WHERE
 *    clauses (the ciphertext is non-deterministic by design).
 *  - Numeric dose fields stay in the clear (they need aggregation) but are still
 *    protected by full-disk encryption.
 *
 * Key: 32 bytes, base64, in env PT_FIELD_KEY. Generate with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const PREFIX = "enc:v1:";

function key(): Buffer {
  const raw = process.env.PT_FIELD_KEY;
  if (!raw) throw new Error("PT_FIELD_KEY is not set");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("PT_FIELD_KEY must decode to 32 bytes");
  return k;
}

export function encryptField(plaintext: string | null | undefined): string | null {
  if (plaintext == null) return null;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decryptField(stored: string | null | undefined): string | null {
  if (stored == null) return null;
  if (!stored.startsWith(PREFIX)) return stored; // tolerate legacy/plaintext
  const buf = Buffer.from(stored.slice(PREFIX.length), "base64");
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + 16);
  const ct = buf.subarray(IV_BYTES + 16);
  const decipher = createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
