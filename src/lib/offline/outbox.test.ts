/**
 * Unit tests for the offline outbox.
 * fake-indexeddb provides an in-memory IndexedDB so tests run in Node/Vitest.
 */
import { describe, it, expect, beforeEach } from "vitest";
// fake-indexeddb must be imported before outbox so the global is available
import "fake-indexeddb/auto";
import { enqueue, peek, flush } from "./outbox";

// Reset the DB between tests by clearing the store.
// outbox.ts opens the DB lazily; re-importing won't reset the store.
// We flush (draining to a no-op replay fn) in beforeEach instead.
beforeEach(async () => {
  // Drain any leftover entries using a no-op replay function.
  await flush(async () => ({ ok: true }));
});

describe("outbox — enqueue / peek / flush ordering", () => {
  it("peek returns empty array when nothing queued", async () => {
    const entries = await peek();
    expect(entries).toEqual([]);
  });

  it("enqueue stores an entry, peek returns it", async () => {
    await enqueue({
      clientUuid: "uuid-a",
      preparationId: "prep-1",
      doseValue: "100",
      doseUnit: "mcg",
    });
    const entries = await peek();
    expect(entries).toHaveLength(1);
    expect(entries[0].clientUuid).toBe("uuid-a");
    expect(entries[0].preparationId).toBe("prep-1");
  });

  it("enqueue multiple entries; peek returns all in insertion order", async () => {
    await enqueue({ clientUuid: "uuid-first", preparationId: "p1", doseValue: "50", doseUnit: "mcg" });
    await enqueue({ clientUuid: "uuid-second", preparationId: "p2", doseValue: "200", doseUnit: "mcg" });
    const entries = await peek();
    expect(entries).toHaveLength(2);
    expect(entries[0].clientUuid).toBe("uuid-first");
    expect(entries[1].clientUuid).toBe("uuid-second");
  });

  it("flush calls the replay fn for each entry and clears the queue on success", async () => {
    await enqueue({ clientUuid: "uuid-flush-1", preparationId: "p1", doseValue: "100", doseUnit: "mcg" });
    await enqueue({ clientUuid: "uuid-flush-2", preparationId: "p2", doseValue: "200", doseUnit: "mcg" });

    const replayed: string[] = [];
    await flush(async (entry) => {
      replayed.push(entry.clientUuid);
      return { ok: true };
    });

    expect(replayed).toEqual(["uuid-flush-1", "uuid-flush-2"]);
    const remaining = await peek();
    expect(remaining).toHaveLength(0);
  });

  it("flush leaves failed entries in the queue for next attempt", async () => {
    await enqueue({ clientUuid: "uuid-ok", preparationId: "p1", doseValue: "100", doseUnit: "mcg" });
    await enqueue({ clientUuid: "uuid-fail", preparationId: "p2", doseValue: "200", doseUnit: "mcg" });

    await flush(async (entry) => {
      if (entry.clientUuid === "uuid-fail") return { ok: false, error: "network error" };
      return { ok: true };
    });

    const remaining = await peek();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].clientUuid).toBe("uuid-fail");
  });

  it("dedup by clientUuid — enqueuing the same uuid twice stores only one entry", async () => {
    await enqueue({ clientUuid: "uuid-dup", preparationId: "p1", doseValue: "100", doseUnit: "mcg" });
    await enqueue({ clientUuid: "uuid-dup", preparationId: "p1", doseValue: "100", doseUnit: "mcg" });
    const entries = await peek();
    expect(entries).toHaveLength(1);
  });
});
