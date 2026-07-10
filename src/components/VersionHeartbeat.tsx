"use client";

/**
 * PWA bundle-freshness watchdog. iOS keeps an installed PWA resumed for days
 * without a navigation, so a deployed bundle is never picked up until
 * something forces a full reload — this component checks /api/version when
 * the app comes to the foreground and reloads once when the server is ahead.
 * Renders nothing.
 */
import { useEffect } from "react";
import { APP_VERSION } from "@/lib/version";
import { shouldReloadForVersion } from "@/lib/version-heartbeat";

const RELOADED_KEY = "pt-reloaded-for-version";
const MIN_CHECK_INTERVAL_MS = 60_000;

export function VersionHeartbeat() {
  useEffect(() => {
    let lastCheck = 0;
    let cancelled = false;

    const check = async () => {
      const t = Date.now();
      if (t - lastCheck < MIN_CHECK_INTERVAL_MS) return;
      lastCheck = t;
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const data: unknown = await res.json();
        const served =
          typeof data === "object" && data !== null
            ? (data as { version?: unknown }).version
            : undefined;
        const reloadedFor = window.sessionStorage.getItem(RELOADED_KEY);
        if (!cancelled && shouldReloadForVersion(APP_VERSION, served, reloadedFor)) {
          window.sessionStorage.setItem(RELOADED_KEY, served as string);
          window.location.reload();
        }
      } catch {
        // Offline or transient failure — the next foreground event retries.
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void check();
    };

    void check();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return null;
}
