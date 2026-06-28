/**
 * Time-based one-time passwords (RFC 6238) via otplib v13's functional API,
 * plus QR rendering for enrolment. The secret is persisted ENCRYPTED (see
 * actions/auth.ts) — this module is pure and never touches the DB.
 */
import { generateSecret, generateURI, verifySync } from "otplib";
import QRCode from "qrcode";
import { brandName } from "@/lib/design";

// ±30s tolerance (one step either side) for client clock skew.
const EPOCH_TOLERANCE_S = 30;

export function generateTotpSecret(): string {
  return generateSecret();
}

export function totpKeyUri(account: string, secret: string): string {
  // Issuer shown in authenticator apps follows the active design pack
  // (brandName() reads the DESIGN env at call time; this is server-side).
  return generateURI({ issuer: brandName(), label: account, secret });
}

export async function totpQrDataUrl(keyUri: string): Promise<string> {
  return QRCode.toDataURL(keyUri);
}

export function verifyTotp(token: string, secret: string): boolean {
  if (!/^\d{6}$/.test(token)) return false;
  try {
    return verifySync({ secret, token, epochTolerance: EPOCH_TOLERANCE_S }).valid;
  } catch {
    return false;
  }
}

export interface TotpVerification {
  valid: boolean;
  /** RFC 6238 time-step (floor(epochSeconds / 30)) of the matched code; set only when valid. */
  timeStep?: number;
}

/**
 * Replay-aware TOTP verification. On a successful match, rejects the code if its
 * time-step is `<= lastStep` (a step already accepted) — otherwise returns the
 * matched `timeStep` so the caller can persist it as the new `lastTotpStep`.
 * `lastStep` of null/undefined disables the guard (first-ever verification),
 * keeping the existing owner (lastTotpStep = NULL) working.
 *
 * `epochSeconds` overrides "now" for deterministic tests only.
 */
export function verifyTotpWithReplay(
  token: string,
  secret: string,
  lastStep?: number | null,
  epochSeconds?: number,
): TotpVerification {
  if (!/^\d{6}$/.test(token)) return { valid: false };
  try {
    const res = verifySync({
      secret,
      token,
      epochTolerance: EPOCH_TOLERANCE_S,
      ...(epochSeconds != null ? { epoch: epochSeconds } : {}),
    });
    // verifySync returns a TOTP|HOTP union; timeStep exists only on the TOTP
    // result (the strategy we use). Narrow defensively.
    if (!res.valid || !("timeStep" in res)) return { valid: false };
    if (lastStep != null && res.timeStep <= lastStep) return { valid: false };
    return { valid: true, timeStep: res.timeStep };
  } catch {
    return { valid: false };
  }
}
