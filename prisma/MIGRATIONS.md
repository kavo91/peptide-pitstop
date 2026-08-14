# Migration rules

Your instance holds health data with no upstream source. A dropped column is not
recoverable from anywhere but a backup, so these rules exist to make every
deploy rollback-able by default.

## The safety net, and its one hole

| Layer | Protects against | Does NOT protect against |
|---|---|---|
| **Litestream** — continuous replication to the `/backup` replica | disk failure, accidental deletion, container loss | **a bad migration** — it replicates the bad write within its monitor interval |
| **Migrate-on-start** — the entrypoint runs `migrate deploy` before serving | serving against a schema the code does not expect | a migration that *succeeds* and corrupts data |
| **Pre-migration snapshot** — labelled `.backup` written before migrating | exactly the hole above | nothing else; it is the last resort |

The pre-migration snapshot is the only defence against a migration that runs
cleanly and destroys data, because that is the one failure continuous
replication faithfully copies.

It fires only when `migrate status` reports pending migrations or drift, so
ordinary restarts stay fast. It lands in `/backup/pre-migrate/` when the bundled
compose mounts a backup volume, and beside the database otherwise; set
`PRE_MIGRATE_DIR` to control it and `PRE_MIGRATE_KEEP` to change how many are
retained (default 10). It is **non-fatal by design** — a missing backup
directory warns loudly rather than bricking your container.

Restore from one:

```bash
docker compose stop
cp ./backup/pre-migrate/<stamp>-v<version>.db ./data/peptides.db
rm -f ./data/peptides.db-wal ./data/peptides.db-shm
# then pin the image back to the matching tag before starting
docker compose up -d
```

The snapshot is a single self-contained file — it is written with SQLite's
`.backup`, not `cp`, because the database runs in WAL mode and a plain file copy
is torn (missing everything still in the `-wal`).

## Rule 1 — expand only

**Never `DROP`, `RENAME` or narrow a column in the same release as the code
change that stops using it.** Split it across two releases:

1. **Expand.** Add the new nullable column / table. Ship code that writes both
   and reads the new one, falling back to the old.
2. **Contract.** A later release, once the expand release has been running
   happily, removes the old column.

Why it matters: an additive nullable column means **the previous image still
runs against the new schema**. Rolling back is then just re-pinning the image
tag — no schema surgery, no restore. Break this rule and rollback stops being a
one-liner exactly when you most need it to be one.

New columns should be nullable with no backfill unless the backfill is provably
total. `Peptide.defaultBudDays` is the reference example: null means "no
peptide-specific value", which resolves to the global default at read time. Had
it been backfilled with 28, every existing peptide would have been frozen at
that day's default and could never track a future change to it.

## Rule 2 — data migrations are one-way, so treat them differently

A schema migration is undone by rolling back the image. A **data** migration is
not: reverting to the previous image does not un-normalise a column. So:

- **Make it idempotent.** Re-running must be a no-op. Use a `WHERE` clause that
  excludes already-migrated rows, and verify a second run changes nothing.
- **Rehearse against a copy of real data before shipping**, not against seed
  data. Seed data does not contain the historical weirdness that motivated the
  migration in the first place.
- **Assert invariants either side** — row counts, NULL counts, and the specific
  property being fixed.
- **Say in the migration comment what information is lost**, if any, and why
  that is acceptable.

`20260814093000_normalise_beyond_use_date` is the worked example: idempotent by
`WHERE`, and its comment states that the dropped time-of-day component was an
artefact never displayed or compared.

## Rule 3 — the DateTime conventions are load-bearing

Three conventions, each internally consistent across every stored row. A
migration that introduces a fourth, or writes a field in the wrong one, is a bug
even if every test passes:

| Convention | Storage | Fields |
|---|---|---|
| **Date-only** | UTC midnight | `Vial.expiry`, `Protocol.startDate`/`endDate`, `LabPanel.collectedDate`, `JournalEntry.date`, `Prescription.dateWritten`/`expiration`/`nextRefill`, `Preparation.beyondUseDate` |
| **Local midnight** | local midnight of the wellness day | `WearableDaily.date` |
| **Instant** | true instant | `DoseLog.takenAt`, `PlannedDose.scheduledAt`, `Preparation.reconstitutedAt`, all `createdAt` |

Render date-only with `.toISOString().slice(0, 10)` and instants in local time.
Getting this backwards is silent: it looks right in UTC and in any
positive-offset zone at the right hour, and wrong everywhere else.
`Preparation.beyondUseDate` had drifted into holding all three at once — see
`src/lib/bud.ts`.

Check a field's convention against the data, not the code:

```sql
SELECT sum(CASE WHEN col % 86400000 = 0 THEN 1 ELSE 0 END) AS utc_midnight,
       sum(CASE WHEN col % 86400000 <> 0 THEN 1 ELSE 0 END) AS other
FROM "Table" WHERE col IS NOT NULL;
```

## Pre-flight checklist

- [ ] `npx tsc --noEmit` and `npm test` clean
- [ ] Migration is expand-only, or the contract step is a separate later release
- [ ] Any data migration is idempotent and rehearsed against a **copy of real data**
- [ ] Invariants asserted either side of the rehearsal
- [ ] Verified on a non-production instance first
