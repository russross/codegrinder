from __future__ import annotations

from typing import NoReturn


class CliError(Exception):
    def __init__(self, message: str, exit_code: int = 1) -> None:
        super().__init__(message)
        self.message = message
        self.exit_code = exit_code


def fail(message: str, exit_code: int = 1) -> NoReturn:
    raise CliError(message, exit_code=exit_code)
