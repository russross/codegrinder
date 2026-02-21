from __future__ import annotations

from datetime import datetime, timedelta


def _quantize_timedelta(value: timedelta, quantum: timedelta) -> timedelta:
    micros = int(value.total_seconds() * 1_000_000)
    quantum_micros = int(quantum.total_seconds() * 1_000_000)
    if quantum_micros <= 0:
        raise ValueError("quantum must be positive")
    return timedelta(microseconds=(micros // quantum_micros) * quantum_micros)


def round_duration_for_log(duration: timedelta) -> timedelta:
    if duration < timedelta(seconds=1):
        return _quantize_timedelta(duration, timedelta(milliseconds=1))
    if duration < timedelta(seconds=10):
        return _quantize_timedelta(duration, timedelta(milliseconds=10))
    return _quantize_timedelta(duration, timedelta(milliseconds=100))


def format_duration_for_log(duration: timedelta) -> str:
    rounded = round_duration_for_log(duration)
    total_micros = int(rounded.total_seconds() * 1_000_000)
    sign = ""
    if total_micros < 0:
        sign = "-"
        total_micros = -total_micros
    if total_micros == 0:
        return "0s"

    hour_micros = 3_600_000_000
    minute_micros = 60_000_000
    second_micros = 1_000_000
    millis_micros = 1_000

    hours, remainder = divmod(total_micros, hour_micros)
    minutes, remainder = divmod(remainder, minute_micros)
    seconds, remainder = divmod(remainder, second_micros)
    millis, micros = divmod(remainder, millis_micros)

    parts: list[str] = []
    if hours > 0:
        parts.append(f"{hours}h")
    if minutes > 0:
        parts.append(f"{minutes}m")
    if seconds > 0 or (hours > 0 or minutes > 0):
        if millis > 0:
            parts.append(f"{seconds}.{millis:03d}s")
        else:
            parts.append(f"{seconds}s")
    elif millis > 0:
        parts.append(f"{millis}ms")
    elif micros > 0:
        parts.append(f"{micros}µs")
    else:
        parts.append("0s")
    return sign + "".join(parts)


def next_session_expiry(now: datetime, sessions_expire: list[datetime]) -> datetime:
    if not sessions_expire:
        raise ValueError("sessions_expire cannot be empty")
    if now.tzinfo is None:
        raise ValueError("now must be timezone-aware")

    expires: datetime | None = None
    for marker in sessions_expire:
        if marker.tzinfo is None:
            raise ValueError("session marker must be timezone-aware")
        when = now.replace(
            month=marker.month,
            day=marker.day,
            hour=marker.hour,
            minute=marker.minute,
            second=marker.second,
            microsecond=0,
        )
        if when <= now:
            when = when.replace(year=now.year + 1)
        if expires is None or when < expires:
            expires = when

    if expires is None:
        raise AssertionError("unreachable")
    return expires
