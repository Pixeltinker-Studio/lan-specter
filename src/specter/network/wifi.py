from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from threading import Lock, Thread

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


@dataclass(frozen=True)
class WifiConnectRequest:
    ssid: str
    bssid: str
    security: str | None
    password: str | None = None
    interface: str | None = None


@dataclass(frozen=True)
class WifiConnectResult:
    success: bool
    interface: str | None
    ssid: str
    error: str | None = None


WifiConnectRunner = Callable[[WifiConnectRequest], WifiConnectResult]


class WifiConnectionService:
    """Activate one NetworkManager Wi-Fi connection without blocking the UI."""

    def __init__(self, *, runner: WifiConnectRunner | None = None) -> None:
        self._runner = runner or connect_wifi
        self._lock = Lock()
        self._worker: Thread | None = None
        self._status = "idle"
        self._started_at: str | None = None
        self._completed_at: str | None = None
        self._target: dict[str, str | None] | None = None
        self._result: WifiConnectResult | None = None

    def start(self, request: WifiConnectRequest) -> bool:
        with self._lock:
            if self._worker is not None and self._worker.is_alive():
                return False
            self._status = "running"
            self._started_at = _utc_now()
            self._completed_at = None
            self._target = {
                "ssid": request.ssid,
                "bssid": request.bssid,
                "security": request.security,
            }
            self._result = None
            self._worker = Thread(
                target=self._run,
                args=(request,),
                name="specter-wifi-connect",
                daemon=True,
            )
            self._worker.start()
            return True

    def snapshot(self) -> dict:
        with self._lock:
            result = self._result
            return {
                "request": {
                    "status": self._status,
                    "started_at": self._started_at,
                    "completed_at": self._completed_at,
                },
                "target": self._target,
                "result": (
                    {
                        "success": result.success,
                        "interface": result.interface,
                        "ssid": result.ssid,
                        "error": result.error,
                    }
                    if result is not None
                    else None
                ),
            }

    def stop(self, *, timeout: float = 2) -> None:
        worker = self._worker
        if worker is not None:
            worker.join(timeout=timeout)

    def _run(self, request: WifiConnectRequest) -> None:
        try:
            result = self._runner(request)
        except Exception as exc:
            result = WifiConnectResult(
                success=False,
                interface=request.interface,
                ssid=request.ssid,
                error=f"Wi-Fi connection failed: {exc}",
            )
        with self._lock:
            self._result = result
            self._completed_at = _utc_now()
            self._status = "completed" if result.success else "failed"


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
        ("nmcli", "-t", "--escape", "yes", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device", "status"),
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


def connect_wifi(request: WifiConnectRequest) -> WifiConnectResult:
    validation_error = validate_wifi_connect_request(request)
    if validation_error is not None:
        return WifiConnectResult(False, request.interface, request.ssid, validation_error)

    interface = request.interface
    if interface is None:
        status = read_wifi_status(rescan=False)
        interface = status.interface
        if interface is None:
            return WifiConnectResult(False, None, request.ssid, status.error or "No Wi-Fi adapter found")

    command = [
        "nmcli",
        "--wait",
        "35",
        "device",
        "wifi",
        "connect",
        request.ssid,
        "ifname",
        interface,
        "bssid",
        request.bssid,
    ]
    if _wifi_requires_password(request.security):
        command.extend(("password", request.password or ""))

    try:
        result = run_command(tuple(command), timeout_seconds=45)
    except CommandNotFoundError:
        return WifiConnectResult(False, interface, request.ssid, "NetworkManager command 'nmcli' is not installed")
    if result.returncode != 0:
        return WifiConnectResult(
            False,
            interface,
            request.ssid,
            _command_error(result.stderr, "NetworkManager could not activate the selected Wi-Fi network"),
        )
    return WifiConnectResult(True, interface, request.ssid)


def validate_wifi_connect_request(request: WifiConnectRequest) -> str | None:
    if not request.ssid or len(request.ssid.encode("utf-8")) > 32:
        return "Wi-Fi SSID must contain between 1 and 32 bytes"
    if not re.fullmatch(r"(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}", request.bssid):
        return "Wi-Fi BSSID is invalid"
    normalized_security = (request.security or "").upper()
    if "802.1X" in normalized_security or "EAP" in normalized_security:
        return "802.1X Wi-Fi requires an enterprise connection profile"
    if _wifi_requires_password(request.security) and not request.password:
        return "The selected Wi-Fi network requires a password"
    if request.password and ("\n" in request.password or "\r" in request.password):
        return "Wi-Fi password contains an unsupported control character"
    if request.password and len(request.password) > 64:
        return "Wi-Fi password exceeds 64 characters"
    return None


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


def split_escaped_fields(line: str, separator: str = ":") -> tuple[str, ...]:
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


def _wifi_requires_password(security: str | None) -> bool:
    return bool(security and security.strip() not in {"--", "OPEN"})


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


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()
