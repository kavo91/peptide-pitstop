-- Protocol revision chains.
--
-- courseId groups every revision of one course. NULL means the protocol is its
-- own course, so nothing is backfilled and every existing protocol keeps its
-- exact current behaviour — it simply reads as a course of one.
--
-- Expand-only per prisma/MIGRATIONS.md rule 1: an additive nullable column, so
-- the previous image runs unchanged against this schema and rollback stays an
-- image re-pin. The generator would have emitted a full table rebuild
-- of Protocol for this; that is a drop-and-recreate of a table holding
-- unrecoverable data, so it is hand-written instead and drift-checked.
ALTER TABLE "Protocol" ADD COLUMN "courseId" TEXT;

CREATE INDEX "Protocol_userId_courseId_idx" ON "Protocol"("userId", "courseId");
