from __future__ import annotations

import socket

from specter.core.results import PingResult
from specter.network.ping import ping


DEFAULT_REMOTE_HOSTNAME = "specter-re01"


def resolve_remote(hostname: str = DEFAULT_REMOTE_HOSTNAME) -> str | None:
    try:
        return socket.gethostbyname(hostname)
    except OSError:
        return None


def detect_remote(hostname: str = DEFAULT_REMOTE_HOSTNAME, *, count: int = 2) -> PingResult:
    target = resolve_remote(hostname) or hostname
    result = ping(target, count=count)
    if result.target == target and target != hostname:
        return PingResult(
            target=hostname,
            reachable=result.reachable,
            transmitted=result.transmitted,
            received=result.received,
            packet_loss_percent=result.packet_loss_percent,
            min_latency_ms=result.min_latency_ms,
            avg_latency_ms=result.avg_latency_ms,
            max_latency_ms=result.max_latency_ms,
            error=result.error,
        )
    return result
