# eight-sleep-sync

Optional Eight Sleep → Peptide Tracker wellness sidecar. Eight Sleep is an
**extra** source beside Garmin: rows land in `WearableDaily` under
`source = "eight_sleep"` and are never merged into Garmin's numbers. The
Wellness page shows them as their own cards ("Sleep · Eight Sleep" and
"Bed · Eight Sleep").

```
Eight Sleep cloud ──/v1/users/{id}/trends──▶ sync.py (no shaping)
                                   │  POST { days: [trendDay, ...] }
                                   ▼  Authorization: Bearer $WELLNESS_IMPORT_TOKEN
                       app  POST /api/wellness/eight-sleep
                                   │  normaliseEightSleepDay() + upsert
                                   ▼
                       WearableDaily (userId, wake-up date, "eight_sleep")
```

- A night is filed under the local date you got **out of bed** (`presenceEnd`),
  the same wake-up day Garmin uses. A night still `processing` is skipped and
  picked up by the next run.
- Runs once on start, then every 15 minutes on the quarter hour, only from 05:00
  to 10:00 (local) — the hours a night gets scored. Each pull reads the last
  `EIGHT_SLEEP_BACKFILL_DAYS` (default 3). Re-pulls are safe.
- The app's "Sync now" button also pulls Eight Sleep at any hour: the app calls
  `POST /sync` on `EIGHT_SLEEP_SYNC_HOST:EIGHT_SLEEP_SYNC_PORT` (default
  `127.0.0.1:8081`, no auth — same container only). The app side is
  `EIGHT_SLEEP_SYNC_URL` (default `http://localhost:8081/sync`); the two must agree.
  A press is skipped while a pull runs or within 60 s of the last one.
- The login token is reused until shortly before it expires; a restart logs in
  again. After a refused login (wrong password, locked, rate-limited) it waits
  15 min before trying again, doubling up to 6 h.
- Put the Eight Sleep login in ONE instance's `.env`, not two at once: both
  sidecars would pull on the same 15-minute grid, and a refused or rate-limited
  login pauses pulls (anything else using the same account shares that limit).
- A failed pull (Eight Sleep 5xx) is not retried inside its slot; the next slot
  15 minutes later picks the night up.
- Eight Sleep has no public API. The endpoints and app client id/secret are the
  ones the open-source pyEight library (Home Assistant's Eight Sleep
  integration) uses; override with `EIGHT_SLEEP_CLIENT_ID` /
  `EIGHT_SLEEP_CLIENT_SECRET` if Eight Sleep rotates them.

## Environment

| Var | Default | Purpose |
|-----|---------|---------|
| `EIGHT_SLEEP_EMAIL` | – | Eight Sleep account email. Sidecar stays off unless set. |
| `EIGHT_SLEEP_PASSWORD` | – | Eight Sleep account password. |
| `EIGHT_SLEEP_IMPORT_URL` | `http://app:3000/api/wellness/eight-sleep` | App import endpoint |
| `WELLNESS_IMPORT_TOKEN` | – | Same bearer token the Garmin sidecar uses |
| `EIGHT_SLEEP_BACKFILL_DAYS` | `3` | Days back (incl. today) per run |
| `EIGHT_SLEEP_WINDOW_START` / `_END` | `05:00` / `10:00` | Daily pull window (end not included) |
| `EIGHT_SLEEP_EVERY_MINUTES` | `15` | Pull spacing inside the window |
| `EIGHT_SLEEP_SYNC_HOST` / `_PORT` | `127.0.0.1` / `8081` | On-demand `POST /sync` listener |
| `EIGHT_SLEEP_MANUAL_COOLDOWN_SECONDS` | `60` | Minimum gap between on-demand pulls |
| `EIGHT_SLEEP_SYNC_URL` (app) | `http://localhost:8081/sync` | Where "Sync now" sends the pull request |
| `EIGHT_SLEEP_TZ` | `$TZ` → `UTC` | Zone for the date window |
| `EIGHT_SLEEP_USER_AGENT` | `okhttp/4.9.3` | User-agent sent to Eight Sleep |

## First real pull — in this order

A restart starts the sidecar and it imports at once, and a mis-dated row stays
until overwritten. So check the date convention BEFORE the first import:

```bash
cd deploy/bundled
# 1. put EIGHT_SLEEP_EMAIL / EIGHT_SLEEP_PASSWORD in .env (never in the compose file)
# 2. one-off container with the new env — prints dates + keys only, no health values, no import
docker compose run --rm --no-deps --entrypoint python3 app /eight-sleep-sync/sync.py --shape
# 3. check: each presenceEnd (UTC) is the morning you got up; that local date is the night's wake-up day
# 4. only then start the sidecar
docker compose up -d
```

## One-off commands (inside the running container)

```bash
# Pull history once (e.g. 90 nights) and import it
docker exec peptide-pitstop python3 /eight-sleep-sync/sync.py --backfill 90
```

If login or `/trends` returns 4xx, try `EIGHT_SLEEP_USER_AGENT` (default
`okhttp/4.9.3`, the value pyEight sends) before anything else.

Tests: `python -m unittest` in this directory (stdlib only).
