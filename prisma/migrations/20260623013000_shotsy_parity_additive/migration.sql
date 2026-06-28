-- Shotsy-parity additive columns. All ADD COLUMN (no table rebuild, no data change).
-- JournalEntry: nutrition + hydration
ALTER TABLE "JournalEntry" ADD COLUMN "calories" INTEGER;
ALTER TABLE "JournalEntry" ADD COLUMN "proteinG" DECIMAL;
ALTER TABLE "JournalEntry" ADD COLUMN "waterMl" INTEGER;

-- User: hydration target + custom symptom list
ALTER TABLE "User" ADD COLUMN "hydrationTargetMl" INTEGER;
ALTER TABLE "User" ADD COLUMN "symptomList" TEXT;

-- DoseLog: route snapshot (null = legacy injection)
ALTER TABLE "DoseLog" ADD COLUMN "route" TEXT;

-- Peptide: route (injection | oral); existing rows default to injection
ALTER TABLE "Peptide" ADD COLUMN "route" TEXT NOT NULL DEFAULT 'injection';
