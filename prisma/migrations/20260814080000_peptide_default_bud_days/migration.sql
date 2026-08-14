-- Per-peptide beyond-use-date default, in whole days.
-- NULL means "no peptide-specific default" and falls back to BUD_DEFAULT_DAYS
-- (28) in src/lib/bud.ts. Nullable + no backfill on purpose: an existing
-- peptide with no explicit value must keep resolving to the global default,
-- not be frozen at whatever today's default happens to be.
-- AlterTable
ALTER TABLE "Peptide" ADD COLUMN "defaultBudDays" INTEGER;
