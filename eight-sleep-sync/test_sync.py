"""Unit tests for the pure helpers in sync.py. `requests` is stubbed so this runs
with the stdlib alone — no network. Run: ``python -m unittest`` from this
directory, locally or in the container.
"""
import datetime as dt
import sys
import types
import unittest

sys.modules.setdefault("requests", types.ModuleType("requests"))

import sync  # noqa: E402


class DateWindowTests(unittest.TestCase):
    def test_covers_n_days_including_today(self):
        self.assertEqual(sync.date_window(3, dt.date(2026, 6, 20)), ("2026-06-18", "2026-06-20"))

    def test_crosses_a_month_boundary(self):
        self.assertEqual(sync.date_window(2, dt.date(2026, 7, 1)), ("2026-06-30", "2026-07-01"))

    def test_below_one_is_today_only(self):
        self.assertEqual(sync.date_window(0, dt.date(2026, 6, 20)), ("2026-06-20", "2026-06-20"))


class TrendDaysTests(unittest.TestCase):
    def test_returns_the_dict_days(self):
        self.assertEqual(sync.trend_days({"days": [{"day": "a"}, "x", None, {"day": "b"}]}), [{"day": "a"}, {"day": "b"}])

    def test_anything_else_is_empty(self):
        for bad in (None, [], "x", {}, {"days": "nope"}):
            self.assertEqual(sync.trend_days(bad), [])


class ShapeOfTests(unittest.TestCase):
    def test_carries_no_health_values(self):
        out = sync.shape_of([{
            "day": "2026-06-19",
            "presenceEnd": "2026-06-19T20:35:00.000Z",
            "processing": False,
            "score": 84,
            "sleepDuration": 27600,
            "sleepQualityScore": {"hrv": {"current": 73}},
        }])
        self.assertEqual(out[0]["day"], "2026-06-19")
        self.assertEqual(out[0]["keys"], ["day", "presenceEnd", "processing", "score", "sleepDuration", "sleepQualityScore"])
        self.assertEqual(out[0]["sleepQualityScoreKeys"], ["hrv"])
        flat = repr(out)
        self.assertNotIn("27600", flat)
        self.assertNotIn("84", flat.replace("2026", ""))
        self.assertNotIn("73", flat)


class ParseBackfillTests(unittest.TestCase):
    def test_absent_is_none(self):
        self.assertIsNone(sync.parse_backfill(["--dry-run"]))

    def test_reads_n(self):
        self.assertEqual(sync.parse_backfill(["--backfill", "90"]), 90)

    def test_bad_values_exit(self):
        for argv in (["--backfill"], ["--backfill", "x"], ["--backfill", "0"]):
            with self.assertRaises(SystemExit):
                sync.parse_backfill(argv)


BNE = sync.ZoneInfo("Australia/Brisbane")
START, END = sync.parse_hhmm("05:00"), sync.parse_hhmm("10:00")


def at(h, m, s=0, day=27):
    return dt.datetime(2027, 10, day, h, m, s, tzinfo=BNE)


def nxt(t):
    return sync.next_run_after(t, START, END, 15)


class WindowTests(unittest.TestCase):
    def test_in_window_edges(self):
        self.assertFalse(sync.in_window(at(4, 59), START, END))
        self.assertTrue(sync.in_window(at(5, 0), START, END))
        self.assertTrue(sync.in_window(at(9, 45), START, END))
        self.assertFalse(sync.in_window(at(10, 0), START, END))
        self.assertFalse(sync.in_window(at(10, 1), START, END))

    def test_0459_waits_for_0500(self):
        self.assertEqual(nxt(at(4, 59)), at(5, 0))

    def test_0500_next_is_0515(self):
        self.assertEqual(nxt(at(5, 0)), at(5, 15))

    def test_mid_slot_rounds_up_to_the_quarter(self):
        self.assertEqual(nxt(at(7, 3, 20)), at(7, 15))

    def test_0945_is_the_last_pull_then_next_morning(self):
        self.assertEqual(nxt(at(9, 30)), at(9, 45))
        self.assertEqual(nxt(at(9, 45)), at(5, 0, day=28))

    def test_1000_and_1001_wait_for_next_morning(self):
        self.assertEqual(nxt(at(10, 0)), at(5, 0, day=28))
        self.assertEqual(nxt(at(10, 1)), at(5, 0, day=28))

    def test_late_evening_and_after_midnight(self):
        self.assertEqual(nxt(at(23, 50)), at(5, 0, day=28))
        self.assertEqual(nxt(at(0, 10)), at(5, 0))

    def test_a_full_day_has_twenty_pulls_all_inside_the_window(self):
        t, pulls = at(0, 0), []
        while True:
            t = nxt(t)
            if t.day != 27:
                break
            pulls.append(t)
        self.assertEqual(len(pulls), 20)  # 05:00 … 09:45
        self.assertEqual((pulls[0].hour, pulls[0].minute), (5, 0))
        self.assertEqual((pulls[-1].hour, pulls[-1].minute), (9, 45))
        self.assertTrue(all(sync.in_window(p, START, END) for p in pulls))
        self.assertTrue(all((b - a).total_seconds() == 900 for a, b in zip(pulls, pulls[1:])))


