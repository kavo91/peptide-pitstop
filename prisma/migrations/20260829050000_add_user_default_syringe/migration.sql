-- Hand-written ALTER (additive nullable column; no RedefineTables rebuild —
-- the established ruling). Soft pointer: no FK, validated at write, cleared
-- by deleteSyringe.
ALTER TABLE "User" ADD COLUMN "defaultSyringeId" TEXT;
