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
    "lastTotpStep" INTEGER,
    "hydrationTargetMl" INTEGER,
    "symptomList" TEXT,
    "untimedReminderTime" TEXT NOT NULL DEFAULT '08:00',
    "nagTime" TEXT NOT NULL DEFAULT '18:00',
    "nagEnabled" BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO "new_User" ("createdAt", "email", "hydrationTargetMl", "id", "lastTotpStep", "passwordHash", "reorderBufferDays", "reorderLeadTimeDays", "role", "symptomList", "tokenVersion", "totpSecret") SELECT "createdAt", "email", "hydrationTargetMl", "id", "lastTotpStep", "passwordHash", "reorderBufferDays", "reorderLeadTimeDays", "role", "symptomList", "tokenVersion", "totpSecret" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
