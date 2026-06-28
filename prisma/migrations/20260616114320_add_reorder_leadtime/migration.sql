-- AlterTable
ALTER TABLE "Prescription" ADD COLUMN "leadTimeDays" INTEGER;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "reorderBufferDays" INTEGER DEFAULT 3;
ALTER TABLE "User" ADD COLUMN "reorderLeadTimeDays" INTEGER DEFAULT 14;
