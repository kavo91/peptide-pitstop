-- Normalise Preparation.beyondUseDate onto the app's DATE-ONLY convention
-- (UTC midnight), matching Vial.expiry, Protocol.startDate/endDate,
-- LabPanel.collectedDate, JournalEntry.date and Prescription.*.
--
-- WHY: the column accumulated ALL THREE of the app's conventions at once,
-- because it had three writers. EditPreparationForm wrote UTC midnight from an
-- <input type="date">; ReconWizard wrote `now + N days`, an arbitrary
-- time-of-day instant; an older path wrote local midnight. Rendering a date-only
-- column via .toISOString().slice(0,10) — which is correct for every other
-- date-only field — then showed a day early for the instant rows for anyone
-- east of Greenwich (e.g. UTC+10).
--
-- WHAT: snap each straddling row DOWN to UTC midnight of its own LOCAL
-- calendar day, using the container's TZ (set via the compose TZ env var).
-- 'localtime' reads that same TZ, so this reproduces
-- exactly the day the app displayed to the user at the time.
--
-- INFORMATION LOSS: none that is meaningful. A beyond-use date is a calendar
-- date; the time-of-day component was an artefact of how it was written, never
-- displayed and never used in a comparison that survives this change. The
-- calendar day each row denotes is PRESERVED, not shifted.
--
-- IDEMPOTENT: the WHERE clause excludes rows already at UTC midnight, so
-- re-running is a no-op. Rows with a NULL BUD are untouched.

UPDATE "Preparation"
SET "beyondUseDate" =
      CAST(strftime('%s', date("beyondUseDate" / 1000, 'unixepoch', 'localtime')) AS INTEGER) * 1000
WHERE "beyondUseDate" IS NOT NULL
  AND "beyondUseDate" % 86400000 <> 0;
