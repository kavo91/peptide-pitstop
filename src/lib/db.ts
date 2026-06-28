import { PrismaClient } from "@prisma/client";

// Prisma singleton — avoids exhausting connections during dev hot-reload.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; walEnsured?: boolean };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/** Minimal shape we need — keeps the helper unit-testable without a real client. */
type WalCapable = { $queryRawUnsafe: (query: string) => Promise<unknown> };

/**
 * Enable SQLite WAL mode once per process. Required for Litestream (it streams
 * the `-wal` file) and improves read/write concurrency. WAL is a persistent
 * property of the database file, so this is effectively a one-time switch and
 * re-running it is a harmless no-op. Fire-and-forget — must never block startup.
 *
 * NB: `PRAGMA journal_mode=WAL` RETURNS a row (the resulting mode), so it must
 * go through `$queryRawUnsafe` — `$executeRawUnsafe` expects an affected-row
 * count and throws on the result set (even though the mode change still takes).
 */
export async function ensureWalMode(client: WalCapable = prisma): Promise<void> {
  if (globalForPrisma.walEnsured) return;
  globalForPrisma.walEnsured = true;
  try {
    await client.$queryRawUnsafe("PRAGMA journal_mode=WAL;");
  } catch (err) {
    globalForPrisma.walEnsured = false; // allow a later retry
    console.error("[db] failed to enable WAL mode:", err);
  }
}

// Server runtime only (Edge has no SQLite access; scripts/tests leave it unset).
if (process.env.NEXT_RUNTIME === "nodejs") void ensureWalMode();
