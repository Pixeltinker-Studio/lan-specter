from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime

from specter.network.commands import CommandNotFoundError, run_command


@dataclass(frozen=True)
class WifiAccessPoint:
    bssid: str
    ssid: str | None
    mode: str | None
    channel: int | None
    frequency_mhz: int | None
    signal_percent: int | None
    security: str | None
    band: str | None = None
    in_use: bool = False


@dataclass(frozen=True)
class WifiStatus:
    interface: str | None
    adapter_available: bool
    radio_enabled: bool | None
    device_state: str | None = None
    connection: str | None = None
    access_points: tuple[WifiAccessPoint, ...] = field(default_factory=tuple)
    scanned_at: str | None = None
    error: str | None = None


def read_wifi_status(*, interface: str | None = None, rescan: bool = False) -> WifiStatus:
    try:
        radio_result = run_command(("nmcli", "-t", "-f", "WIFI", "radio"), timeout_seconds=5)
    except CommandNotFoundError:
        return WifiStatus(
            interface=interface,
            adapter_available=False,
            radio_enabled=None,
            error="NetworkManager command 'nmcli' is not installed",
        )

    radio_enabled = _parse_radio_state(radio_result.stdout) if radio_result.returncode == 0 else None
    device_result = run_command(
        ("nmcli", "-t", "--escape", "yes", "--separator", "\t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device", "status"),
        timeout_seconds=5,
    )
    if device_result.returncode != 0:
        return WifiStatus(
            interface=interface,
            adapter_available=False,
            radio_enabled=radio_enabled,
            error=_command_error(device_result.stderr, "Unable to read NetworkManager device status"),
        )

    devices = parse_wifi_devices(device_result.stdout)
    selected = next((device for device in devices if device[0] == interface), None) if interface else None
    selected = selected or next(iter(devices), None)
    if selected is None:
        return WifiStatus(
            interface=interface,
            adapter_available=False,
            radio_enabled=radio_enabled,
            error=None,
        )

    device_name, device_state, connection = selected
    if radio_enabled is False:
        return WifiStatus(
            interface=device_name,
            adapter_available=True,
            radio_enabled=False,
            device_state=device_state,
            connection=connection,
        )

    scan_result = run_command(
        (
            "nmcli",
            "-t",
            "--escape",
            "yes",
            "--separator",
            "\t",
            "-f",
            "IN-USE,BSSID,SSID,MODE,CHAN,FREQ,SIGNAL,SECURITY",
            "device",
            "wifi",
            "list",
            "--rescan",
            "yes" if rescan else "no",
            "ifname",
            device_name,
        ),
        timeout_seconds=20 if rescan else 8,
    )
    if scan_result.returncode != 0:
        return WifiStatus(
            interface=device_name,
            adapter_available=True,
            radio_enabled=radio_enabled,
            device_state=device_state,
            connection=connection,
            error=_command_error(scan_result.stderr, "Wi-Fi scan failed"),
        )

    access_points = parse_access_points(scan_result.stdout)
    return WifiStatus(
        interface=device_name,
        adapter_available=True,
        radio_enabled=radio_enabled,
        device_state=device_state,
        connection=connection,
        access_points=access_points,
        scanned_at=datetime.now(UTC).isoformat(),
    )


def set_wifi_radio(enabled: bool) -> str | None:
    try:
        result = run_command(("nmcli", "radio", "wifi", "on" if enabled else "off"), timeout_seconds=10)
    except CommandNotFoundError:
        return "NetworkManager command 'nmcli' is not installed"
    if result.returncode == 0:
        return None
    return _command_error(result.stderr, "Unable to change Wi-Fi radio state")


def parse_wifi_devices(output: str) -> tuple[tuple[str, str | None, str | None], ...]:
    devices: list[tuple[str, str | None, str | None]] = []
    for line in output.splitlines():
        fields = split_escaped_fields(line)
        if len(fields) < 4 or fields[1].strip().lower() != "wifi":
            continue
        connection = _optional(fields[3])
        if connection in {"--", "none"}:
            connection = None
        devices.append((fields[0], _optional(fields[2]), connection))
    return tuple(devices)


def parse_access_points(output: str) -> tuple[WifiAccessPoint, ...]:
    access_points: list[WifiAccessPoint] = []
    for line in output.splitlines():
        fields = split_escaped_fields(line)
        if len(fields) < 8 or not fields[1]:
            continue
        frequency_mhz = _optional_int(fields[5])
        access_points.append(
            WifiAccessPoint(
                in_use=fields[0].strip() == "*",
                bssid=fields[1].upper(),
                ssid=_optional(fields[2]),
                mode=_optional(fields[3]),
                channel=_optional_int(fields[4]),
                frequency_mhz=frequency_mhz,
                signal_percent=_bounded_percent(fields[6]),
                security=_optional_security(fields[7]),
                band=_frequency_band(frequency_mhz),
            )
        )
    return tuple(sorted(access_points, key=lambda access_point: (not access_point.in_use, -(access_point.signal_percent or -1))))


def split_escaped_fields(line: str, separator: str = "\t") -> tuple[str, ...]:
    fields: list[str] = []
    current: list[str] = []
    escaped = False
    for character in line:
        if escaped:
            current.append(character)
            escaped = False
        elif character == "\\":
            escaped = True
        elif character == separator:
            fields.append("".join(current))
            current = []
        else:
            current.append(character)
    if escaped:
        current.append("\\")
    fields.append("".join(current))
    return tuple(fields)


def _parse_radio_state(output: str) -> bool | None:
    state = output.strip().lower()
    if state == "enabled":
        return True
    if state == "disabled":
        return False
    return None


def _optional(value: str) -> str | None:
    stripped = value.strip()
    return stripped or None


def _optional_security(value: str) -> str | None:
    security = _optional(value)
    return None if security == "--" else security


def _optional_int(value: str) -> int | None:
    try:
        return int(value.strip())
    except ValueError:
        return None


def _bounded_percent(value: str) -> int | None:
    parsed = _optional_int(value)
    if parsed is None:
        return None
    return max(0, min(100, parsed))


def _frequency_band(frequency_mhz: int | None) -> str | None:
    if frequency_mhz is None:
        return None
    if 2400 <= frequency_mhz < 2500:
        return "2.4 GHz"
    if 4900 <= frequency_mhz < 5900:
        return "5 GHz"
    if 5925 <= frequency_mhz < 7125:
        return "6 GHz"
    return None


def _command_error(stderr: str, fallback: str) -> str:
    return stderr.strip() or fallback
