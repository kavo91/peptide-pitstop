#!/usr/bin/env python3
"""garmin-sync — thin fetch-and-forward sidecar for Peptide Tracker.

It logs into Garmin Connect (python-garminconnect), assembles ONE raw JSON object per day from
several Connect endpoints, and POSTs ``{"days": [...]}`` to the app. ALL
normalisation happens on the app side (src/lib/wearable-normalise.ts) — this
sidecar deliberately does almost no shaping, so the two never drift.

Behaviour:
  * Resume a saved session from $TOKENS_DIR; else log in with env creds (MFA via
    an interactive prompt on first run — see README).
  * Pull the last $BACKFILL_DAYS days (incl. today) and POST them.
  * Run once on start, then loop every $SYNC_INTERVAL_SECONDS.
  * Serve POST /sync on $SYNC_PORT for on-demand pulls (the app's "Sync now").

Assembled-raw contract (must match the TS normaliser's expected keys):
    {
      "date":    "YYYY-MM-DD",
      "sleep":   <dailySleepData response, has .dailySleepDTO>,
      "summary": <usersummary daily response>,
      "hrv":     <hrv response, has .hrvSummary>,
      "weight":  <weight dateRange response, has .totalAverage (grams)>,
      "vo2max":  <first maxmet entry, has .generic.vo2MaxValue>,
      "activities": <list of logged-activity entries that START on this local
                     date — deliberate workouts (.activityType.typeKey, .duration,
                     .distance, .activityName, .startTimeLocal). Omitted when none.>
    }
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable

import requests
from garminconnect import Garmin

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [garmin-sync] %(levelname)s %(message)s",
)
log = logging.getLogger("garmin-sync")

# ── Config (env) ────────────────────────────────────────────────────────────
TOKENS_DIR = os.environ.get("TOKENS_DIR", "/tokens")
APP_IMPORT_URL = os.environ.get("APP_IMPORT_URL", "http://app:3000/api/wellness/garmin")
WELLNESS_IMPORT_TOKEN = os.environ.get("WELLNESS_IMPORT_TOKEN", "")
GARMIN_EMAIL = os.environ.get("GARMIN_EMAIL", "")
GARMIN_PASSWORD = os.environ.get("GARMIN_PASSWORD", "")
BACKFILL_DAYS = int(os.environ.get("BACKFILL_DAYS", "3"))
SYNC_PORT = int(os.environ.get("SYNC_PORT", "8080"))
SYNC_INTERVAL_SECONDS = int(os.environ.get("SYNC_INTERVAL_SECONDS", str(24 * 60 * 60)))
RETRY_DELAY_SECONDS = int(os.environ.get("RETRY_DELAY_SECONDS", "300"))

# Serialise pulls so the daily loop and an on-demand /sync never overlap.
_sync_lock = threading.Lock()


# ── Pure shaping (unit-tested in test_normalise.py; no network) ──────────────
def pick_vo2max(maxmet_raw: Any) -> Any:
    """The maxmet endpoint returns a list; the first entry carries .generic.

    Returns the entry the TS normaliser reads (``.generic.vo2MaxValue``), or the
    raw value if it's already an object, or None.
    """
    if isinstance(maxmet_raw, list):
        return maxmet_raw[0] if maxmet_raw else None
    return maxmet_raw or None


def pick_activities(activities_raw: Any, cdate: str) -> list[Any]:
    """Keep only the logged activities that START on ``cdate`` (the local calendar
    day). Garmin's activity-search endpoint returns a window that can straddle
    days; we filter on the local-date prefix of ``startTimeLocal`` (which is "YYYY-
    MM-DD HH:MM:SS" or ISO "YYYY-MM-DDTHH:MM:SS..."). Non-list / None → []."""
    if not isinstance(activities_raw, list):
        return []
    kept: list[Any] = []
    for a in activities_raw:
        start = a.get("startTimeLocal") if isinstance(a, dict) else None
        if not isinstance(start, str) or not start:
            continue
        # The local date is the first 10 chars regardless of " " or "T" separator.
        if start[:10] == cdate:
            kept.append(a)
    return kept


def build_day(
    date: str,
    *,
    sleep: Any = None,
    summary: Any = None,
    hrv: Any = None,
    weight: Any = None,
    vo2max: Any = None,
    activities: Any = None,
) -> dict[str, Any]:
    """Assemble one raw day dict from already-fetched pieces. Only includes keys
    whose fetch produced a value, so a missing metric never injects null noise."""
    day: dict[str, Any] = {"date": date}
    if sleep is not None:
        day["sleep"] = sleep
    if summary is not None:
        day["summary"] = summary
    if hrv is not None:
        day["hrv"] = hrv
    if weight is not None:
        day["weight"] = weight
    picked = pick_vo2max(vo2max)
    if picked is not None:
        day["vo2max"] = picked
    # Logged activities: include only when there is at least one (empty → omit).
    if activities:
        day["activities"] = activities
    return day


# ── Garmin auth ─────────────────────────────────────────────────────────────
# The authenticated client (python-garminconnect). Set by authenticate(); every
# raw Connect call goes through _client.connectapi(path) (drop-in for the old
# garth.connectapi). Module-global because the daily loop, /sync, and dry-run all
# share one session.
_client: Garmin | None = None


def _prompt_mfa() -> str:
    """Garmin MFA callback. Interactive only — fails fast when headless so we
    don't block forever waiting on stdin that will never arrive."""
    if not sys.stdin.isatty():
        raise RuntimeError(
            "Garmin requires an MFA code, but no saved session exists and this is "
            "a headless run. Seed the token volume once interactively — see README "
            "(docker run -it ... to enter the MFA code)."
        )
    return input("Garmin MFA code: ").strip()


def authenticate() -> None:
    """Establish the Garmin session. login(TOKENS_DIR) resumes a saved session if
    one exists there, otherwise does a full credential login (+ MFA via the
    interactive prompt) and persists the new tokens back to TOKENS_DIR. Raises on
    unrecoverable auth failure (the caller backs off and exits)."""
    global _client
    _client = Garmin(
        GARMIN_EMAIL or None,
        GARMIN_PASSWORD or None,
        prompt_mfa=_prompt_mfa,
    )
    try:
        _client.login(TOKENS_DIR)
    except Exception as e:  # noqa: BLE001
        if not GARMIN_EMAIL or not GARMIN_PASSWORD:
            raise RuntimeError(
                f"no valid saved token at {TOKENS_DIR} and "
                "GARMIN_EMAIL / GARMIN_PASSWORD not set"
            ) from e
        raise

    # Belt-and-suspenders persistence: login(tokenstore) saves on a fresh login,
    # but the dump method name has shifted across versions — make sure the tokens
    # land in TOKENS_DIR so later restarts resume silently (no MFA). Non-fatal.
    for holder in (getattr(_client, "garth", None), getattr(_client, "client", None)):
        if holder is not None and hasattr(holder, "dump"):
            try:
                holder.dump(TOKENS_DIR)
                break
            except Exception as e:  # noqa: BLE001
                log.warning("token dump via %s failed: %s", type(holder).__name__, e)

    # Touch the API to confirm the session is valid (raises on a bad token).
    name = get_display_name()
    log.info("authenticated Garmin session (user=%s); tokens at %s", name, TOKENS_DIR)


def get_display_name() -> str:
    """The profile displayName the sleep/usersummary endpoints key on. Also
    doubles as a session-validity probe."""
    assert _client is not None, "authenticate() must run before get_display_name()"
    prof = _client.connectapi("/userprofile-service/socialProfile") or {}
    name = prof.get("displayName") or prof.get("userName")
    if not name:
        raise RuntimeError("could not resolve Garmin display name from socialProfile")
    return name


# ── Garmin fetch ────────────────────────────────────────────────────────────
def _try(label: str, fn: Callable[[], Any]) -> Any:
    """Run one fetch defensively — a single missing metric must not drop the day."""
    try:
        return fn()
    except Exception as e:  # noqa: BLE001
        log.warning("fetch failed (%s): %s", label, e)
        return None


def fetch_day(display_name: str, cdate: str) -> dict[str, Any]:
    """Assemble one raw day from the Garmin Connect endpoints (each fetch isolated)."""
    assert _client is not None, "authenticate() must run before fetch_day()"
    sleep = _try(
        "sleep",
        lambda: _client.connectapi(
            f"/wellness-service/wellness/dailySleepData/{display_name}",
            params={"date": cdate, "nonSleepBufferMinutes": 60},
        ),
    )
    summary = _try(
        "summary",
        lambda: _client.connectapi(
            f"/usersummary-service/usersummary/daily/{display_name}",
            params={"calendarDate": cdate},
        ),
    )
    hrv = _try("hrv", lambda: _client.connectapi(f"/hrv-service/hrv/{cdate}"))
    weight = _try(
        "weight",
        lambda: _client.connectapi(
            "/weight-service/weight/dateRange",
            params={"startDate": cdate, "endDate": cdate},
        ),
    )
    vo2max = _try(
        "vo2max",
        lambda: _client.connectapi(f"/metrics-service/metrics/maxmet/daily/{cdate}/{cdate}"),
    )
    # Logged activities (deliberate workouts). The search endpoint returns a window
    # keyed on a date range; we filter client-side on the local start date so an
    # activity that crosses midnight lands on the day it started. Isolated by _try:
    # a failure here returns None and must never drop the rest of the day.
    activities_raw = _try(
        "activities",
        lambda: _client.connectapi(
            "/activitylist-service/activities/search/activities",
            params={"startDate": cdate, "endDate": cdate, "limit": 50, "start": 0},
        ),
    )
    activities = pick_activities(activities_raw, cdate)
    return build_day(
        cdate,
        sleep=sleep,
        summary=summary,
        hrv=hrv,
        weight=weight,
        vo2max=vo2max,
        activities=activities,
    )


def recent_dates(n: int) -> list[str]:
    """The last n calendar days incl. today, newest first (container TZ)."""
    today = dt.date.today()
    return [(today - dt.timedelta(days=i)).isoformat() for i in range(max(1, n))]


def collect_days() -> list[dict[str, Any]]:
    display_name = get_display_name()
    days = [fetch_day(display_name, d) for d in recent_dates(BACKFILL_DAYS)]
    log.info("assembled %d day(s): %s", len(days), ", ".join(d["date"] for d in days))
    return days


# ── Forward to the app ──────────────────────────────────────────────────────
def post_days(days: list[dict[str, Any]]) -> None:
    if not WELLNESS_IMPORT_TOKEN:
        raise RuntimeError("WELLNESS_IMPORT_TOKEN not set — refusing to POST")
    resp = requests.post(
        APP_IMPORT_URL,
        json={"days": days},
        headers={"Authorization": f"Bearer {WELLNESS_IMPORT_TOKEN}"},
        timeout=30,
    )
    resp.raise_for_status()
    log.info("POST %s -> %s %s", APP_IMPORT_URL, resp.status_code, resp.text.strip()[:200])


def do_sync() -> None:
    """One full pull → forward, serialised against concurrent triggers."""
    if not _sync_lock.acquire(blocking=False):
        log.info("a sync is already running; skipping this trigger")
        return
    try:
        days = collect_days()
        post_days(days)
    finally:
        _sync_lock.release()


# ── On-demand HTTP trigger ──────────────────────────────────────────────────
class _Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: str) -> None:
        payload = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self) -> None:  # noqa: N802 — http.server API
        if self.path.rstrip("/") == "/sync":
            log.info("on-demand /sync trigger received")
            threading.Thread(target=do_sync, daemon=True).start()
            self._send(202, '{"ok":true,"status":"started"}')
        else:
            self._send(404, '{"ok":false,"error":"not found"}')

    def do_GET(self) -> None:  # noqa: N802
        if self.path.rstrip("/") in ("/health", ""):
            self._send(200, '{"ok":true}')
        else:
            self._send(404, '{"ok":false,"error":"not found"}')

    def log_message(self, *_args: Any) -> None:  # quieten default access logging
        return