class _HTTPError(Exception):
    def __init__(self, status):
        super().__init__(f"{status} Client Error for url: https://client-api.8slp.net/v1/users/SECRET-ID/trends")
        self.response = types.SimpleNamespace(status_code=status)


sync.requests.HTTPError = _HTTPError


class _Base(unittest.TestCase):
    def setUp(self):
        self._saved = {k: getattr(sync, k) for k in ("authenticate", "fetch_trends")}
        sync._token = None
        sync._login_blocked_until = 0.0
        sync._login_backoff = 0.0
        sync._last_manual = 0.0
        self.logins = 0

    def tearDown(self):
        for k, v in self._saved.items():
            setattr(sync, k, v)

    def login_ok(self, expires_in=3600):
        def auth():
            self.logins += 1
            return f"tok{self.logins}", "user", expires_in
        sync.authenticate = auth


class TokenTests(_Base):
    def test_token_is_reused_until_near_expiry(self):
        self.login_ok()
        self.assertEqual(sync.get_token(), ("tok1", "user"))
        self.assertEqual(sync.get_token(), ("tok1", "user"))
        self.assertEqual(self.logins, 1)

    def test_expiring_token_logs_in_again(self):
        self.login_ok(expires_in=60)  # inside the 2-minute margin
        sync.get_token()
        sync.get_token()
        self.assertEqual(self.logins, 2)

    def test_401_on_trends_forgets_the_token_and_logs_in_once(self):
        self.login_ok()
        calls = []

        def trends(token, user_id, start, end):
            calls.append(token)
            if token == "tok1":
                raise _HTTPError(401)
            return [{"day": "x"}]

        sync.fetch_trends = trends
        self.assertEqual(sync.collect_days(3), [{"day": "x"}])
        self.assertEqual(calls, ["tok1", "tok2"])
        self.assertEqual(self.logins, 2)

    def test_other_http_errors_are_not_retried(self):
        self.login_ok()

        def trends(*_a):
            raise _HTTPError(500)

        sync.fetch_trends = trends
        with self.assertRaises(_HTTPError):
            sync.collect_days(3)
        self.assertEqual(self.logins, 1)


class LoginBackoffTests(_Base):
    def test_refused_login_pauses_further_attempts_and_doubles(self):
        def refused():
            self.logins += 1
            raise sync.LoginRefused(401)

        sync.authenticate = refused
        with self.assertRaises(sync.LoginRefused):
            sync.get_token()
        self.assertEqual(sync._login_backoff, 15 * 60)
        with self.assertRaises(RuntimeError) as cm:
            sync.get_token()  # paused — no new attempt
        self.assertIn("login paused", str(cm.exception))
        self.assertEqual(self.logins, 1)
        sync._login_blocked_until = 0.0  # pretend the pause ran out
        with self.assertRaises(sync.LoginRefused):
            sync.get_token()
        self.assertEqual(sync._login_backoff, 30 * 60)

    def test_backoff_caps_at_six_hours_and_resets_on_success(self):
        sync._login_backoff = 6 * 60 * 60

        def refused():
            raise sync.LoginRefused(429)

        sync.authenticate = refused
        with self.assertRaises(sync.LoginRefused):
            sync.get_token()
        self.assertEqual(sync._login_backoff, 6 * 60 * 60)
        sync._login_blocked_until = 0.0
        self.login_ok()
        sync.get_token()
        self.assertEqual(sync._login_backoff, 0.0)


class ManualSyncTests(_Base):
    def setUp(self):
        super().setUp()
        self._do_sync = sync.do_sync
        self.started = []
        def fake(reason, lock_held=False):
            self.started.append((reason, lock_held))
            if lock_held:
                sync._sync_lock.release()

        sync.do_sync = fake

    def tearDown(self):
        sync.do_sync = self._do_sync
        super().tearDown()

    def test_starts_then_cools_down(self):
        self.assertEqual(sync.request_manual_sync(), "started")
        for _ in range(50):  # the thread runs the fake pull and releases the lock
            if self.started:
                break
            sync.time.sleep(0.01)
        self.assertEqual(self.started, [("sync now", True)])
        self.assertFalse(sync._sync_lock.locked())
        self.assertEqual(sync.request_manual_sync(), "cooldown")

    def test_paused_after_a_refused_login(self):
        sync._login_blocked_until = sync.time.time() + 600
        self.assertEqual(sync.request_manual_sync(), "paused")
        self.assertEqual(self.started, [])

    def test_skips_while_a_pull_runs(self):
        sync._sync_lock.acquire()
        try:
            self.assertEqual(sync.request_manual_sync(), "running")
        finally:
            sync._sync_lock.release()


class MiscTests(unittest.TestCase):
    def test_error_text_drops_the_url(self):
        text = sync.describe_error(_HTTPError(500))
        self.assertEqual(text, "_HTTPError: HTTP 500")
        self.assertNotIn("SECRET-ID", text)
        self.assertEqual(sync.describe_error(RuntimeError("boom")), "boom")

    def test_bad_schedules_are_refused(self):
        with self.assertRaises(ValueError):
            sync.check_schedule(START, END, 0)
        with self.assertRaises(ValueError):
            sync.check_schedule(END, START, 15)
        sync.check_schedule(START, END, 15)


if __name__ == "__main__":
    unittest.main()
