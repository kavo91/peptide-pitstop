import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { scrapeAll } from "@/lib/enrichment/scrape-core";

// Long-running scrape (multiple upstream fetches) — run on Node, not Edge, and
// allow a generous window.
export const runtime = "nodejs";
export const maxDuration = 300;

/** Constant-time bearer-token check. */
function tokenValid(token: string | undefined, secret: string): boolean {
  const a = Buffer.from(token ?? "");
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * POST /api/enrichment/refresh
 *
 * Re-scrapes peptidedosages.com and upserts PeptideReference rows (the DB
 * override the read helper prefers over the committed seed). Protected by a
 * bearer token equal to ENRICHMENT_REFRESH_TOKEN. If that is unset it falls back
 * to AUTH_SECRET (the JWT signing key) for backward compatibility with the live
 * trigger — set ENRICHMENT_REFRESH_TOKEN to stop reusing the JWT secret. Fails
 * closed (500) only when BOTH are unset. This route is on the middleware
 * BEARER_API bypass list so the session gate lets it reach this self-auth check.
 *
 * Designed for a WEEKLY trigger (HA automation / supervisor cron).
 *
 * Resilience: a per-peptide scrape failure is recorded but the existing row is
 * kept (last-good) — we only upsert peptides that scraped successfully, and
 * never delete. Returns { updated, failed, skipped }.
 *
 * Usage:
 *   curl -X POST http://localhost:3010/api/enrichment/refresh \
 *     -H "Authorization: Bearer <ENRICHMENT_REFRESH_TOKEN-or-AUTH_SECRET>"
 */
export async function POST(req: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("authorization") ?? "";
  const [scheme, token] = authHeader.split(" ");
  // Prefer the dedicated refresh token; fall back to AUTH_SECRET so the existing
  // live trigger keeps working until ENRICHMENT_REFRESH_TOKEN is provisioned.
  const secret = process.env.ENRICHMENT_REFRESH_TOKEN ?? process.env.AUTH_SECRET;
  if (!process.env.ENRICHMENT_REFRESH_TOKEN && secret) {
    console.warn(
      "[enrichment/refresh] ENRICHMENT_REFRESH_TOKEN not set — falling back to AUTH_SECRET; set ENRICHMENT_REFRESH_TOKEN to harden",
    );
  }

  if (!secret) {
    console.error("[enrichment/refresh] neither ENRICHMENT_REFRESH_TOKEN nor AUTH_SECRET is set");
    return NextResponse.json({ ok: false, error: "Server misconfiguration" }, { status: 500 });
  }

  if (scheme !== "Bearer" || !tokenValid(token, secret)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // ── Scrape + upsert ────────────────────────────────────────────────────────
  try {
    const { results } = await scrapeAll({ concurrency: 2, delayMs: 800 });

    let updated = 0;
    let failed = 0;
    let skipped = 0;

    for (const r of results) {
      if (r.status !== "ok" || !r.entry) {
        // Keep last-good row — do NOT wipe on failure/skip.
        if (r.status === "failed") failed++;
        else skipped++;
        continue;
      }
      try {
        const dataJson = JSON.stringify(r.entry);
        await prisma.peptideReference.upsert({
          where: { peptideName: r.entry.name },
          create: {
            peptideName: r.entry.name,
            dataJson,
            source: r.entry.sourceUrl,
          },
          update: {
            dataJson,
            source: r.entry.sourceUrl,
            fetchedAt: new Date(),
          },
        });
        updated++;
      } catch (err) {
        console.error(`[enrichment/refresh] upsert failed for ${r.entry.name}`, err);
        failed++;
      }
    }

    console.log(`[enrichment/refresh] complete — updated=${updated} failed=${failed} skipped=${skipped}`);
    return NextResponse.json({ updated, failed, skipped });
  } catch (err) {
    console.error("[enrichment/refresh] error", err);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
