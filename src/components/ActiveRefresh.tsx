"use client";

/**
 * Foreground data-refresh watchdog + device-timezone cookie mirror. Renders
 * nothing; mounted once in the root layout beside VersionHeartbeat.
 *
 * Fixes the "Today never refreshes live" class of staleness: every data page is
 * a force-dynamic SERVER component, but a resumed PWA (iOS keeps one alive for
 * days) or long-lived tab only re-renders on navigation or router.refresh().
 * Three triggers re-render the server tree here:
 *   1. App comes to the foreground (visibilitychange→visible / window focus),
 *      throttled so rapid app-switching doesn't hammer the server.
 *   2. The device-local tracking day rolls over at 02:00 while the app sits open
 *      (minute tick) — otherwise the Today list still shows yesterday.
 *   3. The device timezone CHANGES (travel): the pt_tz cookie is re-mirrored
 *      and the tree refreshed so day-keyed pages re-anchor immediately.
 *
 * The cookie mirror is what lets server components answer "what day is it for
 * the viewer" (see viewer-tz.ts). The cookie is REWRITTEN on every mount and
 * foreground event even when its value is unchanged: WebKit/ITP caps
 * script-set cookies at ~7 days regardless of max-age, so only continual
 * renewal keeps it alive on the iOS PWA (the primary client).
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { trackingDayOf, deviceTimeZone } from "@/lib/local-day";
import { shouldRefreshOnActive, dayRolled } from "@/lib/active-refresh";
import { TZ_COOKIE } from "@/lib/tz-cookie";

function readCookie(name: string): string | null {
  const hit = document.cookie.split("; ").find((c) => c.startsWith(name + "="));
  return hit ? hit.slice(name.length + 1) : null;
}

function writeTzCookie(tz: string): void {
  document.cookie = `${TZ_COOKIE}=${encodeURIComponent(tz)}; path=/; max-age=31536000; SameSite=Lax`;
}

export function ActiveRefresh({ serverDayKey }: {
  /** The day key the server just rendered with (viewerToday().key) — the mount check compares it to the device day. */
  serverDayKey: string;
}) {
  const router = useRouter();

  useEffect(() => {
    let lastRefresh = Date.now();
    // What the server actually rendered — NOT the mount-time device day. A
    // load spanning the 02:00 tracking boundary, or a no-cookie render abroad, makes the
    // two differ, and the mount check below corrects both immediately.
    let renderedDay = serverDayKey;

    const refresh = () => {
      lastRefresh = Date.now();
      renderedDay = trackingDayOf(new Date());
      router.refresh();
    };

    // ── Timezone cookie mirror ────────────────────────────────────────────────
    // ALWAYS rewrite (renews the ITP-capped expiry); report whether the VALUE
    // changed — including absent→set — so a first mirror abroad refreshes the
    // no-cookie server render the user is currently looking at. At home the
    // one-time extra refresh renders byte-identical output.
    const syncTz = (): boolean => {
      const tz = deviceTimeZone();
      if (!tz) return false;
      const prev = readCookie(TZ_COOKIE);
      writeTzCookie(tz);
      return prev !== encodeURIComponent(tz);
    };

    const onActive = () => {
      const tzChanged = syncTz();
      // Day rolled since this page was rendered → FULL reload, not a soft
      // refresh: router.refresh() re-renders server components but PRESERVES
      // client-component state, so a PWA page resumed days later would keep
      // stale form prefills and a frozen outbox pipeline (a Sunday dose once
      // filed onto Saturday exactly this way). Remounting everything is the
      // only reliable reset at a day boundary.
      if (dayRolled(renderedDay, trackingDayOf(new Date()))) {
        window.location.reload();
        return;
      }
      if (tzChanged || shouldRefreshOnActive(Date.now(), lastRefresh)) {
        refresh();
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") onActive();
    };

    // Minute tick: catch the phone-local 02:00 tracking-day rollover while the app stays
    // foregrounded (the visibility/focus listeners only fire on re-entry).
    // Same full-reload rationale as onActive.
    const tick = window.setInterval(() => {
      if (document.visibilityState === "visible" && dayRolled(renderedDay, trackingDayOf(new Date()))) window.location.reload();
    }, 60_000);

    // Mount: mirror the zone, then correct a wrong-day first paint — either
    // the cookie was absent/stale (server rendered its own day abroad) or the
    // page load spanned the phone-local 02:00 boundary.
    const tzChangedOnMount = syncTz();
    if (tzChangedOnMount || dayRolled(renderedDay, trackingDayOf(new Date()))) refresh();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onActive);
    return () => {
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onActive);
    };
  }, [router, serverDayKey]);

  return null;
}
