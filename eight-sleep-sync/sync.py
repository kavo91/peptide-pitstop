#!/usr/bin/env python3
"""eight-sleep-sync — thin fetch-and-forward sidecar for Peptide Tracker.

Eight Sleep is an EXTRA wellness source beside Garmin. This sidecar logs into
the Eight Sleep cloud with the account's email + password, reads the nightly
trend days for the last $EIGHT_SLEEP_BACKFILL_DAYS days, and POSTs them
unchanged as ``{"days": [...]}`` to the app's /api/wellness/eight-sleep route.
ALL shaping lives on the app side (src/lib/eight-sleep-normalise.ts), so the two
never drift. The app files the rows under source "eight_sleep" and never writes
them into Garmin's rows.

Eight Sleep has no public API. The endpoints and the app client id/secret below
are the ones the open-source pyEight library (lukas-clarke/pyEight, used by the
Home Assistant Eight Sleep integration) uses; both can be overridden by env if
Eight Sleep rotates them.

Behaviour:
  * Log in (password grant) → bearer token + Eight Sleep user id.
  * GET /v1/users/{id}/trends for [today − backfill + 1, today] in $EIGHT_SLEEP_TZ.
  * POST the trend days to the app. Re-pulls are safe (idempotent upsert).
  * Run once on start, then every $EIGHT_SLEEP_EVERY_MINUTES (default 15) on the
    quarter hour, only inside $EIGHT_SLEEP_WINDOW_START–$EIGHT_SLEEP_WINDOW_END
    (default 05:00–10:00) in $EIGHT_SLEEP_TZ — the hours a night gets scored.
    Outside the window it sleeps until the next window opens.
  * Serve POST /sync on $EIGHT_SLEEP_SYNC_HOST:$EIGHT_SLEEP_SYNC_PORT (default
    127.0.0.1:8081, no auth) for on-demand pulls at any hour (the app's "Sync now"
    button, via /api/wellness/sync-now). Skipped while a pull runs or within
    $EIGHT_SLEEP_MANUAL_COOLDOWN_SECONDS (60) of the last on-demand pull.
  * Reuse the bearer token until shortly before it expires (no login per pull; a
    restart logs in again). After a refused login (400/401/403/429) it waits
    15 min, doubling up to 6 h, before the next login attempt.

Flags:
  --dry-run       print the full payload, do not POST (your own health data —
                  run it in your own terminal only)
  --shape         print per-day keys + day/presenceEnd/processing only (no
                  values) — safe to paste when checking the date convention
  --backfill N    one-off pull of the last N days, then exit
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
from typing import Any
from zoneinfo import ZoneInfo

import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [eight-sleep-sync] %(levelname)s %(message)s",
)
log = logging.getLogger("eight-sleep-sync")

# ── Config (env) ────────────────────────────────────────────────────────────
AUTH_URL = os.environ.get("EIGHT_SLEEP_AUTH_URL", "https://auth-api.8slp.net/v1/tokens")
CLIENT_API_URL = os.environ.get("EIGHT_SLEEP_CLIENT_API_URL", "https://client-api.8slp.net/v1")
# Public app credentials published in pyEight (constants.py), not an account secret.
CLIENT_ID = os.environ.get("EIGHT_SLEEP_CLIENT_ID", "0894c7f33bb94800a03f1f4df13a4f38")
CLIENT_SECRET = os.environ.get(
    "EIGHT_SLEEP_CLIENT_SECRET",
    "f0954a3ed5763ba3d06834c73731a32f15f168f47d4f164751275def86db0c76",
)
EMAIL = os.environ.get("EIGHT_SLEEP_EMAIL", "")
PASSWORD = os.environ.get("EIGHT_SLEEP_PASSWORD", "")
IMPORT_URL = os.environ.get("EIGHT_SLEEP_IMPORT_URL", "http://app:3000/api/wellness/eight-sleep")
WELLNESS_IMPORT_TOKEN = os.environ.get("WELLNESS_IMPORT_TOKEN", "")
BACKFILL_DAYS = int(os.environ.get("EIGHT_SLEEP_BACKFILL_DAYS", "3"))
WINDOW_START = os.environ.get("EIGHT_SLEEP_WINDOW_START", "05:00")
WINDOW_END = os.environ.get("EIGHT_SLEEP_WINDOW_END", "10:00")
EVERY_MINUTES = int(os.environ.get("EIGHT_SLEEP_EVERY_MINUTES", "15"))
SYNC_PORT = int(os.environ.get("EIGHT_SLEEP_SYNC_PORT", "8081"))
# The app calls /sync over localhost in the bundled container; nothing else needs it.
SYNC_HOST = os.environ.get("EIGHT_SLEEP_SYNC_HOST", "127.0.0.1")
# Minimum gap between two on-demand pulls (repeated "Sync now" taps).
MANUAL_COOLDOWN_SECONDS = int(os.environ.get("EIGHT_SLEEP_MANUAL_COOLDOWN_SECONDS", "60"))
RETRY_DELAY_SECONDS = int(os.environ.get("RETRY_DELAY_SECONDS", "300"))
TZ_NAME = os.environ.get("EIGHT_SLEEP_TZ") or os.environ.get("TZ") or "UTC"
TIMEOUT = 30

# pyEight sends the Android app's user-agent to the client API; matching it is the
# least surprising choice. Override with EIGHT_SLEEP_USER_AGENT if a call 4xx's.
HEADERS = {
    "content-type": "application/json",
    "accept": "application/json",
    "user-agent": os.environ.get("EIGHT_SLEEP_USER_AGENT", "okhttp/4.9.3"),
}


# ── Pure helpers (unit-tested in test_sync.py; no network) ───────────────────
def date_window(n: int, today: dt.date) -> tuple[str, str]:
    """(from, to) ISO dates covering the last n days incl. today. n < 1 → today only."""
    n = max(1, n)
    return (today - dt.timedelta(days=n - 1)).isoformat(), today.isoformat()


def trend_days(payload: Any) -> list[dict[str, Any]]:
    """The `days` list of a trends response; anything else → []."""
    days = payload.get("days") if isinstance(payload, dict) else None
    return [d for d in days if isinstance(d, dict)] if isinstance(days, list) else []


def shape_of(days: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Value-free view of the trend days: which keys exist, plus the three fields
    that decide the date (no health numbers), for checking the day convention."""
    return [
        {
            "day": d.get("day"),
            "presenceStart": d.get("presenceStart"),
            "presenceEnd": d.get("presenceEnd"),
            "processing": d.get("processing"),
            "keys": sorted(d.keys()),
            "sleepQualityScoreKeys": sorted((d.get("sleepQualityScore") or {}).keys())
            if isinstance(d.get("sleepQualityScore"), dict)
            else None,
        }
        for d in days
    ]


