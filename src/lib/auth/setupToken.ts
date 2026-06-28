/**
 * Optional first-run setup gate.
 *
 * `/setup` is public by design and is normally safe only because the prod owner
 * row is already provisioned (the atomic `passwordHash: ""` claim makes a second
 * run a no-op). An UNprovisioned instance that gets exposed before the owner
 * finishes setup is, however, claimable by anyone who reaches the page.
 *
 * When `SETUP_TOKEN` is set (non-empty) this adds a shared-secret gate in front
 * of provisioning. When it is unset/empty the behaviour is EXACTLY as before:
 * no gate. Kept free of `server-only`/Prisma/`next` imports so it can be
 * unit-tested directly (mirrors `provision.ts`).
 */
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Cookie used to ferry the submitted setup token from the public /setup page to
 * the `finishSetup` server action without modifying the existing client form.
 * Short-lived and removed once setup completes. Not a credential after setup.
 */
export const SETUP_TOKEN_COOKIE = "pt_setup_token";

/** The configured token, or null when the gate is disabled (unset/empty). */
export function configuredSetupToken(env: NodeJS.ProcessEnv = process.env): string | null {
  const t = env.SETUP_TOKEN;
  return t && t.length > 0 ? t : null;
}

/** Whether the setup gate is active (a non-empty `SETUP_TOKEN` is configured). */
export function setupTokenRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return configuredSetupToken(env) !== null;
}

/**
 * Constant-time string compare. Both inputs are SHA-256'd first so the buffers
 * fed to `timingSafeEqual` are always 32 bytes — this avoids leaking the token
 * length (timingSafeEqual throws / would need an early length branch otherwise)
 * while keeping the comparison itself constant-time.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Validate a submitted setup token against `SETUP_TOKEN`.
 *
 * - Gate disabled (no `SETUP_TOKEN`)  → `{ ok: true }` (unchanged behaviour).
 * - Gate enabled + correct token      → `{ ok: true }`.
 * - Gate enabled + missing/wrong token → `{ ok: false, error }`.
 *
 * Timing-safe compare so a wrong token can't be discovered byte-by-byte.
 */
export function checkSetupToken(
  submitted: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): { ok: true } | { ok: false; error: string } {
  const expected = configuredSetupToken(env);
  if (expected === null) return { ok: true };
  const provided = typeof submitted === "string" ? submitted : "";
  if (provided.length === 0) {
    return { ok: false, error: "A setup token is required." };
  }
  if (!constantTimeEquals(provided, expected)) {
    return { ok: false, error: "Invalid setup token." };
  }
  return { ok: true };
}
