"""Unit tests for the (minimal) Python-side shaping in sync.py.

garminconnect/requests are stubbed so this runs with the stdlib alone — no Garmin
deps, no network. Run: ``python -m unittest`` (or ``python test_normalise.py``)
from this directory, locally or in the container.
"""
import sys
import types
import unittest

# Stub the heavy/optional deps before importing sync (we only test pure helpers).
# sync.py does `from garminconnect import Garmin`, so the stub must expose Garmin.
_garminconnect = types.ModuleType("garminconnect")
_garminconnect.Garmin = object  # placeholder; the pure-helper tests never construct it
sys.modules.setdefault("garminconnect", _garminconnect)
sys.modules.setdefault("requests", types.ModuleType("requests"))

import sync  # noqa: E402


class PickVo2maxTests(unittest.TestCase):
    def test_takes_first_entry_of_a_list(self):
        first = {"generic": {"vo2MaxValue": 48.0}}
        self.assertIs(sync.pick_vo2max([first, {"generic": {}}]), first)

    def test_empty_list_is_none(self):
        self.assertIsNone(sync.pick_vo2max([]))

    def test_passes_through_a_non_list_object(self):
        obj = {"generic": {"vo2MaxValue": 50}}
        self.assertIs(sync.pick_vo2max(obj), obj)

    def test_none_stays_none(self):
        self.assertIsNone(sync.pick_vo2max(None))


class BuildDayTests(unittest.TestCase):
    def test_assembles_only_present_keys(self):
        day = sync.build_day(
            "2026-06-20",
            sleep={"dailySleepDTO": {"sleepTimeSeconds": 27000}},
            summary={"totalSteps": 8423},
            hrv={"hrvSummary": {"lastNightAvg": 62}},
            weight={"totalAverage": {"weight": 81700}},
            vo2max=[{"generic": {"vo2MaxValue": 48.0}}],
            activities=[{"activityType": {"typeKey": "running"}, "duration": 1830}],
        )
        self.assertEqual(day["date"], "2026-06-20")
        self.assertEqual(day["summary"], {"totalSteps": 8423})
        self.assertEqual(day["vo2max"], {"generic": {"vo2MaxValue": 48.0}})
        self.assertEqual(
            set(day.keys()),
            {"date", "sleep", "summary", "hrv", "weight", "vo2max", "activities"},
        )

    def test_missing_pieces_are_omitted(self):
        day = sync.build_day("2026-06-01")
        self.assertEqual(day, {"date": "2026-06-01"})

    def test_empty_vo2max_list_omitted(self):
        day = sync.build_day("2026-06-02", summary={"totalSteps": 1}, vo2max=[])
        self.assertNotIn("vo2max", day)
        self.assertIn("summary", day)

    def test_empty_activities_list_omitted(self):
        # An empty/None activities fetch must not inject an "activities" key.
        self.assertNotIn("activities", sync.build_day("2026-06-03", activities=[]))
        self.assertNotIn("activities", sync.build_day("2026-06-03", activities=None))

    def test_activities_passed_through_when_present(self):
        acts = [{"activityType": {"typeKey": "cycling"}, "duration": 3600}]
        day = sync.build_day("2026-06-04", activities=acts)
        self.assertEqual(day["activities"], acts)


class PickActivitiesTests(unittest.TestCase):
    def test_keeps_only_activities_starting_on_the_target_local_date(self):
        raw = [
            {"activityType": {"typeKey": "running"}, "startTimeLocal": "2026-06-20 06:31:00"},
            {"activityType": {"typeKey": "cycling"}, "startTimeLocal": "2026-06-19 18:00:00"},
            {"activityType": {"typeKey": "strength_training"}, "startTimeLocal": "2026-06-20 19:10:00"},
        ]
        kept = sync.pick_activities(raw, "2026-06-20")
        self.assertEqual(len(kept), 2)
        self.assertEqual(
            {a["activityType"]["typeKey"] for a in kept}, {"running", "strength_training"}
        )

    def test_handles_iso_t_separator_and_trailing_offset(self):
        raw = [{"startTimeLocal": "2026-06-20T06:31:00.0", "activityType": {"typeKey": "running"}}]
        self.assertEqual(len(sync.pick_activities(raw, "2026-06-20")), 1)

    def test_none_or_non_list_is_empty(self):
        self.assertEqual(sync.pick_activities(None, "2026-06-20"), [])
        self.assertEqual(sync.pick_activities({"not": "a list"}, "2026-06-20"), [])

    def test_activity_without_a_start_is_dropped(self):
        raw = [{"activityType": {"typeKey": "running"}}]
        self.assertEqual(sync.pick_activities(raw, "2026-06-20"), [])


class RecentDatesTests(unittest.TestCase):
    def test_returns_n_iso_dates_newest_first(self):
        dates = sync.recent_dates(3)
        self.assertEqual(len(dates), 3)
        # newest first, strictly descending, ISO formatted
        self.assertTrue(all(len(d) == 10 and d[4] == "-" for d in dates))
        self.assertGreater(dates[0], dates[1])
        self.assertGreater(dates[1], dates[2])

    def test_floor_of_one_day(self):
        self.assertEqual(len(sync.recent_dates(0)), 1)


if __name__ == "__main__":
    unittest.main()
