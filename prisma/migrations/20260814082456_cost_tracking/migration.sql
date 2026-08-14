-- Cost tracking — invoices (Purchase), their lines (PurchaseItem), and the link
-- from a vial to the line that bought it.
--
-- EXPAND-ONLY (MIGRATIONS.md rule 1). Prisma's generated SQL for the new
-- Vial.purchaseItemId FK was a full RedefineTables rebuild — CREATE new_Vial /
-- INSERT..SELECT / DROP Vial / RENAME. Vial holds real, unrecoverable data and
-- is the parent of Preparation → DoseLog, so that rebuild is replaced here with
-- a plain additive ALTER. SQLite permits ADD COLUMN with a REFERENCES clause as
-- long as the default is NULL, which it is. Precedent: Protocol.vialId
-- (20260626120000) was added the same way. Verified zero drift against the
-- schema with `prisma migrate diff` after applying.
--
-- Nothing is backfilled. NULL purchaseItemId means "no cost data recorded for
-- this vial"; the analytics layer reports those vials as UNCOSTED rather than
-- assuming a zero price, so an incomplete ledger can never quietly understate
-- spend. The previous image runs unchanged against this schema.

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "vendor" TEXT,
    "reference" TEXT,
    "orderedAt" DATETIME NOT NULL,
    "receivedAt" DATETIME,
    "currency" TEXT NOT NULL DEFAULT 'AUD',
    "shippingCost" DECIMAL NOT NULL DEFAULT 0,
    "taxCost" DECIMAL NOT NULL DEFAULT 0,
    "otherFees" DECIMAL NOT NULL DEFAULT 0,
    "discount" DECIMAL NOT NULL DEFAULT 0,
    "allocationMethod" TEXT NOT NULL DEFAULT 'value',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Purchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PurchaseItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "purchaseId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "peptideId" TEXT,
    "category" TEXT,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitCost" DECIMAL NOT NULL,
    "unitsPerPack" INTEGER,
    "unitsPerDose" DECIMAL,
    "sortIndex" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PurchaseItem_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PurchaseItem_peptideId_fkey" FOREIGN KEY ("peptideId") REFERENCES "Peptide" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- AlterTable (additive; replaces Prisma's RedefineTables rebuild of Vial)
ALTER TABLE "Vial" ADD COLUMN "purchaseItemId" TEXT REFERENCES "PurchaseItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "Purchase_userId_orderedAt_idx" ON "Purchase"("userId", "orderedAt");

-- CreateIndex
CREATE INDEX "PurchaseItem_purchaseId_idx" ON "PurchaseItem"("purchaseId");
