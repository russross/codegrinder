from __future__ import annotations

import random
import threading
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Callable

from signatures import compute_daycare_registration_signature

DAYCARE_REGISTRATION_INTERVAL = timedelta(seconds=10)
DAYCARE_REGISTRATION_TTL = DAYCARE_REGISTRATION_INTERVAL * 2
DAYCARE_MAX_TIME_DRIFT = timedelta(minutes=1)


@dataclass(slots=True)
class DaycareRegistration:
    hostname: str
    problem_types: list[str]
    capacity: int
    time: datetime
    version: str = ""
    signature: str = ""


class DaycareRegistry:
    def __init__(
        self,
        secret: str,
        version: str,
        now_provider: Callable[[], datetime] | None = None,
        rng: random.Random | None = None,
    ) -> None:
        self._secret = secret
        self._version = version
        self._now = now_provider or (lambda: datetime.now(tz=UTC))
        self._rng = rng or random.Random()
        self._lock = threading.Lock()
        self._daycares: dict[str, DaycareRegistration] = {}

    def snapshot(self) -> dict[str, dict[str, object]]:
        with self._lock:
            self.expire_locked()
            out: dict[str, dict[str, object]] = {}
            for host, reg in self._daycares.items():
                out[host] = {
                    "hostname": reg.hostname,
                    "problemTypes": list(reg.problem_types),
                    "capacity": reg.capacity,
                    "time": reg.time.astimezone(UTC).isoformat().replace("+00:00", "Z"),
                }
            return out

    def expire(self) -> None:
        with self._lock:
            self.expire_locked()

    def expire_locked(self) -> None:
        now = self._now()
        stale = [host for host, reg in self._daycares.items() if (now - reg.time) > DAYCARE_REGISTRATION_TTL]
        for host in stale:
            del self._daycares[host]

    def insert(self, registration: DaycareRegistration) -> None:
        with self._lock:
            sig = compute_daycare_registration_signature(
                hostname=registration.hostname,
                problem_types=list(registration.problem_types),
                capacity=int(registration.capacity),
                when=registration.time,
                version=registration.version,
                secret=self._secret,
            )
            if sig != registration.signature:
                raise ValueError(f"signature mismatch: computed {sig} but found {registration.signature}")
            if registration.version != self._version:
                raise ValueError(f"version mismatch: daycare is {registration.version}, but ta is {self._version}")
            drift = self._now() - registration.time
            if drift < timedelta(0):
                drift = -drift
            if drift > DAYCARE_MAX_TIME_DRIFT:
                raise ValueError("time drift is too great")
            clean = DaycareRegistration(
                hostname=registration.hostname,
                problem_types=sorted(list(registration.problem_types)),
                capacity=int(registration.capacity),
                time=self._now(),
                version="",
                signature="",
            )
            self._daycares[clean.hostname] = clean
            self.expire_locked()

    def register_local(self, hostname: str, problem_types: list[str], capacity: int) -> None:
        with self._lock:
            self._daycares[hostname] = DaycareRegistration(
                hostname=hostname,
                problem_types=sorted(list(problem_types)),
                capacity=int(capacity),
                time=self._now(),
            )
            self.expire_locked()

    def assign(self, required_problem_types: set[str]) -> str:
        with self._lock:
            self.expire_locked()
            eligible: list[DaycareRegistration] = []
            total_weight = 0
            required = set(required_problem_types)
            for reg in self._daycares.values():
                if required.issubset(set(reg.problem_types)):
                    eligible.append(reg)
                    total_weight += int(reg.capacity)
            if total_weight <= 0:
                raise ValueError("no eligible daycare found")
            point = self._rng.randrange(total_weight)
            skipped = 0
            for reg in eligible:
                skipped += int(reg.capacity)
                if point < skipped:
                    return reg.hostname
            raise RuntimeError("failed to find daycare, please report this error")
