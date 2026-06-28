import { describe, it, expect, vi, beforeEach } from "vitest";
import { ensureWalMode } from "./db";

// ensureWalMode guards on a module-level global flag; reset it between tests.
const resetWalFlag = () => {
  (globalThis as unknown as { walEnsured?: boolean }).walEnsured = false;
};

describe("ensureWalMode", () => {
  beforeEach(resetWalFlag);

  it("sets SQLite journal_mode to WAL exactly once", async () => {
    const client = { $queryRawUnsafe: vi.fn().mockResolvedValue(undefined) };
    await ensureWalMode(client);
    expect(client.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(client.$queryRawUnsafe).toHaveBeenCalledWith("PRAGMA journal_mode=WAL;");
  });

  it("is idempotent — a second call is a no-op", async () => {
    const client = { $queryRawUnsafe: vi.fn().mockResolvedValue(undefined) };
    await ensureWalMode(client);
    await ensureWalMode(client);
    expect(client.$queryRawUnsafe).toHaveBeenCalledTimes(1);
  });

  it("clears the guard on failure so a later call can retry", async () => {
    const failing = { $queryRawUnsafe: vi.fn().mockRejectedValue(new Error("locked")) };
    await ensureWalMode(failing);
    const ok = { $queryRawUnsafe: vi.fn().mockResolvedValue(undefined) };
    await ensureWalMode(ok);
    expect(ok.$queryRawUnsafe).toHaveBeenCalledTimes(1);
  });
});
