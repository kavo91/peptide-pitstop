/**
 * Peptide Pitstop — app-shell service worker.
 *
 * Strategy:
 *   • Navigation requests (HTML documents) → NETWORK-FIRST. App Router / RSC
 *     pages embed build-specific payloads in their HTML, so serving cached HTML
 *     to a freshly-loaded JS bundle causes hydration mismatches ("Text content
 *     does not match server-rendered HTML"). We always fetch fresh HTML when
 *     online and fall back to the cached shell only when the network is down.
 *   • Static shell assets (manifest, icons) → cache-first (safe, rarely change).
 *   • API / server-action / _next routes → network-only (never cached).
 *
 * The offline outbox (outbox.ts) handles dose-log replay on reconnect;
 * this SW only provides offline navigation (shows cached shell pages).
 *
 * Background Sync is registered here as an OPTIONAL enhancement for Chrome/Android.
 * The primary replay path is the `online` event wired in the client components.
 */

// Bumped v1 → v2: the v1 cache-first strategy poisoned the cache with stale
// page HTML. The activate handler below purges any cache != CACHE_NAME, so
// bumping this name evicts the bad v1 entries on next activation.
const CACHE_NAME = "peptide-shell-v5";

// App shell routes — pages that should load offline (no data, just the shell).
// IMPORTANT: cache.addAll() is atomic — one 404 aborts the entire install.
// Only list routes that genuinely exist. "/history" is NOT a real route and
// must not be included here.
const SHELL_URLS = [
  "/",
  "/doses",
  "/inventory",
  "/more",
  "/manifest.webmanifest",
  "/icons/icon-pitstop.svg",
  "/icons/icon-pitstop-192.png",
  "/icons/icon-pitstop-512.png",
  "/icons/icon-pitstop-maskable-512.png",
  "/icons/apple-touch-icon-pitstop.png",
  "/icons/favicon-32.png",
];

// ── Install: pre-cache shell ──────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS))
  );
  // Activate immediately without waiting for old tabs to close.
  self.skipWaiting();
});

// ── Activate: prune old caches ────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    )
  );
  // Take control of uncontrolled clients immediately.
  self.clients.claim();
});

// ── Fetch: navigations = network-first; static = cache-first; API = network ──
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept POST / server actions / _next internals / API routes.
  if (
    request.method !== "GET" ||
    url.pathname.startsWith("/_next/") ||
    url.pathname.startsWith("/api/")
  ) {
    return; // fall through to network
  }

  // Navigation requests (HTML documents) → NETWORK-FIRST.
  // Caching HTML and serving it to a fresh JS bundle breaks RSC hydration, so
  // we always go to the network when online and only use the cached shell as an
  // offline fallback.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached ?? caches.match("/"))
        )
    );
    return;
  }

  // Static shell assets (manifest, icons, etc.) → cache-first.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});

// ── Background Sync (Chrome/Android only — optional enhancement) ──────────────
self.addEventListener("sync", (event) => {
  if (event.tag === "peptide-outbox-sync") {
    // Signal the page to flush; the page holds the outbox and auth context.
    // We post a message; the client component listens and calls flush().
    event.waitUntil(
      self.clients.matchAll({ type: "window" }).then((clients) => {
        for (const client of clients) {
          client.postMessage({ type: "PEPTIDE_SYNC" });
        }
      })
    );
  }
});
