from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta

from timeutils import format_duration_for_log, next_session_expiry, round_duration_for_log


class TimeUtilsTests(unittest.TestCase):
    def test_round_duration_for_log_subsecond(self) -> None:
        value = timedelta(milliseconds=123, microseconds=987)
        self.assertEqual(round_duration_for_log(value), timedelta(milliseconds=123))

    def test_round_duration_for_log_under_ten_seconds(self) -> None:
        value = timedelta(seconds=2, milliseconds=347)
        self.assertEqual(round_duration_for_log(value), timedelta(seconds=2, milliseconds=340))

    def test_round_duration_for_log_over_ten_seconds(self) -> None:
        value = timedelta(seconds=19, milliseconds=299)
        self.assertEqual(round_duration_for_log(value), timedelta(seconds=19, milliseconds=200))

    def test_format_duration_for_log_subsecond(self) -> None:
        self.assertEqual(format_duration_for_log(timedelta(milliseconds=123, microseconds=987)), "123ms")

    def test_format_duration_for_log_seconds(self) -> None:
        self.assertEqual(format_duration_for_log(timedelta(seconds=2, milliseconds=347)), "2.340s")

    def test_format_duration_for_log_minutes(self) -> None:
        self.assertEqual(format_duration_for_log(timedelta(minutes=1, seconds=2, milliseconds=300)), "1m2.300s")

    def test_next_session_expiry_same_year(self) -> None:
        now = datetime(2026, 2, 15, 10, 0, 0, tzinfo=UTC)
        markers = [
            datetime(2020, 1, 1, 0, 0, 0, tzinfo=UTC),
            datetime(2020, 7, 1, 0, 0, 0, tzinfo=UTC),
        ]
        got = next_session_expiry(now, markers)
        self.assertEqual(got, datetime(2026, 7, 1, 0, 0, 0, tzinfo=UTC))

    def test_next_session_expiry_rollover(self) -> None:
        now = datetime(2026, 12, 15, 10, 0, 0, tzinfo=UTC)
        markers = [
            datetime(2020, 1, 1, 0, 0, 0, tzinfo=UTC),
            datetime(2020, 7, 1, 0, 0, 0, tzinfo=UTC),
        ]
        got = next_session_expiry(now, markers)
        self.assertEqual(got, datetime(2027, 1, 1, 0, 0, 0, tzinfo=UTC))


if __name__ == "__main__":
    unittest.main()
