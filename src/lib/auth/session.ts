/**
 * Stateless signed-JWT sessions (HS256, keyed by AUTH_SECRET) in an httpOnly
 * cookie. jose runs in both the Node and Edge runtimes, so middleware can
 * verify too. createSessionToken/verifySessionToken are pure (testable); the
 * cookie helpers require a Next request context.
 */
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "pt_session";
const ALG = "HS256";
const MAX_AGE_S = 60 * 60 * 24 * 30; // 30 days

export interface SessionData {
  uid: string;
  role: string;
  /** Token version — must match the user's current `tokenVersion` (revocation). */
  tv: number;
}

function key(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  // HS256 security depends entirely on key entropy — fail closed on a weak/missing
  // secret rather than signing forgeable tokens. .env.example generates 32 bytes (base64).
  if (!s || s.length < 32) throw new Error("AUTH_SECRET must be set and at least 32 characters");
  return new TextEncoder().encode(s);
}

export async function createSessionToken(data: SessionData): Promise<string> {
  return new SignJWT({ uid: data.uid, role: data.role, tv: data.tv })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_S}s`)
    .sign(key());
}

export async function verifySessionToken(token: string): Promise<SessionData | null> {
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: [ALG] });
    if (typeof payload.uid === "string" && typeof payload.role === "string") {
      // Tokens minted before session revocation shipped carry no `tv` claim.
      // Treat a missing tv as 0 so those existing sessions (issued while the
      // owner was at tokenVersion 0) stay valid — non-breaking.
      const tv = typeof payload.tv === "number" ? payload.tv : 0;
      return { uid: payload.uid, role: payload.role, tv };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Whether a decoded session is still valid against the user's current token
 * version. A "Sign out everywhere" bumps the user's `tokenVersion`, instantly
 * invalidating every previously-issued session (whose `tv` no longer matches).
 */
export function sessionTokenVersionValid(session: SessionData, userTokenVersion: number): boolean {
  return session.tv === userTokenVersion;
}

export async function setSessionCookie(token: string): Promise<void> {
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    // Secure by default (prod is HTTPS via the tunnel). A `Secure` cookie is
    // DROPPED by browsers over plain HTTP, which breaks login on a dev instance
    // served on a LAN port (http://host:3010). Set COOKIE_SECURE=false there.
    secure: process.env.COOKIE_SECURE !== "false",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_S,
  });
}

export async function clearSessionCookie(): Promise<void> {
  cookies().delete(SESSION_COOKIE);
}

export async function getSession(): Promise<SessionData | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}
