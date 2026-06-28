-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Prescription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "peptideId" TEXT,
    "stackId" TEXT,
    "prescriber" TEXT,
    "pharmacy" TEXT,
    "source" TEXT,
    "cost" DECIMAL,
    "currency" TEXT DEFAULT 'AUD',
    "quantity" INTEGER,
    "refillsAuthorized" INTEGER,
    "refillsRemaining" INTEGER,
    "dateWritten" DATETIME,
    "nextRefill" DATETIME,
    "expiration" DATETIME,
    "doseInstructions" TEXT,
    "leadTimeDays" INTEGER,
    "sourceDocumentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    CONSTRAINT "Prescription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Prescription_peptideId_fkey" FOREIGN KEY ("peptideId") REFERENCES "Peptide" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Prescription_stackId_fkey" FOREIGN KEY ("stackId") REFERENCES "Stack" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Prescription_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "Document" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Prescription" ("cost", "currency", "dateWritten", "doseInstructions", "expiration", "id", "leadTimeDays", "nextRefill", "peptideId", "pharmacy", "prescriber", "quantity", "refillsAuthorized", "refillsRemaining", "source", "sourceDocumentId", "status", "userId") SELECT "cost", "currency", "dateWritten", "doseInstructions", "expiration", "id", "leadTimeDays", "nextRefill", "peptideId", "pharmacy", "prescriber", "quantity", "refillsAuthorized", "refillsRemaining", "source", "sourceDocumentId", "status", "userId" FROM "Prescription";
DROP TABLE "Prescription";
ALTER TABLE "new_Prescription" RENAME TO "Prescription";
CREATE TABLE "new_Protocol" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "peptideId" TEXT NOT NULL,
    "prescriptionId" TEXT,
    "stackId" TEXT,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "scheduleType" TEXT NOT NULL DEFAULT 'fixed_times',
    "scheduleRule" TEXT,
    "rebaseMode" TEXT NOT NULL DEFAULT 'fixed_anchor',
    "adherenceWindowMin" INTEGER NOT NULL DEFAULT 120,
    "defaultSyringeId" TEXT,
    "targetDose" DECIMAL,
    "doseInputUnit" TEXT NOT NULL DEFAULT 'mcg',
    "doseBasis" TEXT NOT NULL DEFAULT 'per_injection',
    "startDate" DATETIME,
    "endDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'active',
    CONSTRAINT "Protocol_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Protocol_peptideId_fkey" FOREIGN KEY ("peptideId") REFERENCES "Peptide" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Protocol_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Protocol_stackId_fkey" FOREIGN KEY ("stackId") REFERENCES "Stack" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Protocol" ("adherenceWindowMin", "defaultSyringeId", "doseBasis", "doseInputUnit", "endDate", "id", "name", "peptideId", "prescriptionId", "rebaseMode", "scheduleRule", "scheduleType", "source", "stackId", "startDate", "status", "targetDose", "userId") SELECT "adherenceWindowMin", "defaultSyringeId", "doseBasis", "doseInputUnit", "endDate", "id", "name", "peptideId", "prescriptionId", "rebaseMode", "scheduleRule", "scheduleType", "source", "stackId", "startDate", "status", "targetDose", "userId" FROM "Protocol";
DROP TABLE "Protocol";
ALTER TABLE "new_Protocol" RENAME TO "Protocol";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
