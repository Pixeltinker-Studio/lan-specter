from __future__ import annotations

import re
from pathlib import Path

from specter.core.results import LinkResult
from specter.network.commands import CommandNotFoundError, run_command


SPEED_RE = re.compile(r"^\s*Speed:\s*(?P<speed>\d+)\s*Mb/s\s*$", re.IGNORECASE)
DUPLEX_RE = re.compile(r"^\s*Duplex:\s*(?P<duplex>\S+)", re.IGNORECASE)
LINK_RE = re.compile(r"^\s*Link detected:\s*(?P<link>yes|no)\s*$", re.IGNORECASE)
AUTONEG_RE = re.compile(r"^\s*Auto-negotiation:\s*(?P<autoneg>\S+)\s*$", re.IGNORECASE)


def parse_ethtool_output(interface: str, output: str) -> LinkResult:
    speed_mbps: int | None = None
    duplex: str | None = None
    link_detected: bool | None = None
    autonegotiation: str | None = None

    for line in output.splitlines():
        if match := SPEED_RE.match(line):
            speed_mbps = int(match.group("speed"))
            continue
        if match := DUPLEX_RE.match(line):
            duplex = match.group("duplex").lower()
            continue
        if match := LINK_RE.match(line):
            link_detected = match.group("link").lower() == "yes"
            continue
        if match := AUTONEG_RE.match(line):
            autonegotiation = match.group("autoneg").lower()

    return LinkResult(
        interface=interface,
        link_detected=link_detected,
        speed_mbps=speed_mbps,
        duplex=duplex,
        autonegotiation=autonegotiation,
    )


def read_link(interface: str) -> LinkResult:
    try:
        result = run_command(("ethtool", interface), timeout_seconds=5)
    except CommandNotFoundError as exc:
        fallback = read_link_from_sysfs(interface)
        if fallback.link_detected is not None or fallback.speed_mbps is not None:
            return fallback
        return LinkResult(interface=interface, link_detected=None, speed_mbps=None, duplex=None, error=str(exc))

    if result.returncode != 0:
        fallback = read_link_from_sysfs(interface)
        if fallback.link_detected is not None or fallback.speed_mbps is not None:
            return fallback
        error = result.stderr.strip() or result.stdout.strip() or "ethtool failed"
        return LinkResult(interface=interface, link_detected=None, speed_mbps=None, duplex=None, error=error)

    return parse_ethtool_output(interface, result.stdout)


def read_link_from_sysfs(interface: str, sys_class_net: Path = Path("/sys/class/net")) -> LinkResult:
    iface_path = sys_class_net / interface
    link_detected: bool | None = None
    speed_mbps: int | None = None

    carrier_path = iface_path / "carrier"
    if carrier_path.exists():
        carrier = carrier_path.read_text(encoding="utf-8", errors="ignore").strip()
        if carrier in {"0", "1"}:
            link_detected = carrier == "1"

    speed_path = iface_path / "speed"
    if speed_path.exists():
        speed = speed_path.read_text(encoding="utf-8", errors="ignore").strip()
        if speed.isdigit():
            speed_mbps = int(speed)

    return LinkResult(interface=interface, link_detected=link_detected, speed_mbps=speed_mbps, duplex=None)
