# Dose reminder notifications — Web Push (PWA) + Home Assistant fallback

Dose reminders reach your phone two possible ways, decided per event:

1. **Web Push (primary)** — notifications from the installed Peptide Pitstop
   PWA itself (iOS 16.4+, Android, desktop). Tapping opens the app directly,
   not a browser tab. Enrol each device in **Settings → Notifications** (on
   iOS the app must be launched from its Home-Screen icon).
2. **Home Assistant webhook (optional fallback)** — when a user has no usable
   Web Push subscription, the event can relay through HA to your phone via
   the HA Companion app. Skip this entirely if you don't run HA.

## Event model

Every 15 minutes the app plans reminder EVENTS from the same engine that
drives the Today page — so start/end dates, schedule overrides and rebases
all apply:

- **Slot reminder** — one per (protocol, slot) per day, fired when the slot
  time is within ±30 min. Multi-time schedules get one reminder per slot (a
  later slot's push replaces the stale earlier one via the collapse tag).
  Untimed daily doses remind at your configured time (default 08:00).
- **Catch-up nag** — one per day at your configured time (default 18:00): a
  single summary of every dose whose reminder moment has passed but is still
  unlogged. Future slots are excluded — they get their own reminder later.

Anchors and the nag on/off switch live in **Settings → Notifications →
Reminder times**. Doses logged during the day never remind or nag.

**Exactly-once:** each event is claimed in the `ReminderSend` table (unique
`(userId, dayKey, key)` — the insert IS the claim), so concurrent ticks can
never double-send. A claimed-but-failed send is not retried by design.

**Safety:** notifications never carry a dose amount.

## Web Push setup

1. Generate a VAPID keypair: `npx web-push generate-vapid-keys`
2. Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
   (`mailto:you@example.com`) in your `.env` and restart the container.
3. On each device: install the PWA (iOS: Share → Add to Home Screen), open it
   from the icon, then Settings → Notifications → **Enable on this device** →
   **Send test**.

Notes:
- Subscriptions are per-origin — a different hostname is a different install.
- Expired subscriptions (push service returns 404/410) are pruned
  automatically and delivery falls back to the HA relay if configured.
- iOS may silently drop a subscription if the PWA is unused for a long
  stretch — re-enable from Settings if tests stop arriving.
- **Never reuse one VAPID keypair across environments** that share a copied
  database: push services authorise by key, not origin, so a staging box with
  your prod key + prod DB copy will push real notifications to your phone.

## Home Assistant fallback relay (optional)

The app POSTs the full notification to your webhook (generic relay):

```json
{
  "title": "💉 GHK-Cu due",
  "message": "Scheduled for 20:00.",
  "tag": "peptide-<protocolId>",
  "url": "https://peptides.example.com/today"
}
```

Set in `.env` (`url` is included when `PUBLIC_APP_URL` is set):

```bash
HA_WEBHOOK_URL="http://your-home-assistant:8123/api/webhook/peptide_dose_reminder"
PUBLIC_APP_URL="https://peptides.example.com"
```

HA package (e.g. `/config/packages/peptide.yaml` — adjust the notify target):

```yaml
automation:
  - id: peptide_dose_reminder_push
    alias: "Peptide Pitstop — dose reminder push"
    mode: parallel
    triggers:
      - trigger: webhook
        webhook_id: peptide_dose_reminder
        allowed_methods: [POST]
        local_only: true
    actions:
      - action: notify.mobile_app_your_phone
        data:
          title: "{{ trigger.json.title | default('💉 Peptide dose due') }}"
          message: "{{ trigger.json.message | default('Open the tracker to log it.') }}"
          data:
            tag: "{{ trigger.json.tag | default('peptide') }}"
            group: "peptide-reminders"
            url: "{{ trigger.json.url | default('https://peptides.example.com/today') }}"
            actions:
              - action: URI
                title: "Open tracker"
                uri: "{{ trigger.json.url | default('https://peptides.example.com/today') }}"
```

## Known limits

- A claimed-but-failed send is not retried (never-double-send by design).
- Web Push requires HTTPS (any valid cert — a Cloudflare Tunnel works).
