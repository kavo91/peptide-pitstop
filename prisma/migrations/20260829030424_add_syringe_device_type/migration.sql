-- Hand-written ALTER in place of Prisma's RedefineTables rebuild (drop+rename
-- with FKs off — needless risk for an additive column; established ruling from
-- the v1.8 cost-tracking migration). SQLite appends the column; Prisma client
-- addresses columns by name, so physical order is irrelevant.
ALTER TABLE "Syringe" ADD COLUMN "deviceType" TEXT NOT NULL DEFAULT 'syringe';
