/**
 * Web Push sender — notifications delivered to the installed PWA itself
 * (service-worker `push` handler shows them; tap opens the app window).
 *
 * Configuration: VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY (+ VAPID_SUBJECT,
 * mailto: or https:) in the environment. Unset → the feature reports
 * unavailable and reminders fall back to the HA webhook relay.
 *
 * Subscriptions live in PushSubscription (one row per device/browser, keyed
 * by endpoint). A push service answering 404/410 means the subscription is
 * gone (uninstalled PWA, iOS pruning an unused app) — the row is deleted so
 * the sender self-heals and the reminder engine falls back to HA.
 *
 * `web-push` is dynamically imported inside the send path only: this module
 * is reachable from instrumentation.ts, which is also compiled for the Edge
 * runtime where web-push's node built-ins (crypto, https) cannot resolve.
 */

export interface PushEventBody {
  title: string;
  body: string;
  tag: string;
  url: string;
}

export function vapidConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY?.trim() && process.env.VAPID_PRIVATE_KEY?.trim());
}

/** The public key the browser needs for pushManager.subscribe(), or null. */
export function vapidPublicKey(): string | null {
  return vapidConfigured() ? process.env.VAPID_PUBLIC_KEY!.trim() : null;
}

/** True when VAPID is configured AND the user has at least one subscription. */
export async function webPushAvailable(userId: string): Promise<boolean> {
  if (!vapidConfigured()) return false;
  const { prisma } = await import("@/lib/db");
  return (await prisma.pushSubscription.count({ where: { userId } })) > 0;
}

/**
 * Send one event to EVERY subscription the user has (multi-device). Returns
 * how many deliveries the push services accepted. Expired subscriptions
 * (404/410) are pruned; other per-subscription failures are logged and
 * skipped — one dead device must never block the others.
 */
export async function sendWebPush(userId: string, event: PushEventBody): Promise<number> {
  if (!vapidConfigured()) return 0;
  const { prisma } = await import("@/lib/db");
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  if (subs.length === 0) return 0;

  // webpackIgnore: web-push pulls node built-ins (https) that break the EDGE
  // compile of instrumentation.ts's import graph — `serverComponentsExternal-
  // Packages` alone doesn't cover that pass on Next 14. The ignored import
  // resolves natively at runtime in the nodejs server (never executes on Edge:
  // instrumentation guards on NEXT_RUNTIME). BOTH pieces are required: this
  // comment keeps webpack out; the next.config external entry keeps the file
  // tracer copying web-push + deps into .next/standalone/node_modules
  // (verified: standalone import works; deps http_ece/jws/asn1.js traced).
  const webpush = (await import(/* webpackIgnore: true */ "web-push")).default;
  webpush.setVapidDetails(
    // Operator contact for push services; set VAPID_SUBJECT to YOUR mailto/URL.
    process.env.VAPID_SUBJECT?.trim() || "mailto:admin@example.com",
    process.env.VAPID_PUBLIC_KEY!.trim(),
    process.env.VAPID_PRIVATE_KEY!.trim(),
  );

  const payload = JSON.stringify({ title: event.title, body: event.body, tag: event.tag, url: event.url });
  let delivered = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        // timeout: a tar-pit endpoint must not wedge the reminder tick after
        // the event is already claimed (claims are never retried).
        { TTL: 3600, urgency: "high", timeout: 10_000 },
      );
      delivered++;
    } catch (err) {
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) {
        // Subscription is gone on the push service — prune so we self-heal.
        await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        console.log(`[push] pruned expired subscription ${sub.id}`);
      } else {
        console.error(`[push] send failed for subscription ${sub.id}:`, status ?? err);
      }
    }
  }
  return delivered;
}
