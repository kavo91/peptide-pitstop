"use client";

import { logout } from "@/app/actions/auth";

/**
 * Sign-out form. Before the session cookie goes, the service worker's shell
 * cache is purged: it holds full server-rendered HTML of every visited page
 * (for /body, DEXA and RMR figures), which otherwise stayed readable offline
 * after sign-out. Cache Storage is cleared from the page AND the SW is told,
 * so the purge does not depend on which side is alive.
 */
async function purgeShellCache(): Promise<void> {
  try {
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    if ("serviceWorker" in navigator) navigator.serviceWorker.controller?.postMessage({ type: "PEPTIDE_SIGN_OUT" });
  } catch (err) {
    console.warn("[SW] cache purge on sign-out failed:", err);
  }
}

export function SignOutButton({ className }: { className?: string }) {
  return (
    <form
      className={className}
      action={async () => {
        await purgeShellCache();
        await logout();
      }}
    >
      <button type="submit" className="w-full rounded-control bg-surface px-4 py-3 text-sm font-medium text-danger ring-1 ring-line/10">Sign out</button>
    </form>
  );
}
