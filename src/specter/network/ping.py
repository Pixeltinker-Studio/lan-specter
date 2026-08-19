from __future__ import annotations

import re

from specter.core.results import PingResult
from specter.network.commands import CommandNotFoundError, run_command


PACKETS_RE = re.compile(
    r"(?P<tx>\d+)\s+packets transmitted,\s+(?P<rx>\d+)\s+(?:packets )?received,\s+"
    r"(?P<loss>\d+(?:\.\d+)?)% packet loss",
    re.IGNORECASE,
)
RTT_RE = re.compile(
    r"(?:rtt|round-trip) min/avg/max/(?:mdev|stddev)\s+=\s+"
    r"(?P<min>\d+(?:\.\d+)?)/(?P<avg>\d+(?:\.\d+)?)/(?P<max>\d+(?:\.\d+)?)/",
    re.IGNORECASE,
)


def parse_ping_output(target: str, output: str, returncode: int = 0, stderr: str = "") -> PingResult:
    transmitted: int | None = None
    received: int | None = None
    packet_loss_percent: float | None = None
    min_latency_ms: float | None = None
    avg_latency_ms: float | None = None
    max_latency_ms: float | None = None

    if match := PACKETS_RE.search(output):
        transmitted = int(match.group("tx"))
        received = int(match.group("rx"))
        packet_loss_percent = float(match.group("loss"))

    if match := RTT_RE.search(output):
        min_latency_ms = float(match.group("min"))
        avg_latency_ms = float(match.group("avg"))
        max_latency_ms = float(match.group("max"))

    reachable = bool(received and received > 0 and returncode == 0)
    error = None
    if not reachable and stderr.strip():
        error = stderr.strip()
    elif not reachable and output.strip() and transmitted is None:
        error = output.strip()

    return PingResult(
        target=target,
        reachable=reachable,
        transmitted=transmitted,
        received=received,
        packet_loss_percent=packet_loss_percent,
        min_latency_ms=min_latency_ms,
        avg_latency_ms=avg_latency_ms,
        max_latency_ms=max_latency_ms,
        error=error,
    )


def ping(target: str, *, count: int = 4, timeout_seconds: int = 5) -> PingResult:
    command = ("ping", "-c", str(count), "-W", str(timeout_seconds), target)
    try:
        result = run_command(command, timeout_seconds=(count * timeout_seconds) + 2)
    except CommandNotFoundError as exc:
        return PingResult(target=target, reachable=False, error=str(exc))

    return parse_ping_output(target, result.stdout, result.returncode, result.stderr)
