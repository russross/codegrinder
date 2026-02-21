from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta

from daycare_registry import DaycareRegistration, DaycareRegistry
from signatures import compute_daycare_registration_signature


class DaycareRegistryTests(unittest.TestCase):
    def test_insert_and_assign(self) -> None:
        now = datetime(2026, 2, 15, 10, 0, 0, tzinfo=UTC)
        registry = DaycareRegistry(secret="secret", version="2.8.0", now_provider=lambda: now)
        reg = DaycareRegistration(
            hostname="dc-1",
            problem_types=["python3unittest", "gotest"],
            capacity=2,
            time=now,
            version="2.8.0",
            signature="",
        )
        reg.signature = compute_daycare_registration_signature(
            reg.hostname,
            reg.problem_types,
            reg.capacity,
            reg.time,
            reg.version,
            "secret",
        )
        registry.insert(reg)
        host = registry.assign({"python3unittest"})
        self.assertEqual(host, "dc-1")

    def test_rejects_bad_signature(self) -> None:
        now = datetime(2026, 2, 15, 10, 0, 0, tzinfo=UTC)
        registry = DaycareRegistry(secret="secret", version="2.8.0", now_provider=lambda: now)
        reg = DaycareRegistration(
            hostname="dc-1",
            problem_types=["python3unittest"],
            capacity=1,
            time=now,
            version="2.8.0",
            signature="bad",
        )
        with self.assertRaises(ValueError):
            registry.insert(reg)

    def test_expire_stale_registration(self) -> None:
        now = datetime(2026, 2, 15, 10, 0, 0, tzinfo=UTC)
        now_ref = {"value": now}
        registry = DaycareRegistry(secret="secret", version="2.8.0", now_provider=lambda: now_ref["value"])
        reg = DaycareRegistration(
            hostname="dc-1",
            problem_types=["python3unittest"],
            capacity=1,
            time=now,
            version="2.8.0",
            signature="",
        )
        reg.signature = compute_daycare_registration_signature(
            reg.hostname, reg.problem_types, reg.capacity, reg.time, reg.version, "secret"
        )
        registry.insert(reg)
        now_ref["value"] = now + timedelta(seconds=21)
        registry.expire()
        self.assertEqual(registry.snapshot(), {})


if __name__ == "__main__":
    unittest.main()
