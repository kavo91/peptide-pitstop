import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health-export — DISABLED (410 Gone).
 *
 * This was the Apple Health (HealthKit) bridge read-side. HealthKit/iOS is not in
 * the pipeline, and the route was reachable via the WELLNESS_IMPORT_TOKEN bearer
 * bypass, so the endpoint is explicitly closed (audit item #8). The file is kept
 * (rather than deleted) so the closure is intentional and discoverable; restore
 * from git history if the Apple Health path is ever revived.
 */
export async function GET() {
  return NextResponse.json({ error: "disabled" }, { status: 410 });
}
