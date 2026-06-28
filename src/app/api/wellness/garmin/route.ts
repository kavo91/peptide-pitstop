import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { getOwner } from "@/lib/auth/owner";
import { encryptField } from "@/lib/crypto/fieldEncryption";
import { importWellnessDays } from "@/lib/wearable-import";

/** Constant-time bearer-token check against WELLNESS_IMPORT_TOKEN. */
function tokenValid(token: string | undefined, secret: string): boolean {
  const a = Buffer.from(token ?? "");
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * POST /api/wellness/garmin
 *
 * Ingest endpoint for the `garmin-sync` sidecar. Accepts a batch of assembled
 * raw Garmin days, normalises each (single source of truth: wearable-normalise),
 * and upserts WearableDaily rows for the owner on (userId, date, source).
 *
 * Auth: bearer token equal to WELLNESS_IMPORT_TOKEN (timing-safe). If the env is
 * unset the route fails CLOSED with 503 — it never accepts unauthenticated
 * writes. A bad/missing token is 401.
 *
 *   Body:    { days: rawGarminDay[] }
 *   Returns: { upserted: n }
 */
export async function POST(req: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const secret = process.env.WELLNESS_IMPORT_TOKEN;
  if (!secret) {
    console.error("[wellness/garmin] WELLNESS_IMPORT_TOKEN is not set — refusing writes");
    return NextResponse.json({ ok: false, error: "Server misconfiguration" }, { status: 503 });
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !tokenValid(token, secret)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // ── Body ─────────────────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const days = (body as { days?: unknown })?.days;
  if (!Array.isArray(days)) {
    return NextResponse.json({ ok: false, error: "Expected { days: [...] }" }, { status: 400 });
  }

  // ── Resolve owner + upsert ───────────────────────────────────────────────
  try {
    const owner = await getOwner();
    if (!owner) {
      console.error("[wellness/garmin] no owner user — cannot import");
      return NextResponse.json({ ok: false, error: "No owner" }, { status: 503 });
    }

    const { upserted } = await importWellnessDays(prisma, owner.id, days, encryptField);
    console.log(`[wellness/garmin] upserted=${upserted} of ${days.length} day(s)`);
    return NextResponse.json({ upserted });
  } catch (err) {
    console.error("[wellness/garmin] error", err);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
