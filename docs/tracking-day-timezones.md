# Dose timestamps, tracking days, and timezones

Peptide Pitstop separates the instant a dose was recorded from the day and clock time shown to the person using the app.

## Timestamp contract

- An untouched **Log now** action uses the server clock as the authoritative instant. Prisma stores that instant in UTC.
- A manually selected or historical time remains the instant explicitly selected by the user.
- If a Log now request must be replayed from the offline outbox, the replay preserves the instant captured before the connection failed. It does not substitute the later reconnect time.
- Elapsed-time, ordering, half-life modelling, and titration calculations use the authoritative instant rather than the phone's wall clock.

## Phone-local display

When the client can report an IANA timezone, the dose records that zone alongside the UTC instant. Doses timelines and PDF exports render the recorded instant in that logging-phone timezone. Legacy rows without a timezone continue to use the runtime timezone.

CSV dose exports include `takenAt`, `localDay`, and `tz` so both the absolute instant and the display/day context remain explicit.

## The 02:00 tracking-day boundary

The tracking day follows the phone timezone and rolls at 02:00:

- 00:00 through 01:59 belongs to the preceding tracking day.
- 02:00 starts the new tracking day.

For example, a dose recorded at 01:03 in `America/Santiago` retains its real UTC instant and displays as 01:03, but its `localDay` is the preceding date.

The server recomputes the tracking day from the authoritative instant and a valid phone timezone. This corrects stale calendar-day stamps from older clients. When no valid timezone is available, the server retains the validated client day as a compatibility fallback.

## Planned-dose reconciliation

Matching uses the frozen tracking day rather than the server's calendar day. During the after-midnight buffer, an unlinked planned row from the preceding day remains eligible even if a server-side job has already marked it missed. A successful match marks that planned row taken; deleting the dose restores it to planned or missed according to its scheduled date.

This changes tracking and reconciliation only. It does not create a regimen, recommend a dose, or alter protocol quantities.