def serve_http() -> None:
    server = ThreadingHTTPServer(("0.0.0.0", SYNC_PORT), _Handler)
    log.info("on-demand sync endpoint listening on :%d (POST /sync)", SYNC_PORT)
    server.serve_forever()


# ── Main loop ───────────────────────────────────────────────────────────────
def main() -> int:
    log.info(
        "starting — import_url=%s backfill_days=%d interval=%ds",
        APP_IMPORT_URL,
        BACKFILL_DAYS,
        SYNC_INTERVAL_SECONDS,
    )

    # TZ sanity: if a named TZ is configured but Python resolved UTC, tzdata is
    # missing and date.today() lags the real zone — the current day's data gets
    # skipped (Brisbane-morning activities go missing). Surface it loudly; the
    # fix is installing tzdata in the image (see deploy/bundled/Dockerfile).
    _tz = (os.environ.get("TZ") or "").strip()
    if _tz and _tz.upper() != "UTC" and time.tzname and time.tzname[0] == "UTC":
        log.warning(
            "TZ=%s but Python resolved UTC (tzname=%s) — tzdata missing; date.today()=%s "
            "will lag the configured zone and skip the current day. Install tzdata.",
            _tz, time.tzname, dt.date.today(),
        )

    try:
        authenticate()
    except Exception as e:  # noqa: BLE001
        log.error("AUTH FAILED: %s", e)
        log.error("sleeping %ds before exit to avoid a tight restart loop", RETRY_DELAY_SECONDS)
        time.sleep(RETRY_DELAY_SECONDS)
        return 1

    threading.Thread(target=serve_http, daemon=True).start()

    while True:
        try:
            do_sync()
        except Exception as e:  # noqa: BLE001 — a failed pull must not kill the loop
            log.error("sync run failed: %s", e)
        log.info("next scheduled sync in %ds", SYNC_INTERVAL_SECONDS)
        time.sleep(SYNC_INTERVAL_SECONDS)


def dry_run() -> int:
    """--dry-run: authenticate, assemble the days, print them as JSON. Does NOT
    POST. Handy for the live MFA bootstrap to eyeball the assembled-raw shape."""
    authenticate()
    days = collect_days()
    print(json.dumps({"days": days}, indent=2, default=str))
    return 0


if __name__ == "__main__":
    if "--dry-run" in sys.argv:
        raise SystemExit(dry_run())
    raise SystemExit(main())
