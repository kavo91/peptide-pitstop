-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Protocol" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "peptideId" TEXT NOT NULL,
    "prescriptionId" TEXT,
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
    CONSTRAINT "Protocol_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Protocol" ("adherenceWindowMin", "defaultSyringeId", "doseInputUnit", "endDate", "id", "name", "peptideId", "prescriptionId", "rebaseMode", "scheduleRule", "scheduleType", "source", "startDate", "status", "targetDose", "userId") SELECT "adherenceWindowMin", "defaultSyringeId", "doseInputUnit", "endDate", "id", "name", "peptideId", "prescriptionId", "rebaseMode", "scheduleRule", "scheduleType", "source", "startDate", "status", "targetDose", "userId" FROM "Protocol";
DROP TABLE "Protocol";
ALTER TABLE "new_Protocol" RENAME TO "Protocol";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
