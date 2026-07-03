import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/owner";
import { sendWebPush, webPushAvailable } from "@/lib/push";

export const dynamic = "force-dynamic";

/**
 * POST /api/push/test — send a test notification to every one of the caller's
 * Web Push subscriptions. Session-authenticated; used by the Settings card's
 * "Send test" button to prove the device pipeline end-to-end.
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  if (!(await webPushAvailable(user.id))) {
    return NextResponse.json({ ok: false, error: "No Web Push subscription on file." }, { status: 400 });
  }
  const delivered = await sendWebPush(user.id, {
    title: "🔔 Peptide Pitstop test",
    body: "Push notifications are working on this device.",
    tag: "peptide-test",
    url: "/today",
  });
  return NextResponse.json({ ok: true, delivered });
}
