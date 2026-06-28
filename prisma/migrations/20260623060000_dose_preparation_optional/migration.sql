-- Make DoseLog.preparationId nullable so oral / non-injection doses (no vial,
-- no reconstitution) can be logged. SQLite requires a table rebuild to change
-- nullability; INSERT...SELECT preserves every existing row unchanged.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DoseLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "clientUuid" TEXT NOT NULL,
    "preparationId" TEXT,
    "protocolId" TEXT,
    "plannedDoseId" TEXT,
    "takenAt" DATETIME NOT NULL,
    "scheduledAt" DATETIME,
    "deltaMinutes" INTEGER,
    "doseMcg" DECIMAL NOT NULL,
    "doseInputUnit" TEXT NOT NULL,
    "volumeMl" DECIMAL NOT NULL,
    "syringeUnits" DECIMAL,
    "syringeId" TEXT,
    "injectionSite" TEXT,
    "route" TEXT,
    "source" TEXT NOT NULL DEFAULT 'app',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DoseLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DoseLog_preparationId_fkey" FOREIGN KEY ("preparationId") REFERENCES "Preparation" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DoseLog_protocolId_fkey" FOREIGN KEY ("protocolId") REFERENCES "Protocol" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DoseLog_plannedDoseId_fkey" FOREIGN KEY ("plannedDoseId") REFERENCES "PlannedDose" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DoseLog_syringeId_fkey" FOREIGN KEY ("syringeId") REFERENCES "Syringe" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_DoseLog" ("id","userId","clientUuid","preparationId","protocolId","plannedDoseId","takenAt","scheduledAt","deltaMinutes","doseMcg","doseInputUnit","volumeMl","syringeUnits","syringeId","injectionSite","route","source","notes","createdAt") SELECT "id","userId","clientUuid","preparationId","protocolId","plannedDoseId","takenAt","scheduledAt","deltaMinutes","doseMcg","doseInputUnit","volumeMl","syringeUnits","syringeId","injectionSite","route","source","notes","createdAt" FROM "DoseLog";
DROP TABLE "DoseLog";
ALTER TABLE "new_DoseLog" RENAME TO "DoseLog";
CREATE UNIQUE INDEX "DoseLog_clientUuid_key" ON "DoseLog"("clientUuid");
CREATE UNIQUE INDEX "DoseLog_plannedDoseId_key" ON "DoseLog"("plannedDoseId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
