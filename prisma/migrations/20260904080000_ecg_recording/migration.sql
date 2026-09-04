-- Garmin ECG recordings, imported from the Connect PDF export.
--
-- Hand-written: this creates ONE NEW TABLE and adds no column to any existing
-- one, so nothing is copied, dropped or rebuilt. Prisma's generator would emit
-- the same CREATE TABLE here, but every migration in this project is written by
-- hand and diff-checked (prisma/MIGRATIONS.md rule 1) so a RedefineTables block
-- can never slip in unnoticed.
--
-- Rollback = re-pin the previous image: the older code simply never reads this
-- table, and no existing row is touched by creating it.
CREATE TABLE "EcgRecording" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "recordedAt" DATETIME NOT NULL,
    "recordedLocalKey" TEXT NOT NULL,
    "localDay" TEXT NOT NULL,
    "tz" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "avgHeartRateBpm" TEXT,
    "symptoms" TEXT,
    "interpretation" TEXT,
    "leadNote" TEXT,
    "durationSec" INTEGER,
    "paperSpeedMmS" DECIMAL,
    "gainMmMv" DECIMAL,
    "sampleRateHz" INTEGER,
    "deviceModel" TEXT,
    "deviceSoftware" TEXT,
    "ecgAppVersion" TEXT,
    "connectWebVersion" TEXT,
    "pdfTemplateVersion" TEXT,
    "backendVersion" TEXT,
    "waveformJson" TEXT,
    "waveformPoints" INTEGER,
    "sourceHash" TEXT NOT NULL,
    "documentId" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EcgRecording_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EcgRecording_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- One row per PRINTED recording time per user. Keyed on the printed wall clock
-- rather than the instant it resolves to, because the page states no timezone:
-- keying on the instant would store the same report twice if it were imported
-- from devices in two zones.
CREATE UNIQUE INDEX "EcgRecording_userId_recordedLocalKey_key" ON "EcgRecording"("userId", "recordedLocalKey");
CREATE INDEX "EcgRecording_userId_recordedAt_idx" ON "EcgRecording"("userId", "recordedAt");
