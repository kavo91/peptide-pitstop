"use client";

import { useEffect } from "react";
import { flush } from "@/lib/offline/outbox";
import { logDose } from "@/app/actions/doses";

/**
 * Registers the service worker and wires the online→flush pipeline.
 *
 * Mounted once in the root layout. All logic is inside useEffect so it never
 * runs during SSR (client-only, as required by the service worker API).
 *
 * Flush strategy (iOS-safe primary path):
 *   • On mount (handles the case where the tab was opened while offline and
 *     the device came back online before the `online` event fired again).
 *   • On the `online` event (reconnect replay).
 *   • On the `PEPTIDE_SYNC` message from the SW (Background Sync — Chrome/Android
 *     optional enhancement; no-op on iOS/Firefox).
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // Register the SW. Errors are logged but never surfaced to the user —
    // the app works fine without a SW; offline is an enhancement.
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("[SW] Registration failed:", err);
    });

    /** Flush the outbox using the real logDose server action. */
    async function flushOutbox() {
      try {
        await flush(async (entry) => {
          return logDose(entry);
        });
      } catch (err) {
        console.warn("[outbox] Flush error:", err);
      }
    }

    // Attempt a flush on mount (covers tab-open-while-offline scenario).
    flushOutbox();

    // Primary replay trigger: online event (iOS-safe).
    window.addEventListener("online", flushOutbox);

    // Optional: Background Sync message from SW (Chrome/Android only).
    function onMessage(event: MessageEvent) {
      if (event.data?.type === "PEPTIDE_SYNC") {
        flushOutbox();
      }
    }
    navigator.serviceWorker.addEventListener("message", onMessage);

    return () => {
      window.removeEventListener("online", flushOutbox);
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, []);

  return null; // renders nothing
}
