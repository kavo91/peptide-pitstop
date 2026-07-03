import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/owner";
import { vapidConfigured, vapidPublicKey } from "@/lib/push";

export const dynamic = "force-dynamic";

/**
 * Web Push subscription management. Session-cookie authenticated (same as the
 * CSV export routes) — every handler 401s without a signed-in user.
 *
 *   GET    → { configured, publicKey } — what the client needs to subscribe.
 *   POST   → save/refresh this device's subscription (upsert by endpoint).
 *   DELETE → remove this device's subscription ({ endpoint }).
 */

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, configured: vapidConfigured(), publicKey: vapidPublicKey() });
}

/** Shape sent by PushSubscription.toJSON() in the browser. */
interface SubscribeBody {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body: SubscribeBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const endpoint = (body.endpoint ?? "").trim();
  const p256dh = (body.keys?.p256dh ?? "").trim();
  const auth = (body.keys?.auth ?? "").trim();
  // Endpoint must be an https push-service URL; keys are base64url strings.
  if (!endpoint.startsWith("https://") || endpoint.length > 2048 || !p256dh || !auth) {
    return NextResponse.json({ ok: false, error: "Invalid subscription" }, { status: 400 });
  }

  await prisma.pushSubscription.upsert({
    where: { endpoint },
    update: { userId: user.id, p256dh, auth, userAgent: req.headers.get("user-agent") },
    create: { userId: user.id, endpoint, p256dh, auth, userAgent: req.headers.get("user-agent") },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body: { endpoint?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const endpoint = (body.endpoint ?? "").trim();
  if (!endpoint) return NextResponse.json({ ok: false, error: "Missing endpoint" }, { status: 400 });

  // Ownership-scoped — a user can only remove their own rows.
  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: user.id } });
  return NextResponse.json({ ok: true });
}
