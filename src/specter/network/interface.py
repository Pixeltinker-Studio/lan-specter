from __future__ import annotations

import json
from pathlib import Path

from specter.network.commands import CommandNotFoundError, run_command


SYS_CLASS_NET = Path("/sys/class/net")


def get_default_interface() -> str | None:
    interfaces = get_default_interfaces()
    return interfaces[0] if interfaces else None


def get_default_interfaces() -> tuple[str, ...]:
    try:
        result = run_command(("ip", "route", "show", "default"), timeout_seconds=3)
    except CommandNotFoundError:
        return ()

    if result.returncode != 0:
        return ()

    interfaces: list[str] = []
    for line in result.stdout.splitlines():
        parts = line.split()
        if "dev" in parts:
            index = parts.index("dev")
            if index + 1 < len(parts):
                interface = parts[index + 1]
                if interface not in interfaces:
                    interfaces.append(interface)
    return tuple(interfaces)


def list_candidate_interfaces(sys_class_net: Path = SYS_CLASS_NET) -> tuple[str, ...]:
    if not sys_class_net.exists():
        return ()

    names: list[str] = []
    for item in sorted(sys_class_net.iterdir()):
        if item.name == "lo":
            continue
        if item.name.startswith(("docker", "veth", "br-", "virbr")):
            continue
        names.append(item.name)
    return tuple(names)


def choose_interface(preferred: str | None = None) -> str | None:
    if preferred:
        return preferred

    default_interface = get_default_interface()
    if default_interface:
        return default_interface

    candidates = list_candidate_interfaces()
    if "eth0" in candidates:
        return "eth0"
    if candidates:
        return candidates[0]
    return None


def choose_internet_interface(preferred: str | None = None) -> str | None:
    """Prefer an Internet-routed wired interface, then routed Wi-Fi."""
    if preferred:
        return preferred

    default_interfaces = get_default_interfaces()
    wired = next((name for name in default_interfaces if name.startswith(("eth", "en"))), None)
    if wired is not None:
        return wired
    wifi = next((name for name in default_interfaces if name.startswith(("wlan", "wl"))), None)
    if wifi is not None:
        return wifi
    if default_interfaces:
        return default_interfaces[0]
    return choose_interface()


def get_gateway(interface: str | None = None) -> str | None:
    try:
        result = run_command(("ip", "route", "show", "default"), timeout_seconds=3)
    except CommandNotFoundError:
        return None

    if result.returncode != 0:
        return None

    for line in result.stdout.splitlines():
        parts = line.split()
        if interface and "dev" in parts:
            dev_index = parts.index("dev")
            if dev_index + 1 < len(parts) and parts[dev_index + 1] != interface:
                continue
        if "via" in parts:
            via_index = parts.index("via")
            if via_index + 1 < len(parts):
                return parts[via_index + 1]
    return None


def get_addresses(interface: str) -> tuple[tuple[str, str], ...]:
    try:
        result = run_command(("ip", "-j", "addr", "show", "dev", interface), timeout_seconds=3)
    except CommandNotFoundError:
        return ()

    if result.returncode != 0:
        return ()

    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        return ()

    addresses: list[tuple[str, str]] = []
    for iface in data:
        for addr_info in iface.get("addr_info", []):
            family = addr_info.get("family")
            local = addr_info.get("local")
            prefixlen = addr_info.get("prefixlen")
            if family and local:
                suffix = f"/{prefixlen}" if prefixlen is not None else ""
                addresses.append((family, f"{local}{suffix}"))
    return tuple(addresses)


def get_dns_servers(resolv_conf: Path = Path("/etc/resolv.conf")) -> tuple[str, ...]:
    if not resolv_conf.exists():
        return ()

    servers: list[str] = []
    for line in resolv_conf.read_text(encoding="utf-8", errors="ignore").splitlines():
        stripped = line.strip()
        if stripped.startswith("nameserver "):
            parts = stripped.split()
            if len(parts) >= 2:
                servers.append(parts[1])
    return tuple(servers)


def dhcp_likely(interface: str) -> bool | None:
    lease_dirs = (
        Path("/var/lib/dhcp"),
        Path("/var/lib/NetworkManager"),
        Path("/run/NetworkManager"),
    )
    for lease_dir in lease_dirs:
        if not lease_dir.exists():
            continue
        for lease in lease_dir.glob("*"):
            if interface in lease.name and lease.is_file():
                return True
    return None
