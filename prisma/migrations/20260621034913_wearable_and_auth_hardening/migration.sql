-- CreateTable
CREATE TABLE "WearableDaily" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "source" TEXT NOT NULL,
    "sleepSeconds" INTEGER,
    "sleepDeepSeconds" INTEGER,
    "sleepLightSeconds" INTEGER,
    "sleepRemSeconds" INTEGER,
    "sleepAwakeSeconds" INTEGER,
    "sleepScore" INTEGER,
    "restingHr" INTEGER,
    "hrvMs" DECIMAL,
    "hrvStatus" TEXT,
    "bodyBatteryHigh" INTEGER,
    "bodyBatteryLow" INTEGER,
    "stressAvg" INTEGER,
    "weightKg" DECIMAL,
    "bmi" DECIMAL,
    "bodyFatPct" DECIMAL,
    "steps" INTEGER,
    "caloriesActive" INTEGER,
    "vo2max" DECIMAL,
    "intensityMinutes" INTEGER,
    "spo2Avg" INTEGER,
    "respirationAvg" DECIMAL,
    "raw" TEXT,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WearableDaily_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "totpSecret" TEXT,
    "role" TEXT NOT NULL DEFAULT 'owner',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reorderLeadTimeDays" INTEGER DEFAULT 14,
    "reorderBufferDays" INTEGER DEFAULT 3,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "lastTotpStep" INTEGER
);
INSERT INTO "new_User" ("createdAt", "email", "id", "passwordHash", "reorderBufferDays", "reorderLeadTimeDays", "role", "totpSecret") SELECT "createdAt", "email", "id", "passwordHash", "reorderBufferDays", "reorderLeadTimeDays", "role", "totpSecret" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "WearableDaily_userId_date_source_key" ON "WearableDaily"("userId", "date", "source");
