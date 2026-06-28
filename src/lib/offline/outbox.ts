/**
 * Offline outbox — IndexedDB queue for dose-log entries that couldn't reach
 * the server (offline / network failure).
 *
 * API surface:
 *   enqueue(entry)        — add to queue; deduplicates by clientUuid (IDB keyPath).
 *   peek()                — read all queued entries in insertion order.
 *   flush(replayFn)       — replay each entry; remove on success, keep on failure.
 *
 * Works in any browser (IDB is baseline-widely-available).
 * In Vitest/Node: `fake-indexeddb/auto` installs a global IDB shim before import.
 */

// MUST be `import type` — type-only imports are erased by esbuild/tsc before
// vitest runs, so the @/ alias is never resolved at runtime and server-only
// code in doses.ts is never dragged into the test bundle.
import type { LogDoseInput } from "@/app/actions/doses";

const DB_NAME = "peptide-offline";
const STORE_NAME = "outbox";
const DB_VERSION = 1;

/** An outbox entry — the full LogDoseInput plus a mandatory clientUuid. */
export type OutboxEntry = LogDoseInput & { clientUuid: string };

/** Open (or reuse) the IDB database. */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        // keyPath = clientUuid gives us dedup for free (IDBRequest throws
        // ConstraintError on duplicate key; we catch and ignore it in enqueue).
        db.createObjectStore(STORE_NAME, { keyPath: "clientUuid" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Add an entry to the outbox. Silently ignores duplicate clientUuids (safe replay). */
export async function enqueue(entry: OutboxEntry): Promise<void> {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).add(entry);
    req.onsuccess = () => resolve();
    // ConstraintError = duplicate clientUuid — already queued, ignore.
    req.onerror = () => resolve();
  });
}

/** Return all queued entries in insertion order (IDB key order = clientUuid order;
 *  adequate for FIFO given clientUuids are generated sequentially per session). */
export async function peek(): Promise<OutboxEntry[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result as OutboxEntry[]);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Replay all queued entries through `replayFn`.
 * Entries that return `{ ok: true }` are removed from the queue.
 * Entries that return `{ ok: false }` are kept for the next flush attempt.
 *
 * Processes entries serially (not Promise.all) so the server sees them in order
 * and clientUuid idempotency on the server handles any duplicate replays safely.
 */
export async function flush(
  replayFn: (entry: OutboxEntry) => Promise<{ ok: boolean; error?: string }>
): Promise<void> {
  const entries = await peek();
  if (entries.length === 0) return;

  const db = await openDB();
  for (const entry of entries) {
    let result: { ok: boolean; error?: string };
    try {
      result = await replayFn(entry);
    } catch {
      // Network error or exception — keep the entry for next attempt.
      continue;
    }
    if (result.ok) {
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).delete(entry.clientUuid);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve(); // best-effort; replay is idempotent server-side
      });
    }
  }
}
