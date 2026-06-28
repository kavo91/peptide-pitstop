# Apple Health bridge — iOS Shortcut recipe

## Why a Shortcut (and not a built-in integration)

Apple Health / HealthKit is **device-only**: there is no server API, and you can
only write to it from a **native iOS app** running on the iPhone. A self-hosted
web app (this one) fundamentally cannot push to Apple Health.

The realistic path with **no native app** is an iOS **Shortcut** on your phone
that pulls your recent metrics from the app and writes them into Health using the
built-in **"Log Health Sample"** action. This repo ships the read endpoint; you
build the (small) Shortcut once.

Only the metrics that Shortcuts can write are exposed: **body mass, dietary
energy (calories), protein, water**. (Apple Health "Medications" is not reliably
Shortcut-writable, so doses are not bridged this way — use the in-app log/PDF for
those.)

## The endpoint

```
GET https://peptides.example.com/api/health-export?since=YYYY-MM-DD
Authorization: Bearer <WELLNESS_IMPORT_TOKEN>
```

`since` is optional (defaults to the last 30 days). Response:

```json
{
  "generatedAt": "2026-06-23T08:00:00.000Z",
  "since": "2026-05-24",
  "entries": [
    { "date": "2026-06-23", "weightKg": 82.1, "calories": 2100, "proteinG": 160, "waterMl": 2500 }
  ]
}
```

Null metrics are omitted per entry. `weightKg` is always kilograms (lb is
converted server-side). The bearer token is the same `WELLNESS_IMPORT_TOKEN`
already set in the deployment `.env`.

## Build the Shortcut (one-time, ~5 min)

1. **Shortcuts app → +** (new shortcut). Name it e.g. "Sync to Apple Health".
2. **Text** action → paste your `WELLNESS_IMPORT_TOKEN`. (Or use a Shortcuts
   "Ask for Input" / store it in a note — keep it private.)
3. **Get Contents of URL**:
   - URL: `https://peptides.example.com/api/health-export?since=` + (optional) a date. For a daily sync, `since` = today is fine.
   - Method: **GET**
   - Headers: add `Authorization` = `Bearer ` followed by the Text token from step 2.
4. **Get Dictionary from Input** (parses the JSON).
5. **Get Dictionary Value** → `entries` (this is the array).
6. **Repeat with Each** (over `entries`). Inside the loop, for each metric you want:
   - **Get Dictionary Value** `weightKg` from the Repeat Item →
     **Log Health Sample** → type **Body Mass**, value = that number, unit kg,
     date = the entry's `date`.
   - Repeat for `calories` → **Dietary Energy** (kcal), `proteinG` → **Protein** (g),
     `waterMl` → **Water** (mL).
   - Wrap each in an **If (value has any value)** so missing metrics are skipped.
7. Save. Run it manually once to grant the Health-write permission prompts.

## Automate it (optional)

Shortcuts app → **Automation → +** → **Time of Day** (e.g. 9pm daily) → run
"Sync to Apple Health". With "Run Immediately" + notifications off it syncs
silently each evening.

## Notes / limitations

- This is a **one-way export** (app → Health). It does not read from Health.
- Logging the same day twice creates duplicate Health samples — prefer
  `since=today` on a daily automation, or de-dup in the Shortcut if you backfill.
- Doses/injections are not exported (no Shortcut-writable Health type for them).
- If the endpoint returns 401, the token is wrong; 503 means
  `WELLNESS_IMPORT_TOKEN` isn't set on the server.

## Why not more

Full, native Apple Health write (HealthKit, two-way, Medications, Apple Watch
complications) requires shipping a **native iOS app** — out of scope for this
self-hosted web PWA. Logged in the design ledger as excluded with this reason.
