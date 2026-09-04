/**
 * public/sw.js — service-worker caching strategy.
 *
 * The SW is a plain script (no module exports), so we evaluate it inside a
 * node:vm sandbox that mimics the minimum ServiceWorkerGlobalScope surface it
 * touches (self.addEventListener, caches, fetch, clients, registration) and
 * then dispatch synthetic FetchEvents at the captured listeners.
 *
 * Regression under test: v4 treated every non-navigation GET as cache-first,
 * including Next RSC/flight refreshes (`RSC: 1`, `Next-Router-*` headers,
 * `Accept: text/x-component`, `?_rsc=`), so router.refresh() after a mutation
 * rendered the stale cached tree until a hard reload.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

type Listener = (event: unknown) => void;

interface FakeRequest {
  url: string;
  method: string;
  mode: RequestMode;
  headers: Headers;
}

interface FakeFetchEvent {
  request: FakeRequest;
  respondWith: ReturnType<typeof vi.fn>;
  waitUntil: ReturnType<typeof vi.fn>;
}

interface Harness {
  listeners: Map<string, Listener[]>;
  store: Map<string, Response>;
  put: ReturnType<typeof vi.fn>;
  fetch: ReturnType<typeof vi.fn>;
  cacheKeys: string[];
  deletedKeys: string[];
  cacheName: string;
  dispatchFetch: (req: FakeRequest) => Promise<{ event: FakeFetchEvent; response: Response | undefined }>;
}

const SW_SOURCE = readFileSync(
  fileURLToPath(new URL("../../public/sw.js", import.meta.url)),
  "utf8"
);

const ORIGIN = "https://example.test";

function makeRequest(
  path: string,
  opts: { mode?: RequestMode; method?: string; headers?: Record<string, string> } = {}
): FakeRequest {
  return {
    url: ORIGIN + path,
    method: opts.method ?? "GET",
    mode: opts.mode ?? "cors",
    headers: new Headers(opts.headers ?? {}),
  };
}

function keyOf(req: FakeRequest | string): string {
  return typeof req === "string" ? ORIGIN + req : req.url;
}

/** Let fire-and-forget `caches.open().then(put)` chains settle. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function loadServiceWorker(opts: {
  fetchImpl: (req: FakeRequest) => Promise<Response>;
  existingCacheKeys?: string[];
}): Harness {
  const listeners = new Map<string, Listener[]>();
  const store = new Map<string, Response>();
  const deletedKeys: string[] = [];

  const put = vi.fn(async (req: FakeRequest, res: Response) => {
    store.set(keyOf(req), res);
  });
  const match = async (req: FakeRequest | string) => store.get(keyOf(req));
  const cache = { addAll: vi.fn(async () => undefined), put, match };

  const fetch = vi.fn(opts.fetchImpl);

  const sandbox: Record<string, unknown> = {
    URL,
    Headers,
    Response,
    Promise,
    console,
    fetch,
    caches: {
      open: async () => cache,
      match,
      keys: async () => opts.existingCacheKeys ?? [],
      delete: vi.fn(async (k: string) => {
        deletedKeys.push(k);
        return true;
      }),
    },
    clients: { claim: vi.fn(), matchAll: vi.fn(async () => []), openWindow: vi.fn() },
    registration: { showNotification: vi.fn() },
    skipWaiting: vi.fn(),
    addEventListener: (type: string, fn: Listener) => {
      const list = listeners.get(type) ?? [];
      list.push(fn);
      listeners.set(type, list);
    },
  };
  sandbox.self = sandbox;

  const context = vm.createContext(sandbox);
  vm.runInContext(SW_SOURCE, context, { filename: "public/sw.js" });

  const cacheName = vm.runInContext("CACHE_NAME", context) as string;

  async function dispatchFetch(request: FakeRequest) {
    const fetchListeners = listeners.get("fetch") ?? [];
    expect(fetchListeners).toHaveLength(1);
    const event: FakeFetchEvent = {
      request,
      respondWith: vi.fn(),
      waitUntil: vi.fn(),
    };
    fetchListeners[0](event);
    let response: Response | undefined;
    if (event.respondWith.mock.calls.length > 0) {
      response = (await event.respondWith.mock.calls[0][0]) as Response;
    }
    await flush();
    return { event, response };
  }

  return {
    listeners,
    store,
    put,
    fetch,
    cacheKeys: opts.existingCacheKeys ?? [],
    deletedKeys,
    cacheName,
    dispatchFetch,
  };
}

const htmlResponse = () =>
  new Response("<html></html>", { status: 200, headers: { "Content-Type": "text/html" } });
const flightResponse = () =>
  new Response("0:[]", { status: 200, headers: { "Content-Type": "text/x-component" } });
const assetResponse = () =>
  new Response("<svg/>", { status: 200, headers: { "Content-Type": "image/svg+xml" } });

describe("public/sw.js fetch strategy", () => {
  let sw: Harness;

  beforeEach(() => {
    sw = loadServiceWorker({
      fetchImpl: async (req) => {
        if (req.headers.get("Accept")?.includes("text/x-component")) return flightResponse();
        if (req.mode === "navigate") return htmlResponse();
        return assetResponse();
      },
    });
  });

  it("registers install/activate/fetch listeners", () => {
    expect(sw.listeners.has("install")).toBe(true);
    expect(sw.listeners.has("activate")).toBe(true);
    expect(sw.listeners.has("fetch")).toBe(true);
  });

  describe("RSC / flight requests are network-only and never stored", () => {
    const cases: Array<[string, FakeRequest]> = [
      ["RSC header", makeRequest("/doses", { headers: { RSC: "1" } })],
      [
        "Next-Router-State-Tree header",
        makeRequest("/doses", { headers: { "Next-Router-State-Tree": "%5B%22%22%5D" } }),
      ],
      ["Next-Router-Prefetch header", makeRequest("/doses", { headers: { "Next-Router-Prefetch": "1" } })],
      ["Accept text/x-component", makeRequest("/doses", { headers: { Accept: "text/x-component" } })],
      ["_rsc query param", makeRequest("/doses?_rsc=1a2b3c")],
      ["_rsc among other params", makeRequest("/doses?view=week&_rsc=1a2b3c")],
    ];

    it.each(cases)("%s → not intercepted, nothing cached", async (_label, request) => {
      const { event } = await sw.dispatchFetch(request);
      expect(event.respondWith).not.toHaveBeenCalled();
      expect(sw.fetch).not.toHaveBeenCalled(); // browser handles it natively
      expect(sw.put).not.toHaveBeenCalled();
      expect(sw.store.size).toBe(0);
    });

    it("does not serve a stale entry even if one is already in the cache", async () => {
      // Simulate a poisoned v4 cache: a flight payload stored under the page path.
      sw.store.set(ORIGIN + "/doses?_rsc=1a2b3c", flightResponse());
      const { event } = await sw.dispatchFetch(makeRequest("/doses?_rsc=1a2b3c", { headers: { RSC: "1" } }));
      expect(event.respondWith).not.toHaveBeenCalled();
    });
  });

  describe("API and non-GET requests are network-only", () => {
    it("GET /api/* falls through", async () => {
      const { event } = await sw.dispatchFetch(makeRequest("/api/version"));
      expect(event.respondWith).not.toHaveBeenCalled();
      expect(sw.put).not.toHaveBeenCalled();
    });

    it("POST (server action) falls through", async () => {
      const { event } = await sw.dispatchFetch(makeRequest("/doses", { method: "POST" }));
      expect(event.respondWith).not.toHaveBeenCalled();
    });

    it("/_next/* internals fall through", async () => {
      const { event } = await sw.dispatchFetch(makeRequest("/_next/static/chunks/main.js"));
      expect(event.respondWith).not.toHaveBeenCalled();
    });
  });

  describe("static assets stay cache-first", () => {
    it("first hit goes to the network and is stored; second hit is served from cache", async () => {
      const req = makeRequest("/icons/icon.svg");

      const first = await sw.dispatchFetch(req);
      expect(first.event.respondWith).toHaveBeenCalledTimes(1);
      expect(sw.fetch).toHaveBeenCalledTimes(1);
      expect(sw.put).toHaveBeenCalledTimes(1);
      expect(sw.store.has(req.url)).toBe(true);
      expect(await first.response?.text()).toBe("<svg/>");

      const second = await sw.dispatchFetch(req);
      expect(second.event.respondWith).toHaveBeenCalledTimes(1);
      expect(sw.fetch).toHaveBeenCalledTimes(1); // no second network trip
      expect(await second.response?.text()).toBe("<svg/>");
    });

    it("does not store a text/x-component response even on a plain GET (defence in depth)", async () => {
      const leaky = loadServiceWorker({ fetchImpl: async () => flightResponse() });
      const { event } = await leaky.dispatchFetch(makeRequest("/doses"));
      expect(event.respondWith).toHaveBeenCalledTimes(1);
      expect(leaky.put).not.toHaveBeenCalled();
    });
  });

  describe("navigations stay network-first with offline fallback", () => {
    it("online: fetches fresh HTML and stores it", async () => {
      const req = makeRequest("/doses", { mode: "navigate" });
      const { event, response } = await sw.dispatchFetch(req);
      expect(event.respondWith).toHaveBeenCalledTimes(1);
      expect(sw.fetch).toHaveBeenCalledTimes(1);
      expect(response?.headers.get("Content-Type")).toBe("text/html");
      expect(sw.store.has(req.url)).toBe(true);
    });

    it("offline: serves the cached shell page", async () => {
      const req = makeRequest("/doses", { mode: "navigate" });
      await sw.dispatchFetch(req); // warm the cache

      sw.fetch.mockImplementationOnce(async () => {
        throw new TypeError("Failed to fetch");
      });
      const { response } = await sw.dispatchFetch(req);
      expect(response).toBeDefined();
      expect(response?.headers.get("Content-Type")).toBe("text/html");
    });

    it("offline with no page entry: falls back to '/'", async () => {
      await sw.dispatchFetch(makeRequest("/", { mode: "navigate" })); // warm "/"
      sw.fetch.mockImplementationOnce(async () => {
        throw new TypeError("Failed to fetch");
      });
      const { response } = await sw.dispatchFetch(makeRequest("/inventory", { mode: "navigate" }));
      expect(response).toBeDefined();
      expect(await response?.text()).toBe("<html></html>");
    });
  });
});

describe("public/sw.js sign-out", () => {
  it("purges the shell cache on a PEPTIDE_SIGN_OUT message — cached signed-in HTML must not outlive the session", async () => {
    const sw = loadServiceWorker({ fetchImpl: async () => htmlResponse() });
    // A signed-in navigation was cached (network-first stores it).
    await sw.dispatchFetch(makeRequest("/body", { mode: "navigate" }));
    expect(sw.put).toHaveBeenCalledTimes(1);

    const message = sw.listeners.get("message") ?? [];
    expect(message).toHaveLength(1);
    let pending: Promise<unknown> | undefined;
    message[0]({ data: { type: "PEPTIDE_SIGN_OUT" }, waitUntil: (p: Promise<unknown>) => (pending = p) });
    await pending;
    expect(sw.deletedKeys).toEqual([sw.cacheName]);

    // Any other message leaves the cache alone.
    message[0]({ data: { type: "PEPTIDE_SYNC" }, waitUntil: (p: Promise<unknown>) => (pending = p) });
    expect(sw.deletedKeys).toEqual([sw.cacheName]);
  });
});

describe("public/sw.js activate", () => {
  it("cache name was bumped past v4 and old caches are deleted on activate", async () => {
    const sw = loadServiceWorker({
      fetchImpl: async () => assetResponse(),
      existingCacheKeys: ["peptide-shell-v3", "peptide-shell-v4", "unrelated"],
    });
    expect(sw.cacheName).not.toBe("peptide-shell-v4");
    expect(sw.cacheName).toMatch(/^peptide-shell-v\d+$/);

    const activate = sw.listeners.get("activate") ?? [];
    expect(activate).toHaveLength(1);
    let pending: Promise<unknown> | undefined;
    activate[0]({ waitUntil: (p: Promise<unknown>) => (pending = p) });
    await pending;
    expect(sw.deletedKeys.sort()).toEqual(["peptide-shell-v3", "peptide-shell-v4", "unrelated"]);
    expect(sw.deletedKeys).not.toContain(sw.cacheName);
  });
});