def parse_backfill(argv: list[str]) -> int | None:
    """N from `--backfill N`, else None. A missing/bad N is an error."""
    if "--backfill" not in argv:
        return None
    i = argv.index("--backfill")
    try:
        n = int(argv[i + 1])
    except (IndexError, ValueError):
        raise SystemExit("--backfill needs a whole number of days, e.g. --backfill 90")
    if n < 1:
        raise SystemExit("--backfill must be at least 1")
    return n


def parse_hhmm(s: str) -> dt.time:
    h, m = s.strip().split(":")
    return dt.time(int(h), int(m))


def in_window(t: dt.datetime, start: dt.time, end: dt.time) -> bool:
    """True when local time-of-day t is in [start, end). The end is exclusive: 10:00 is out."""
    return start <= t.time() < end


def next_run_after(t: dt.datetime, start: dt.time, end: dt.time, every_min: int) -> dt.datetime:
    """The first scheduled pull strictly after t (tz-aware, same zone as t).

    Pulls sit on the `every_min` grid counted from midnight (05:00, 05:15 … 09:45).
    A grid slot outside [start, end) is skipped: the next pull is then the window's
    opening later the same day, or the next day.
    """
    midnight = t.replace(hour=0, minute=0, second=0, microsecond=0)
    minutes = (t - midnight).total_seconds() / 60
    slot = midnight + dt.timedelta(minutes=(int(minutes // every_min) + 1) * every_min)
    if slot.date() == t.date() and in_window(slot, start, end):
        return slot
    opening = midnight.replace(hour=start.hour, minute=start.minute)
    return opening if opening > t else opening + dt.timedelta(days=1)


def _load_zone() -> dt.tzinfo:
    try:
        return ZoneInfo(TZ_NAME)
    except Exception:  # noqa: BLE001 — no tzdata: fall back to the process zone
        log.warning("could not load zone %s — using the process local zone", TZ_NAME)
        return dt.datetime.now().astimezone().tzinfo  # type: ignore[return-value]


ZONE = _load_zone()  # resolved once, so a missing tzdata warns once, not every minute


def local_now() -> dt.datetime:
    return dt.datetime.now(ZONE)


def check_schedule(start: dt.time, end: dt.time, every_min: int) -> None:
    """Refuse a schedule that would crash or never pull (checked before the first pull)."""
    if every_min < 1:
        raise ValueError(f"EIGHT_SLEEP_EVERY_MINUTES must be at least 1 (got {every_min})")
    if not start < end:
        raise ValueError(f"EIGHT_SLEEP_WINDOW_START must be before _END (got {start}-{end})")


def local_today() -> dt.date:
    return local_now().date()


# ── Eight Sleep cloud ───────────────────────────────────────────────────────
class LoginRefused(RuntimeError):
    """Eight Sleep refused the login (wrong password, locked account, rate limit)."""

    def __init__(self, status: int):
        super().__init__(f"Eight Sleep login failed: HTTP {status}")
        self.status = status


_token: tuple[str, str, float] | None = None  # (bearer, user id, expires at, epoch s)
_token_lock = threading.Lock()
# After a refused login, no new login attempt until this time; the wait doubles
# each refusal (15 min → 6 h cap) so a wrong password can't hammer the account.
_login_blocked_until = 0.0
_login_backoff = 0.0
LOGIN_BACKOFF_FIRST = 15 * 60
LOGIN_BACKOFF_MAX = 6 * 60 * 60


def get_token() -> tuple[str, str]:
    """Cached login: reuse the bearer until 2 minutes before it expires."""
    global _token, _login_blocked_until, _login_backoff
    with _token_lock:
        if _token and _token[2] - 120 > time.time():
            return _token[0], _token[1]
        if time.time() < _login_blocked_until:
            raise RuntimeError(
                f"login paused after a refused login; next try in {int(_login_blocked_until - time.time())}s"
            )
        try:
            token, user_id, expires_in = authenticate()
        except LoginRefused:
            _login_backoff = min(LOGIN_BACKOFF_MAX, _login_backoff * 2 or LOGIN_BACKOFF_FIRST)
            _login_blocked_until = time.time() + _login_backoff
            raise
        _login_backoff = 0.0
        _token = (token, user_id, time.time() + expires_in)
        return token, user_id


def forget_token() -> None:
    global _token
    with _token_lock:
        _token = None


def authenticate() -> tuple[str, str, float]:
    """Password grant → (bearer token, Eight Sleep user id, seconds until expiry)."""
    if not EMAIL or not PASSWORD:
        raise RuntimeError("EIGHT_SLEEP_EMAIL / EIGHT_SLEEP_PASSWORD not set")
    resp = requests.post(
        AUTH_URL,
        headers=HEADERS,
        json={
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "grant_type": "password",
            "username": EMAIL,
            "password": PASSWORD,
        },
        timeout=TIMEOUT,
    )
    if resp.status_code != 200:
        # Status only — the body can echo the request.
        if resp.status_code in (400, 401, 403, 429):
            raise LoginRefused(resp.status_code)
        raise RuntimeError(f"Eight Sleep login failed: HTTP {resp.status_code}")
    body = resp.json()
    return body["access_token"], body["userId"], float(body.get("expires_in") or 3600)


def fetch_trends(token: str, user_id: str, start: str, end: str) -> list[dict[str, Any]]:
    resp = requests.get(
        f"{CLIENT_API_URL}/users/{user_id}/trends",
        headers={**HEADERS, "authorization": f"Bearer {token}"},
        params={
            "tz": TZ_NAME,
            "from": start,
            "to": end,
            "include-main": "false",
            "include-all-sessions": "true",
            "model-version": "v2",
        },
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    return trend_days(resp.json())


def collect_days(n: int) -> list[dict[str, Any]]:
    token, user_id = get_token()
    start, end = date_window(n, local_today())
    try:
        days = fetch_trends(token, user_id, start, end)
    except requests.HTTPError as e:
        if e.response is None or e.response.status_code != 401:
            raise
        forget_token()  # token revoked early — log in again once
        token, user_id = get_token()
        days = fetch_trends(token, user_id, start, end)
    log.info("fetched %d trend day(s) for %s → %s", len(days), start, end)
    return days


# ── Forward to the app ──────────────────────────────────────────────────────
def post_days(days: list[dict[str, Any]]) -> None:
    if not WELLNESS_IMPORT_TOKEN:
        raise RuntimeError("WELLNESS_IMPORT_TOKEN not set — refusing to POST")
    resp = requests.post(
        IMPORT_URL,
        json={"days": days},
        headers={"Authorization": f"Bearer {WELLNESS_IMPORT_TOKEN}"},
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    log.info("POST %s -> %s %s", IMPORT_URL, resp.status_code, resp.text.strip()[:200])


# ── One pull, serialised (schedule + on-demand never overlap) ─────────────────
_sync_lock = threading.Lock()


def do_sync(reason: str, lock_held: bool = False) -> None:
    """One pull. `lock_held`: the caller already took _sync_lock for this pull."""
    if not lock_held and not _sync_lock.acquire(blocking=False):
        log.info("a pull is already running; skipping (%s)", reason)
        return
    try:
        log.info("pull (%s)", reason)
        post_days(collect_days(BACKFILL_DAYS))
    except Exception as e:  # noqa: BLE001 — a failed pull must not kill the loop
        log.error("pull failed (%s): %s", reason, describe_error(e))
    finally:
        _sync_lock.release()


def describe_error(e: Exception) -> str:
    """Error text for the log without the request URL (it carries the account's user id)."""
    response = getattr(e, "response", None)
    status = getattr(response, "status_code", None)
    if status is not None:
        return f"{type(e).__name__}: HTTP {status}"
    return str(e)


_last_manual = 0.0
_manual_lock = threading.Lock()


def request_manual_sync() -> str:
    """Start an on-demand pull unless one is running or the last one was too recent.

    Returns "started", "running" (a pull is under way — its data will land),
    "cooldown" (one ran moments ago) or "paused" (logins paused after a refusal).
    Never starts a thread it won't use.
    """
    global _last_manual
    with _manual_lock:
        if time.time() < _login_blocked_until and not (_token and _token[2] - 120 > time.time()):
            return "paused"
        now = time.monotonic()
        if _last_manual and now - _last_manual < MANUAL_COOLDOWN_SECONDS:
            return "cooldown"
        # Take the pull lock here, so a scheduled pull can't slip in between the
        # check and the thread start; the thread releases it when the pull ends.
        if not _sync_lock.acquire(blocking=False):
            return "running"
        _last_manual = now
    threading.Thread(target=do_sync, args=("sync now", True), daemon=True).start()
    return "started"


# ── On-demand HTTP trigger ("Sync now") ──────────────────────────────────────
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
            status = request_manual_sync()
            # 202 = data is on its way (new or running pull); 200 = nothing new will land.
            self._send(202 if status in ("started", "running") else 200, json.dumps({"ok": True, "status": status}))
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
    server = ThreadingHTTPServer((SYNC_HOST, SYNC_PORT), _Handler)
    log.info("on-demand sync endpoint listening on %s:%d (POST /sync, no auth)", SYNC_HOST, SYNC_PORT)
    server.serve_forever()


# ── Main loop ───────────────────────────────────────────────────────────────
def main() -> int:
    try:
        start, end = parse_hhmm(WINDOW_START), parse_hhmm(WINDOW_END)
        check_schedule(start, end, EVERY_MINUTES)
    except ValueError as e:
        log.error("bad schedule config: %s — sleeping %ds before exit", e, RETRY_DELAY_SECONDS)
        time.sleep(RETRY_DELAY_SECONDS)  # no restart loop every 30 s
        return 1
    log.info(
        "starting — import_url=%s backfill_days=%d every=%dmin window=%s-%s tz=%s",
        IMPORT_URL, BACKFILL_DAYS, EVERY_MINUTES, WINDOW_START, WINDOW_END, TZ_NAME,
    )
    if not EMAIL or not PASSWORD:
        log.error("EIGHT_SLEEP_EMAIL / EIGHT_SLEEP_PASSWORD not set — sleeping %ds before exit", RETRY_DELAY_SECONDS)
        time.sleep(RETRY_DELAY_SECONDS)
        return 1
    threading.Thread(target=serve_http, daemon=True).start()
    do_sync("start")
    while True:
        due = next_run_after(local_now(), start, end, EVERY_MINUTES)
        log.info("next scheduled pull at %s", due.isoformat(timespec="minutes"))
        # Sleep in short steps so a host suspend or clock jump can't skip the window.
        while (wait := (due - local_now()).total_seconds()) > 0:
            time.sleep(min(wait, 60))
        # Woke late (host suspend, clock jump) past the window: skip, plan the next slot.
        if in_window(local_now(), start, end):
            do_sync("scheduled")
        else:
            log.info("missed the %s slot (now outside the window); skipping", due.isoformat(timespec="minutes"))


if __name__ == "__main__":
    argv = sys.argv[1:]
    backfill = parse_backfill(argv)
    n = backfill or BACKFILL_DAYS
    if "--shape" in argv:
        print(json.dumps(shape_of(collect_days(n)), indent=2))
        raise SystemExit(0)
    if "--dry-run" in argv:
        print(json.dumps({"days": collect_days(n)}, indent=2, default=str))
        raise SystemExit(0)
    if backfill is not None:
        post_days(collect_days(backfill))
        raise SystemExit(0)
    raise SystemExit(main())
