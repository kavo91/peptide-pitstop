-- Training metrics on WearableDaily (Fenix 9 Pro era). Hand-written as plain ADD COLUMN
-- statements: every column is nullable, so this is additive, keeps the existing rows in
-- place, and the previous image still runs against the new schema (rollback = image re-pin).
-- Prisma would have generated a RedefineTables block here; that is a drop-and-copy of real
-- wearable data and is forbidden (prisma/MIGRATIONS.md rule 1).
ALTER TABLE "WearableDaily" ADD COLUMN "trainingReadiness" INTEGER;
ALTER TABLE "WearableDaily" ADD COLUMN "trainingReadinessLevel" TEXT;
ALTER TABLE "WearableDaily" ADD COLUMN "acuteLoad" INTEGER;
ALTER TABLE "WearableDaily" ADD COLUMN "chronicLoad" INTEGER;
ALTER TABLE "WearableDaily" ADD COLUMN "acwr" DECIMAL;
ALTER TABLE "WearableDaily" ADD COLUMN "acwrStatus" TEXT;
ALTER TABLE "WearableDaily" ADD COLUMN "trainingStatus" TEXT;
ALTER TABLE "WearableDaily" ADD COLUMN "enduranceScore" INTEGER;
ALTER TABLE "WearableDaily" ADD COLUMN "hillScore" INTEGER;
ALTER TABLE "WearableDaily" ADD COLUMN "fitnessAge" DECIMAL;
ALTER TABLE "WearableDaily" ADD COLUMN "ltHr" INTEGER;
ALTER TABLE "WearableDaily" ADD COLUMN "ltSpeedMs" DECIMAL;
ALTER TABLE "WearableDaily" ADD COLUMN "floorsClimbed" INTEGER;
ALTER TABLE "WearableDaily" ADD COLUMN "restingHr7d" INTEGER;
