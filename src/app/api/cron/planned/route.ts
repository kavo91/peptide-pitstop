import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { runPlannedDoseGeneration } from "@/lib/planned/run";

/** Constant-time bearer-token check. */
function tokenValid(token: string | undefined, secret: string): boolean {
  const a = Buffer.from(token ?? "");
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * POST /api/cron/planned
 *
 * Triggers a PlannedDose generation run for all users. Protected by a bearer
 * token equal to CRON_SECRET (set in .env). If CRON_SECRET is unset it falls
 * back to AUTH_SECRET (the JWT signing key) for backward compatibility with the
 * live triggers — set CRON_SECRET to stop reusing the JWT secret for cron auth.
 * Fails closed (500) only when BOTH are unset.
 *
 * Usage:
 *   curl -X POST http://localhost:3009/api/cron/planned \
 *     -H "Authorization: Bearer <CRON_SECRET-or-AUTH_SECRET>"
 *
 * Returns JSON: { ok: true, users: N, upserted: N, markedMissed: N }
 */
export async function POST(req: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("authorization") ?? "";
  const [scheme, token] = authHeader.split(" ");
  // Prefer the dedicated cron secret; fall back to AUTH_SECRET so existing live
  // triggers keep working until CRON_SECRET is provisioned.
  const secret = process.env.CRON_SECRET ?? process.env.AUTH_SECRET;
  if (!process.env.CRON_SECRET && secret) {
    console.warn("[cron/planned] CRON_SECRET not set — falling back to AUTH_SECRET; set CRON_SECRET to harden");
  }

  if (!secret) {
    console.error("[cron/planned] neither CRON_SECRET nor AUTH_SECRET is set");
    return NextResponse.json({ ok: false, error: "Server misconfiguration" }, { status: 500 });
  }

  if (scheme !== "Bearer" || !tokenValid(token, secret)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // ── Run generation for all users ─────────────────────────────────────────
  try {
    console.log("[cron/planned] manual trigger — starting generation");

    const users = await prisma.user.findMany({
      where: { protocols: { some: {} } },
      select: { id: true },
    });

    let totalUpserted = 0;
    let totalMissed = 0;

    for (const user of users) {
      const result = await runPlannedDoseGeneration(user.id);
      totalUpserted += result.upserted;
      totalMissed += result.markedMissed;
    }

    console.log(
      `[cron/planned] complete — upserted=${totalUpserted} markedMissed=${totalMissed} users=${users.length}`,
    );

    return NextResponse.json({
      ok: true,
      users: users.length,
      upserted: totalUpserted,
      markedMissed: totalMissed,
    });
  } catch (err) {
    console.error("[cron/planned] error", err);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
