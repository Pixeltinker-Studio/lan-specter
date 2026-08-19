from __future__ import annotations

from specter.core.results import PingResult
from specter.network.ping import ping


DEFAULT_REMOTE_HOSTNAME = "specter-re01.local"


def remote_candidates(hostname: str = DEFAULT_REMOTE_HOSTNAME) -> tuple[str, ...]:
    candidates = [hostname]

    if hostname.endswith(".local"):
        candidates.append(hostname.removesuffix(".local"))
    elif "." not in hostname:
        candidates.append(f"{hostname}.local")

    return tuple(dict.fromkeys(candidates))


def detect_remote(hostname: str = DEFAULT_REMOTE_HOSTNAME, *, count: int = 2) -> PingResult:
    first_result: PingResult | None = None
    for candidate in remote_candidates(hostname):
        result = ping(candidate, count=count)
        first_result = first_result or result
        if result.reachable:
            return result
    return first_result or PingResult(target=hostname, reachable=False, error="No remote candidates found")
