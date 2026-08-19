from __future__ import annotations

from specter.network.commands import CommandNotFoundError, run_command


def iperf3_available() -> bool:
    try:
        result = run_command(("iperf3", "--version"), timeout_seconds=3)
    except CommandNotFoundError:
        return False
    return result.returncode == 0
