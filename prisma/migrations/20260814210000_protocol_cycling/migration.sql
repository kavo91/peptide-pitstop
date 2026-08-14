-- Protocol cycling plan: a COURSE-level on/off plan in WEEKS.
--
-- WHY: protocols could express an intra-week dosing rhythm (the schedule rule's
-- `cycle` DayPattern, in DAYS) but had no way to say "run this for 8 weeks then
-- stop". Users tracked planned stop dates in their head or crammed them into
-- `endDate`, which the resolver treats as a hard schedule bound rather than a
-- plan — so nothing could warn before the stop, and nothing could plan a restart.
--
-- WHAT:
--   cycleOnWeeks   weeks to run before a deliberate stop. NULL = continuous.
--   cycleOffWeeks  weeks off before restarting.           NULL = no restart.
--   cycleAnchor    start of the CURRENT on-cycle. NULL falls back to startDate,
--                  so every existing protocol reads correctly with no backfill.
--
-- All three are nullable with no default: every existing row keeps its exact
-- current behaviour (no cycle plan = no banners, no cycle notifications).
-- Date-only convention (UTC midnight), matching startDate/endDate.
ALTER TABLE "Protocol" ADD COLUMN "cycleOnWeeks" INTEGER;
ALTER TABLE "Protocol" ADD COLUMN "cycleOffWeeks" INTEGER;
ALTER TABLE "Protocol" ADD COLUMN "cycleAnchor" DATETIME;
