from __future__ import annotations

import os
import subprocess
from collections.abc import Mapping, Sequence

from specter.core.results import CommandResult


class CommandNotFoundError(RuntimeError):
    def __init__(self, executable: str) -> None:
        super().__init__(f"Required command not found: {executable}")
        self.executable = executable


def run_command(
    command: Sequence[str],
    *,
    timeout_seconds: float = 10,
    env: Mapping[str, str] | None = None,
) -> CommandResult:
    if not command:
        raise ValueError("command must not be empty")

    process_env = os.environ.copy()
    process_env["LC_ALL"] = "C"
    if env:
        process_env.update(env)

    try:
        completed = subprocess.run(
            list(command),
            capture_output=True,
            check=False,
            env=process_env,
            text=True,
            timeout=timeout_seconds,
        )
    except FileNotFoundError as exc:
        raise CommandNotFoundError(str(command[0])) from exc

    return CommandResult(
        command=tuple(command),
        returncode=completed.returncode,
        stdout=completed.stdout,
        stderr=completed.stderr,
    )
