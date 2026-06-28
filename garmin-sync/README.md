# garmin-sync

Thin Garmin Connect → Peptide Tracker wellness sidecar. It logs into Garmin,
assembles one raw JSON object per day from several Connect endpoints, and POSTs
them to the app's import API. **All normalisation lives on the app side**
(`src/lib/wearable-normalise.ts`) — this sidecar does almost no shaping so the
two can never drift.

## Data flow

```
Garmin Connect ──garminconnect.connectapi──▶ sync.py (assemble raw day)
                                       │  POST { days: [rawDay, ...] }
                                       ▼  Authorization: Bearer $WELLNESS_IMPORT_TOKEN
                          app  POST /api/wellness/garmin
                                       │  normaliseGarminDay() + upsert
                                       ▼
                          WearableDaily  (one row per user/day/source)
```

- **Daily loop:** on start, then every `SYNC_INTERVAL_SECONDS` (default 24h), it
  pulls the last `BACKFILL_DAYS` (default 3, incl. today) to catch late watch
  syncs and re-POSTs them. The app upsert is idempotent on `(userId, date,
  source)`, so re-pulls are safe.
- **On-demand:** `POST /sync` on port `8080` (compose-internal only) triggers an
  immediate pull. The app's "Sync now" button hits
  `/api/wellness/sync-now`, which forwards here.

## Environment variables

| Var | Default | Purpose |
|-----|---------|---------|
| `GARMIN_EMAIL` | – | Garmin account email (login / token refresh only) |
| `GARMIN_PASSWORD` | – | Garmin account password (login / token refresh only) |
| `APP_IMPORT_URL` | `http://app:3000/api/wellness/garmin` | App import endpoint |
| `WELLNESS_IMPORT_TOKEN` | – | Bearer token; **must match** the app's `WELLNESS_IMPORT_TOKEN` |
| `BACKFILL_DAYS` | `3` | Days back (incl. today) to pull each run |
| `TOKENS_DIR` | `/tokens` | Persisted OAuth token dir (mount a volume here) |
| `SYNC_PORT` | `8080` | On-demand `POST /sync` listener port |
| `SYNC_INTERVAL_SECONDS` | `86400` | Sleep between daily runs |
| `RETRY_DELAY_SECONDS` | `300` | Back-off sleep before exiting non-zero on auth failure |
| `TZ` | – | Set to your timezone (e.g. `America/New_York`) so "today" matches local days |

## One-time MFA bootstrap (seed the token volume)

Garmin accounts with MFA enabled require an interactive code on the **first**
login. The container persists the OAuth tokens to `$TOKENS_DIR`, so this is a
once-off. Run the sidecar interactively to enter the code:

```bash
docker run --rm -it \
  -e GARMIN_EMAIL="you@example.com" \
  -e GARMIN_PASSWORD="••••••••" \
  -v ./garmin-tokens:/tokens \
  peptide-garmin python sync.py --dry-run
```

- `--dry-run` authenticates (prompting for the MFA code on stdin), assembles the
  last `BACKFILL_DAYS`, and prints the `{ "days": [...] }` payload **without
  POSTing** — handy to eyeball the assembled-raw shape and confirm auth works.
- After it prints tokens to `/tokens`, start the service normally
  (`docker compose up -d garmin-sync`); subsequent boots resume the saved session
  silently (no MFA, no password prompt).
- On a **headless** run with no saved token where Garmin still demands MFA, the
  sidecar logs a clear actionable error, sleeps `RETRY_DELAY_SECONDS`, and exits
  non-zero (compose `restart: unless-stopped` retries with back-off) — it never
  tight-loops.

## Tests

```bash
python -m unittest        # pure shaping helpers; stdlib only, no Garmin deps
```

## Auth library — migrated off garth (2026-06-21)

Originally used `garth`, but **garth's mobile-app auth path is dead**: new logins
403 at the OAuth1 `oauth-service/oauth/preauthorized` exchange because Garmin's
Cloudflare blocks plain-`requests` TLS fingerprints (garth is also deprecated
upstream at 0.8.0 — "new logins won't work"). Now on **`python-garminconnect`**
(`garminconnect==0.3.6`), whose 0.3.x line dropped garth for **`curl_cffi`**
(real-browser TLS impersonation) + `ua-generator` — this authenticates new
logins. The raw `.connectapi(path)` call has the same signature, so the porting
was just the auth entry points (`Garmin(...).login(TOKENS_DIR)` resumes-or-logs-
in-and-persists in one call) plus routing the 6 fetches through the client.

> ⚠️ **Pin ≥0.3.x.** `garminconnect==0.2.x` still bundles garth (dead auth).

If auth or any endpoint stops working:

1. Re-run the `--dry-run` bootstrap to see the exact failure.
2. Bump `garminconnect` to the latest 0.3.x (curl_cffi line) and rebuild.
3. The Connect endpoint paths used (see `sync.py`) are the de-facto community
   ones; Garmin can change response shapes — if a metric goes missing, compare a
   `--dry-run` dump against the keys `wearable-normalise.ts` expects.
4. Last resort: the official Garmin Health API (partner OAuth).
