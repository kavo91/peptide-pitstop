import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runReminders } from "@/lib/reminders";

/** Constant-time bearer-token check. */
function tokenValid(token: string | undefined, secret: string): boolean {
  const a = Buffer.from(token ?? "");
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * POST /api/cron/reminders
 *
 * Pushes HA reminders for any due planned doses across all users. Protected by a
 * bearer token equal to CRON_SECRET (same mechanism as /api/cron/planned). If
 * CRON_SECRET is unset it falls back to AUTH_SECRET (the JWT signing key) for
 * backward compatibility with the live triggers — set CRON_SECRET to stop
 * reusing the JWT secret for cron auth. Fails closed (500) only when BOTH are
 * unset. The instrumentation interval calls runReminders directly; this route is
 * the manual / external trigger.
 *
 * Usage:
 *   curl -X POST http://localhost:3009/api/cron/reminders \
 *     -H "Authorization: Bearer <CRON_SECRET-or-AUTH_SECRET>"
 *
 * Returns JSON: { sent: N }
 */
export async function POST(req: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("authorization") ?? "";
  const [scheme, token] = authHeader.split(" ");
  // Prefer the dedicated cron secret; fall back to AUTH_SECRET so existing live
  // triggers keep working until CRON_SECRET is provisioned.
  const secret = process.env.CRON_SECRET ?? process.env.AUTH_SECRET;
  if (!process.env.CRON_SECRET && secret) {
    console.warn("[cron/reminders] CRON_SECRET not set — falling back to AUTH_SECRET; set CRON_SECRET to harden");
  }

  if (!secret) {
    console.error("[cron/reminders] neither CRON_SECRET nor AUTH_SECRET is set");
    return NextResponse.json({ ok: false, error: "Server misconfiguration" }, { status: 500 });
  }

  if (scheme !== "Bearer" || !tokenValid(token, secret)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // ── Run reminders for all users ──────────────────────────────────────────
  try {
    const { sent } = await runReminders();
    console.log(`[cron/reminders] complete — sent=${sent}`);
    return NextResponse.json({ sent });
  } catch (err) {
    console.error("[cron/reminders] error", err);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
