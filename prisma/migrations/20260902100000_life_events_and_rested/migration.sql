-- AlterTable
ALTER TABLE "MetabolicTest" ADD COLUMN "prepRested" BOOLEAN;

-- CreateTable
CREATE TABLE "LifeEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "startDay" TEXT NOT NULL,
    "endDay" TEXT NOT NULL,
    "label" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LifeEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "LifeEvent_userId_startDay_idx" ON "LifeEvent"("userId", "startDay");
