# Home Assistant — Peptide dose reminder automation

The Peptide Tracker pushes a reminder to Home Assistant when a scheduled dose is
due soon. HA receives it on a **webhook trigger** and relays it to your phone
via `notify.mobile_app_mphone16`.

## How it works

- A 15-minute tick in the app (`src/instrumentation.ts` → `runReminders`) finds
  `PlannedDose` rows that are `status:"planned"`, not yet reminded, on an **active**
  protocol, and scheduled within `[now - 30 min, now + 30 min]`.
- For each, it `POST`s a small JSON body to `HA_WEBHOOK_URL` and stamps
  `reminderSentAt` so the dose is **never reminded twice** (atomic claim).
- If `HA_WEBHOOK_URL` is unset the feature is dormant (logged once, no crash).

## Payload shape

The app sends **only** these fields (no dose amount — a raw stored dose could be a
multi-x overdose for `per_week` protocols, so it is deliberately omitted):

```json
{
  "peptide": "Retatrutide",
  "time": "06:00",
  "protocolId": "clz1abc..."
}
```

| field        | meaning                                  |
| ------------ | ---------------------------------------- |
| `peptide`    | Peptide display name                     |
| `time`       | Scheduled local time, `HH:MM` (Brisbane) |
| `protocolId` | Protocol the dose belongs to             |

## 1. Configure the app

Set `HA_WEBHOOK_URL` in the app's compose `.env` to the HA webhook URL. Pick a
stable webhook id (used below as `peptide_dose_reminder`):

```bash
# docker-compose .env
HA_WEBHOOK_URL="http://192.168.1.10:8123/api/webhook/peptide_dose_reminder"
```

(If the app reaches HA over the tunnel/LAN instead, use the matching base URL —
only the `/api/webhook/<id>` suffix must match the automation's `webhook_id`.)

## 2. Home Assistant automation

Drop this into a package (e.g. `/config/packages/notifications.yaml`) and reload
automations. The `webhook_id` must equal the id in `HA_WEBHOOK_URL`.

```yaml
automation:
  - alias: "Peptide Tracker — dose reminder"
    description: >-
      Relays a due-dose reminder pushed by Peptide Tracker to your phone.
      Payload: { peptide, time, protocolId }.
    mode: parallel
    triggers:
      - trigger: webhook
        webhook_id: peptide_dose_reminder
        allowed_methods:
          - POST
        local_only: true
    actions:
      - action: notify.mobile_app_mphone16
        data:
          title: "Peptide due"
          message: "{{ trigger.json.peptide }} scheduled for {{ trigger.json.time }}"
          data:
            tag: "peptide-{{ trigger.json.protocolId }}"
            url: "/peptide-tracker"
```

Notes:

- `local_only: true` — the app POSTs from inside the LAN/compose network; drop it
  only if the app calls HA over the public tunnel.
- `mode: parallel` — tolerates several reminders arriving in the same tick.
- `tag` keys the phone notification per protocol so a later reminder for the same
  protocol replaces (rather than stacks) the prior one.
- Add `data.actions:` (notification action buttons) later if you want a
  "Log dose" deep-link straight from the push.
