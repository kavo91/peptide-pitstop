"use client";

import { Bell, BellOff, Send } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Web Push enrolment for THIS device. Dose reminders then arrive as native
 * notifications from the installed PWA (tap opens the app), instead of the
 * Home Assistant relay (which remains the fallback for unenrolled devices).
 *
 * iOS: Web Push only works from a Home-Screen-installed web app (16.4+), and
 * the permission prompt must come from a user gesture — hence the button.
 */

type Status =
  | "loading"      // feature detection in flight
  | "unsupported"  // no SW/Push API in this browser context
  | "ios-browser"  // iOS but NOT running standalone — must install first
  | "off"          // supported, not subscribed
  | "on"           // subscribed on this device
  | "denied";      // notification permission denied at the OS level

/** Base64url VAPID public key → the BufferSource subscribe() expects. */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  // Explicit ArrayBuffer backing keeps TS's BufferSource (non-shared) contract.
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function PushNotificationsCard() {
  const [status, setStatus] = useState<Status>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        // iOS Safari (not installed) has no Push API in the browser context —
        // steer the user to install the PWA rather than calling it unsupported.
        const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        const standalone =
          window.matchMedia("(display-mode: standalone)").matches ||
          (navigator as unknown as { standalone?: boolean }).standalone === true;
        setStatus(iOS && !standalone ? "ios-browser" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        setStatus("denied");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        setStatus(sub ? "on" : "off");
      } catch {
        setStatus("off");
      }
    })();
  }, []);

  async function enable() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const cfg = await fetch("/api/push").then((r) => r.json());
      if (!cfg.configured || !cfg.publicKey) {
        setError("Server push keys are not configured (VAPID).");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "off");
        if (permission === "denied") setError("Notifications are blocked for this app in system settings.");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(cfg.publicKey),
        }));
      const res = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!res.ok) throw new Error(`save failed (${res.status})`);
      setStatus("on");
      setInfo("This device now gets dose reminders directly from the app.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not enable notifications.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setStatus("off");
      setInfo("Reminders for this device fall back to the Home Assistant relay.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not disable notifications.");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `test failed (${res.status})`);
      setInfo(`Test sent (${body.delivered} device${body.delivered === 1 ? "" : "s"}).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Test failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8">
      <h2 className="mb-1 text-sm font-medium text-muted">Notifications</h2>
      <p className="mb-3 text-sm text-muted">
        Dose reminders as push notifications from this app — per-slot times plus an evening catch-up nag.
      </p>
      <div className="rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
        {status === "loading" && <p className="text-sm text-muted">Checking this device…</p>}

        {status === "unsupported" && (
          <p className="text-sm text-muted">This browser doesn&apos;t support push notifications.</p>
        )}

        {status === "ios-browser" && (
          <p className="text-sm text-muted">
            On iPhone, first <span className="font-medium text-ink">install the app</span> (Share → Add to Home
            Screen), then open it from the home screen and enable notifications here.
          </p>
        )}

        {status === "denied" && (
          <p className="text-sm text-muted">
            Notifications are blocked for this app. Allow them in system settings, then reopen the app.
          </p>
        )}

        {(status === "off" || status === "on") && (
          <div className="flex flex-wrap items-center gap-2">
            {status === "off" ? (
              <button
                type="button"
                onClick={enable}
                disabled={busy}
                className="rounded-control bg-accent px-4 py-2 text-sm font-medium text-onAccent disabled:opacity-40"
              >
                <Bell className="mr-1.5 inline h-4 w-4 align-[-0.125em]" aria-hidden />
                {busy ? "…" : "Enable on this device"}
              </button>
            ) : (
              <>
                <span className="rounded-full bg-ok/10 px-2 py-1 text-xs font-medium text-ok">Enabled on this device</span>
                <button
                  type="button"
                  onClick={sendTest}
                  disabled={busy}
                  className="rounded-control bg-line/[0.08] px-3 py-2 text-sm font-medium text-ink disabled:opacity-40"
                >
                  <Send className="mr-1.5 inline h-4 w-4 align-[-0.125em]" aria-hidden />Send test
                </button>
                <button
                  type="button"
                  onClick={disable}
                  disabled={busy}
                  className="rounded-control bg-warn/10 px-3 py-2 text-sm font-medium text-warn ring-1 ring-warn/20 disabled:opacity-40"
                >
                  <BellOff className="mr-1.5 inline h-4 w-4 align-[-0.125em]" aria-hidden />Disable
                </button>
              </>
            )}
          </div>
        )}

        {info && <p className="mt-2 text-sm text-ok">{info}</p>}
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      </div>
    </section>
  );
}
