-- Eight Sleep bed metrics on WearableDaily. Hand-written as plain ADD COLUMN statements:
-- every column is nullable, so this is additive, keeps the existing rows in place, and the
-- previous image still runs against the new schema (rollback = image re-pin). Never a
-- RedefineTables block (prisma/MIGRATIONS.md rule 1).
ALTER TABLE "WearableDaily" ADD COLUMN "sleepHrAvg" INTEGER;
ALTER TABLE "WearableDaily" ADD COLUMN "tossTurns" INTEGER;
ALTER TABLE "WearableDaily" ADD COLUMN "bedTempC" DECIMAL;
ALTER TABLE "WearableDaily" ADD COLUMN "roomTempC" DECIMAL;
