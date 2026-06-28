"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { generateTotpSecret, totpKeyUri, totpQrDataUrl, verifyTotp, verifyTotpWithReplay } from "@/lib/auth/totp";
import { createSessionToken, setSessionCookie, clearSessionCookie } from "@/lib/auth/session";
import { provisionOwner } from "@/lib/auth/provision";
import { checkSetupToken, SETUP_TOKEN_COOKIE } from "@/lib/auth/setupToken";
import { encryptField, decryptField } from "@/lib/crypto/fieldEncryption";
import { getOwner, isProvisioned } from "@/lib/auth/owner";

const MIN_PASSWORD = 10;

/** Step 1 of setup: validate password, mint a TOTP secret + QR for the client to confirm. */
export async function startEnrolment(password: string, confirm: string) {
  if (await isProvisioned()) return { ok: false as const, error: "Already set up." };
  if (password.length < MIN_PASSWORD) return { ok: false as const, error: `Password must be at least ${MIN_PASSWORD} characters.` };
  if (password !== confirm) return { ok: false as const, error: "Passwords do not match." };

  const owner = await getOwner();
  if (!owner) return { ok: false as const, error: "No owner account. Run the seed." };

  const secret = generateTotpSecret();
  const uri = totpKeyUri(owner.email, secret);
  const qr = await totpQrDataUrl(uri);
  return { ok: true as const, secret, qr };
}

/** Step 2 of setup: confirm the TOTP code, persist credentials, sign in. */
export async function finishSetup(input: { password: string; confirm: string; secret: string; code: string; token?: string }) {
  if (await isProvisioned()) return { ok: false as const, error: "Already set up." };

  // Optional first-run gate. No-op when SETUP_TOKEN is unset/empty (back-compat).
  // The token may arrive in the action input (forward-compatible) or via the
  // short-lived cookie the /setup page sets from its field / `?token=` prefill.
  const submittedToken = input.token ?? cookies().get(SETUP_TOKEN_COOKIE)?.value;
  const gate = checkSetupToken(submittedToken);
  if (!gate.ok) return { ok: false as const, error: gate.error };

  if (input.password.length < MIN_PASSWORD) return { ok: false as const, error: `Password must be at least ${MIN_PASSWORD} characters.` };
  if (input.password !== input.confirm) return { ok: false as const, error: "Passwords do not match." };
  if (!verifyTotp(input.code, input.secret)) return { ok: false as const, error: "That code didn't match. Try the current one." };

  const owner = await getOwner();
  if (!owner) return { ok: false as const, error: "No owner account. Run the seed." };

  const passwordHash = await hashPassword(input.password);
  // Atomic claim of the unprovisioned owner row — TOCTOU-safe against a second
  // concurrent setup submission (exactly one update matches passwordHash:"").
  try {
    await provisionOwner(
      (args) => prisma.user.updateMany(args),
      passwordHash,
      encryptField(input.secret),
    );
  } catch {
    return { ok: false as const, error: "Already set up." };
  }

  // Setup done — drop the short-lived gate cookie so it doesn't linger.
  cookies().delete(SETUP_TOKEN_COOKIE);

  const token = await createSessionToken({ uid: owner.id, role: owner.role, tv: owner.tokenVersion });
  await setSessionCookie(token);
  revalidatePath("/");
  return { ok: true as const };
}

// Naive single-user throttle (CF Access already fronts the app).
let failures = 0;
let lockedUntil = 0;

/** Verify password + TOTP, set the session cookie. */
export async function login(input: { password: string; code: string }) {
  if (Date.now() < lockedUntil) return { ok: false as const, error: "Too many attempts. Wait a moment." };

  const owner = await getOwner();
  const stored = owner?.totpSecret ? decryptField(owner.totpSecret) : null;
  const passOk = owner ? await verifyPassword(input.password, owner.passwordHash) : false;
  // Replay-guarded: a code whose time-step was already accepted is rejected.
  const totp = stored
    ? verifyTotpWithReplay(input.code, stored, owner?.lastTotpStep)
    : { valid: false as const };

  if (!owner || !passOk || !totp.valid) {
    failures += 1;
    if (failures >= 5) {
      lockedUntil = Date.now() + 30_000;
      failures = 0;
    }
    return { ok: false as const, error: "Invalid credentials." };
  }

  failures = 0;
  // Persist the consumed time-step so the same code cannot be replayed.
  if (totp.timeStep != null) {
    await prisma.user.update({ where: { id: owner.id }, data: { lastTotpStep: totp.timeStep } });
  }
  const token = await createSessionToken({ uid: owner.id, role: owner.role, tv: owner.tokenVersion });
  await setSessionCookie(token);
  return { ok: true as const };
}

export async function logout() {
  await clearSessionCookie();
  redirect("/login");
}

/**
 * Revoke every existing session by bumping the owner's token version — any JWT
 * carrying the old `tv` (or none ⇒ tv 0) immediately fails `getCurrentUser`.
 * Also clears the current cookie and redirects to login.
 */
export async function signOutEverywhere() {
  const owner = await getOwner();
  if (owner) {
    await prisma.user.update({
      where: { id: owner.id },
      data: { tokenVersion: { increment: 1 } },
    });
  }
  await clearSessionCookie();
  redirect("/login");
}
