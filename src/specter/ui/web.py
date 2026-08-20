from __future__ import annotations

import argparse
import copy
import json
import os
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.resources import files
from math import sin
from threading import Condition, Event, Lock
from time import monotonic, sleep
from typing import Callable
from urllib.parse import parse_qs, urlparse

from specter.core.diagnostics import ScanOptions, run_scan
from specter.core.results import DiagnosticsResult
from specter.core.serialization import to_jsonable
from specter.hardware.beeper import PATTERNS, BeeperService
from specter.hardware.bluetooth import BluetoothScannerService
from specter.network.discovery import DEFAULT_REMOTE_HOSTNAME, detect_remote
from specter.network.internet_speed import (
    InternetSpeedOptions,
    InternetSpeedResult,
    InternetSpeedService,
    options_from_environment,
)
from specter.network.wifi import (
    WifiConnectRequest,
    WifiConnectResult,
    WifiConnectionService,
    read_wifi_status,
    set_wifi_radio,
    validate_wifi_connect_request,
)


STATIC_PACKAGE = "specter.ui.web_static"
CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
}


@dataclass
class WebUiOptions:
    remote_host: str = DEFAULT_REMOTE_HOSTNAME
    internet_target: str | None = "1.1.1.1"
    interface: str | None = None
    iperf_seconds: int = 5
    iperf_port: int = 5201
    wifi_interface: str | None = None
    internet_speed_options: InternetSpeedOptions = field(default_factory=InternetSpeedOptions)


@dataclass
class DemoState:
    started_at: float = field(default_factory=monotonic)
    analysis_runs: int = 0
    wifi_enabled: bool = True
    wifi_connection: str | None = "SPECTER LAB"
    bluetooth_scanning: bool = False
    beeper_muted: bool = False

    def payload(self, *, full_analysis: bool) -> dict:
        elapsed = monotonic() - self.started_at
        latency_ms = _demo_latency(elapsed)
        if elapsed < 5:
            state = "no_link"
            link_detected = False
            remote_reachable = False
            throughput_bps = None
            severity = "fail"
        elif elapsed < 10:
            state = "ready"
            link_detected = True
            remote_reachable = False
            throughput_bps = None
            severity = "fail"
        else:
            state = "ready"
            link_detected = True
            remote_reachable = True
            throughput_bps = 936_000_000 if full_analysis else None
            severity = "pass"

        if full_analysis:
            self.analysis_runs += 1
            state = "result"

        return {
            "mode": "demo",
            "ui": {
                "state": state,
                "analysis_runs": self.analysis_runs,
            },
            "scan": {
                "interface": "eth0",
                "link": {
                    "interface": "eth0",
                    "link_detected": link_detected,
                    "speed_mbps": 1000 if link_detected else None,
                    "duplex": "full" if link_detected else None,
                    "autonegotiation": "on" if link_detected else None,
                    "error": None,
                },
                "ip_config": {
                    "interface": "eth0",
                    "addresses": [{"family": "inet", "address": "192.168.2.149/24"}] if link_detected else [],
                    "gateway": "192.168.2.1" if link_detected else None,
                    "dns_servers": ["192.168.2.1"],
                    "dhcp_likely": True,
                    "error": None,
                    "primary_ipv4": "192.168.2.149/24" if link_detected else None,
                },
                "gateway_ping": _demo_ping("192.168.2.1", link_detected, 0.43),
                "remote_ping": _demo_ping("specter-re01.local", remote_reachable, latency_ms),
                "internet_ping": _demo_ping("1.1.1.1", link_detected, 26.9),
                "throughput": _demo_iperf("specter-re01.local", throughput_bps),
                "errors": [],
                "severity": severity,
            },
        }

    def echo_payload(self) -> dict:
        elapsed = monotonic() - self.started_at
        reachable = elapsed >= 10
        return {
            "mode": "demo",
            "echo": {
                "remote_ping": _demo_ping("specter-re01.local", reachable, _demo_latency(elapsed)),
            },
        }

    def wifi_payload(self) -> dict:
        elapsed = monotonic() - self.started_at
        signal = max(1, min(100, round(74 + sin(elapsed * 0.65) * 9)))
        return {
            "wifi": {
                "interface": "wlan0",
                "adapter_available": True,
                "radio_enabled": self.wifi_enabled,
                "device_state": "connected" if self.wifi_enabled and self.wifi_connection else "disconnected" if self.wifi_enabled else "unavailable",
                "connection": self.wifi_connection if self.wifi_enabled else None,
                "scanned_at": _utc_now() if self.wifi_enabled else None,
                "error": None,
                "access_points": (
                    [
                        {
                            "bssid": "02:00:00:00:00:01",
                            "ssid": "SPECTER LAB",
                            "mode": "Infra",
                            "channel": 36,
                            "frequency_mhz": 5180,
                            "signal_percent": signal,
                            "security": "WPA2 WPA3",
                            "in_use": self.wifi_connection == "SPECTER LAB",
                            "band": "5 GHz",
                        },
                        {
                            "bssid": "02:00:00:00:00:02",
                            "ssid": "FIELD-NET",
                            "mode": "Infra",
                            "channel": 6,
                            "frequency_mhz": 2437,
                            "signal_percent": 48,
                            "security": "WPA2",
                            "in_use": self.wifi_connection == "FIELD-NET",
                            "band": "2.4 GHz",
                        },
                    ]
                    if self.wifi_enabled
                    else []
                ),
            }
        }

    def bluetooth_payload(self) -> dict:
        elapsed = monotonic() - self.started_at
        near_signal = round(-58 + sin(elapsed * 1.4) * 7)
        trend = "approaching" if sin(elapsed * 1.4) > 0.35 else "receding" if sin(elapsed * 1.4) < -0.35 else "stable"
        return {
            "bluetooth": {
                "running": self.bluetooth_scanning,
                "adapter": "hci0",
                "error": None,
                "devices": (
                    [
                        {
                            "address": "C0:DE:00:00:00:01",
                            "name": "SPECTER TEST BEACON",
                            "rssi": near_signal,
                            "smoothed_rssi": float(near_signal),
                            "trend": trend,
                            "last_seen": _utc_now(),
                            "age_seconds": 0.1,
                            "manufacturer_ids": [76],
                            "service_uuids": ["180f"],
                        },
                        {
                            "address": "C0:DE:00:00:00:02",
                            "name": "FIELD TAG",
                            "rssi": -81,
                            "smoothed_rssi": -79.4,
                            "trend": "stable",
                            "last_seen": _utc_now(),
                            "age_seconds": 0.6,
                            "manufacturer_ids": [],
                            "service_uuids": [],
                        },
                    ]
                    if self.bluetooth_scanning
                    else []
                ),
            }
        }

    def beeper_payload(self) -> dict:
        return {
            "beeper": {
                "configured": True,
                "available": True,
                "muted": self.beeper_muted,
                "pin": 18,
                "queued_patterns": 0,
                "last_error": None,
            },
            "patterns": sorted(PATTERNS),
        }


def _run_demo_internet_speed(
    options: InternetSpeedOptions,
    cancel_event: Event,
    progress: Callable[[str], None],
) -> InternetSpeedResult:
    phases = ("server_selection", "latency", "download", "upload", "finalizing")
    for index in range(15):
        if cancel_event.is_set():
            return InternetSpeedResult(
                success=False,
                interface=options.interface or "wlan0",
                error_code="cancelled",
                error="Internet speed test cancelled by operator",
            )
        progress(phases[min(len(phases) - 1, index // 3)])
        sleep(0.1)
    return InternetSpeedResult(
        success=True,
        interface=options.interface or "wlan0",
        server_name="SPECTER DEMO BACKEND",
        server_url="https://speed.example.invalid/",
        download_mbps=286.42,
        upload_mbps=47.18,
        ping_ms=18.73,
        jitter_ms=1.26,
        bytes_sent=70_770_000,
        bytes_received=429_630_000,
        client_ip="192.0.2.10",
    )


def _run_demo_wifi_connect(state: DemoState, request: WifiConnectRequest) -> WifiConnectResult:
    sleep(0.8)
    state.wifi_connection = request.ssid
    return WifiConnectResult(True, request.interface or "wlan0", request.ssid)


class ScanCoordinator:
    """Serialize scans and let concurrent callers share a compatible result."""

    def __init__(self, build_payload: Callable[[bool], dict]) -> None:
        self._build_payload = build_payload
        self._condition = Condition()
        self._active = False
        self._active_request: dict | None = None
        self._completed_generation = 0
        self._latest_full_analysis = False
        self._latest_payload: dict | None = None
        self._next_scan_id = 1

    def run(self, *, full_analysis: bool) -> dict:
        with self._condition:
            observed_generation = self._completed_generation
            while self._active:
                self._condition.wait()
                if self._completed_generation > observed_generation and (
                    self._latest_full_analysis or not full_analysis
                ):
                    return copy.deepcopy(self._latest_payload)

            scan_id = self._next_scan_id
            self._next_scan_id += 1
            started_at = _utc_now()
            self._active = True
            self._active_request = {
                "scan_id": scan_id,
                "status": "running",
                "full_analysis": full_analysis,
                "started_at": started_at,
                "completed_at": None,
            }

        try:
            payload = self._build_payload(full_analysis)
        except Exception:
            with self._condition:
                self._active = False
                self._active_request = None
                self._condition.notify_all()
            raise

        request = {
            "scan_id": scan_id,
            "status": "completed",
            "full_analysis": full_analysis,
            "started_at": started_at,
            "completed_at": _utc_now(),
        }
        payload = copy.deepcopy(payload)
        payload["request"] = request

        with self._condition:
            self._completed_generation += 1
            self._latest_full_analysis = full_analysis
            self._latest_payload = copy.deepcopy(payload)
            self._active = False
            self._active_request = None
            self._condition.notify_all()
        return payload

    def snapshot(self, *, mode: str) -> dict:
        with self._condition:
            if self._latest_payload is None:
                return {
                    "mode": mode,
                    "ui": {"state": "boot"},
                    "scan": None,
                    "request": copy.deepcopy(self._active_request)
                    or {
                        "scan_id": None,
                        "status": "idle",
                        "full_analysis": False,
                        "started_at": None,
                        "completed_at": None,
                    },
                }

            payload = copy.deepcopy(self._latest_payload)
            if self._active_request is not None:
                payload["request"] = copy.deepcopy(self._active_request)
            return payload

    @property
    def active(self) -> bool:
        with self._condition:
            return self._active


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


def _demo_latency(elapsed: float) -> float:
    return round(0.48 + sin(elapsed * 1.7) * 0.08 + sin(elapsed * 0.43) * 0.05, 3)


def _demo_ping(target: str, reachable: bool, latency_ms: float) -> dict:
    return {
        "target": target,
        "reachable": reachable,
        "transmitted": 2,
        "received": 2 if reachable else 0,
        "packet_loss_percent": 0.0 if reachable else 100.0,
        "min_latency_ms": latency_ms,
        "avg_latency_ms": latency_ms,
        "max_latency_ms": latency_ms + 0.08,
        "error": None if reachable else "demo target unreachable",
    }


def _demo_iperf(target: str, bits_per_second: int | None) -> dict | None:
    if bits_per_second is None:
        return None
    return {
        "target": target,
        "success": True,
        "bits_per_second": bits_per_second,
        "retransmits": 0,
        "seconds": 5.0,
        "reverse": False,
        "error": None,
        "mbps": bits_per_second / 1_000_000,
    }


def _optional_env_int(name: str) -> int | None:
    value = os.getenv(name)
    if value is None or not value.strip():
        return None
    try:
        return int(value)
    except ValueError:
        return None


def _env_flag(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="specter-ui", description="Run the local SPECTER HDMI web UI")
    parser.add_argument("--host", default="127.0.0.1", help="address to listen on")
    parser.add_argument("--port", type=int, default=8765, help="port to listen on")
    parser.add_argument("--demo", action="store_true", help="use simulated scan data")
    parser.add_argument(
        "--beeper-pin",
        type=int,
        default=_optional_env_int("SPECTER_BEEPER_PIN"),
        help="BCM GPIO pin for a passive piezo beeper",
    )
    parser.add_argument(
        "--mute",
        action="store_true",
        default=_env_flag("SPECTER_BEEPER_MUTED"),
        help="start with acoustic signals muted",
    )
    args = parser.parse_args(argv)
    return serve(host=args.host, port=args.port, demo=args.demo, beeper_pin=args.beeper_pin, mute=args.mute)


def serve(
    *,
    host: str = "127.0.0.1",
    port: int = 8765,
    demo: bool = False,
    beeper_pin: int | None = None,
    mute: bool = False,
    internet_speed_options: InternetSpeedOptions | None = None,
) -> int:
    options = WebUiOptions(internet_speed_options=internet_speed_options or options_from_environment())
    demo_state = DemoState()
    bluetooth_scanner = BluetoothScannerService()
    beeper = BeeperService(pin=beeper_pin, muted=mute)
    internet_speed_service = InternetSpeedService(
        options.internet_speed_options,
        runner=_run_demo_internet_speed if demo else None,
    )
    wifi_connection_service = WifiConnectionService(
        runner=(lambda request: _run_demo_wifi_connect(demo_state, request)) if demo else None,
    )
    if beeper_pin is not None:
        beeper.trigger("boot")
    handler = build_handler(
        options=options,
        demo=demo,
        demo_state=demo_state,
        bluetooth_scanner=bluetooth_scanner,
        beeper=beeper,
        internet_speed_service=internet_speed_service,
        wifi_connection_service=wifi_connection_service,
    )
    server = ThreadingHTTPServer((host, port), handler)
    print(f"SPECTER UI listening on http://{host}:{port}")
    if demo:
        print("Demo mode active")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("")
        return 0
    finally:
        bluetooth_scanner.stop()
        beeper.stop()
        internet_speed_service.stop()
        wifi_connection_service.stop()
        server.server_close()
    return 0


def build_handler(
    *,
    options: WebUiOptions,
    demo: bool,
    demo_state: DemoState,
    scan_coordinator: ScanCoordinator | None = None,
    bluetooth_scanner: BluetoothScannerService | None = None,
    beeper: BeeperService | None = None,
    internet_speed_service: InternetSpeedService | None = None,
    wifi_connection_service: WifiConnectionService | None = None,
) -> type[BaseHTTPRequestHandler]:
    coordinator = scan_coordinator or ScanCoordinator(
        lambda full_analysis: build_scan_payload(
            options=options,
            demo=demo,
            demo_state=demo_state,
            full_analysis=full_analysis,
        )
    )
    wifi_lock = Lock()
    ble_scanner = bluetooth_scanner or BluetoothScannerService()
    beeper_service = beeper or BeeperService(pin=None)
    speed_service = internet_speed_service or InternetSpeedService(
        options.internet_speed_options,
        runner=_run_demo_internet_speed if demo else None,
    )
    wifi_service = wifi_connection_service or WifiConnectionService(
        runner=(lambda request: _run_demo_wifi_connect(demo_state, request)) if demo else None,
    )

    class SpecterRequestHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            parsed = urlparse(self.path)
            if parsed.path in {"", "/"}:
                self._serve_static("index.html")
                return
            if parsed.path == "/api/scan":
                self._send_json(coordinator.snapshot(mode="demo" if demo else "live"))
                return
            if parsed.path == "/api/echo":
                self._send_json(build_echo_payload(options=options, demo=demo, demo_state=demo_state))
                return
            if parsed.path == "/api/wifi":
                if demo:
                    self._send_json(demo_state.wifi_payload())
                else:
                    with wifi_lock:
                        status = read_wifi_status(interface=options.wifi_interface, rescan=False)
                    self._send_json({"wifi": to_jsonable(status)})
                return
            if parsed.path == "/api/wifi/connection":
                self._send_json(wifi_service.snapshot())
                return
            if parsed.path == "/api/bluetooth":
                payload = demo_state.bluetooth_payload() if demo else {"bluetooth": to_jsonable(ble_scanner.snapshot())}
                self._send_json(payload)
                return
            if parsed.path == "/api/beeper":
                payload = demo_state.beeper_payload() if demo else {
                    "beeper": to_jsonable(beeper_service.status()),
                    "patterns": sorted(PATTERNS),
                }
                self._send_json(payload)
                return
            if parsed.path == "/api/internet-speed":
                self._send_json(speed_service.snapshot())
                return
            if parsed.path.startswith("/static/"):
                self._serve_static(parsed.path.removeprefix("/static/"))
                return
            self.send_error(HTTPStatus.NOT_FOUND)

        def do_POST(self) -> None:
            parsed = urlparse(self.path)
            if parsed.path == "/api/internet-speed":
                started = speed_service.start()
                self._send_json(
                    speed_service.snapshot(),
                    status=HTTPStatus.ACCEPTED if started else HTTPStatus.CONFLICT,
                )
                return
            if parsed.path == "/api/wifi/scan":
                if demo:
                    self._send_json(demo_state.wifi_payload())
                else:
                    with wifi_lock:
                        status = read_wifi_status(interface=options.wifi_interface, rescan=True)
                    self._send_json({"wifi": to_jsonable(status)})
                return
            if parsed.path == "/api/wifi/radio":
                request = self._read_json()
                if request is None or not isinstance(request.get("enabled"), bool):
                    self._send_json(
                        {"error": "Expected JSON object with boolean 'enabled'"},
                        status=HTTPStatus.BAD_REQUEST,
                    )
                    return
                if demo:
                    demo_state.wifi_enabled = request["enabled"]
                    self._send_json(demo_state.wifi_payload())
                else:
                    with wifi_lock:
                        change_error = set_wifi_radio(request["enabled"])
                        status = read_wifi_status(interface=options.wifi_interface, rescan=False)
                    response_status = HTTPStatus.OK if change_error is None else HTTPStatus.CONFLICT
                    self._send_json(
                        {"wifi": to_jsonable(status), "error": change_error},
                        status=response_status,
                    )
                return
            if parsed.path == "/api/wifi/connect":
                request = self._read_json()
                if request is None:
                    self._send_json({"error": "Expected Wi-Fi connection parameters"}, status=HTTPStatus.BAD_REQUEST)
                    return
                ssid = request.get("ssid")
                bssid = request.get("bssid")
                security = request.get("security")
                password = request.get("password")
                if not isinstance(ssid, str) or not isinstance(bssid, str):
                    self._send_json({"error": "Wi-Fi SSID and BSSID are required"}, status=HTTPStatus.BAD_REQUEST)
                    return
                if security is not None and not isinstance(security, str):
                    self._send_json({"error": "Wi-Fi security must be a string"}, status=HTTPStatus.BAD_REQUEST)
                    return
                if password is not None and not isinstance(password, str):
                    self._send_json({"error": "Wi-Fi password must be a string"}, status=HTTPStatus.BAD_REQUEST)
                    return
                connection_request = WifiConnectRequest(
                    ssid=ssid,
                    bssid=bssid,
                    security=security,
                    password=password,
                    interface=options.wifi_interface,
                )
                validation_error = validate_wifi_connect_request(connection_request)
                if validation_error is not None:
                    self._send_json({"error": validation_error}, status=HTTPStatus.BAD_REQUEST)
                    return
                started = wifi_service.start(connection_request)
                self._send_json(
                    wifi_service.snapshot(),
                    status=HTTPStatus.ACCEPTED if started else HTTPStatus.CONFLICT,
                )
                return
            if parsed.path == "/api/bluetooth/scan":
                request = self._read_json()
                if request is None or not isinstance(request.get("enabled"), bool):
                    self._send_json(
                        {"error": "Expected JSON object with boolean 'enabled'"},
                        status=HTTPStatus.BAD_REQUEST,
                    )
                    return
                if demo:
                    demo_state.bluetooth_scanning = request["enabled"]
                    self._send_json(demo_state.bluetooth_payload())
                else:
                    status = ble_scanner.start() if request["enabled"] else ble_scanner.stop()
                    self._send_json({"bluetooth": to_jsonable(status)})
                return
            if parsed.path == "/api/beeper/trigger":
                request = self._read_json()
                pattern = request.get("pattern") if request else None
                if not isinstance(pattern, str) or pattern not in PATTERNS:
                    self._send_json(
                        {"error": "Unknown or missing beeper pattern"},
                        status=HTTPStatus.BAD_REQUEST,
                    )
                    return
                if demo:
                    self._send_json(demo_state.beeper_payload())
                else:
                    status = beeper_service.trigger(pattern)
                    response_status = HTTPStatus.OK if status.available else HTTPStatus.CONFLICT
                    self._send_json(
                        {"beeper": to_jsonable(status), "patterns": sorted(PATTERNS)},
                        status=response_status,
                    )
                return
            if parsed.path == "/api/beeper/mute":
                request = self._read_json()
                if request is None or not isinstance(request.get("muted"), bool):
                    self._send_json(
                        {"error": "Expected JSON object with boolean 'muted'"},
                        status=HTTPStatus.BAD_REQUEST,
                    )
                    return
                if demo:
                    demo_state.beeper_muted = request["muted"]
                    self._send_json(demo_state.beeper_payload())
                else:
                    status = beeper_service.set_muted(request["muted"])
                    self._send_json({"beeper": to_jsonable(status), "patterns": sorted(PATTERNS)})
                return
            if parsed.path != "/api/scan":
                self.send_error(HTTPStatus.NOT_FOUND)
                return

            query = parse_qs(parsed.query)
            full_analysis = query.get("full", ["0"])[0] == "1"
            if full_analysis:
                current = coordinator.snapshot(mode="demo" if demo else "live")
                remote_ping = (current.get("scan") or {}).get("remote_ping") or {}
                if remote_ping.get("reachable") is not True:
                    self._send_json(
                        {
                            "mode": "demo" if demo else "live",
                            "ui": {"state": "entity_not_found"},
                            "scan": current.get("scan"),
                            "request": {"status": "blocked", "full_analysis": True},
                            "error": "Remote entity must be acquired before full analysis",
                            "code": "R-031",
                        },
                        status=HTTPStatus.CONFLICT,
                    )
                    return
            try:
                payload = coordinator.run(full_analysis=full_analysis)
            except Exception as exc:
                self._send_json(
                    {
                        "mode": "demo" if demo else "live",
                        "ui": {"state": "system_error"},
                        "scan": None,
                        "request": {"status": "failed", "full_analysis": full_analysis},
                        "error": str(exc),
                    },
                    status=HTTPStatus.INTERNAL_SERVER_ERROR,
                )
                return
            self._send_json(payload)

        def do_DELETE(self) -> None:
            parsed = urlparse(self.path)
            if parsed.path != "/api/internet-speed":
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            cancelled = speed_service.cancel()
            self._send_json(
                speed_service.snapshot(),
                status=HTTPStatus.ACCEPTED if cancelled else HTTPStatus.CONFLICT,
            )

        def _read_json(self) -> dict | None:
            try:
                content_length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                return None
            if content_length <= 0 or content_length > 4096:
                return None
            try:
                payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                return None
            return payload if isinstance(payload, dict) else None

        def log_message(self, format: str, *args: object) -> None:
            return

        def _send_json(self, payload: dict, *, status: HTTPStatus = HTTPStatus.OK) -> None:
            body = json.dumps(payload, indent=2, sort_keys=True).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _serve_static(self, name: str) -> None:
            if "/" in name or "\\" in name:
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            resource = files(STATIC_PACKAGE).joinpath(name)
            if not resource.is_file():
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            suffix = "." + name.rsplit(".", 1)[-1] if "." in name else ""
            body = resource.read_bytes()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", CONTENT_TYPES.get(suffix, "application/octet-stream"))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    return SpecterRequestHandler


def build_scan_payload(
    *,
    options: WebUiOptions,
    demo: bool,
    demo_state: DemoState | None = None,
    full_analysis: bool = False,
) -> dict:
    if demo:
        state = demo_state or DemoState()
        return state.payload(full_analysis=full_analysis)

    result = run_scan(
        ScanOptions(
            interface=options.interface,
            remote_host=options.remote_host,
            internet_target=options.internet_target,
            skip_iperf=not full_analysis,
            iperf_seconds=options.iperf_seconds,
            iperf_port=options.iperf_port,
        )
    )
    return {
        "mode": "live",
        "ui": {
            "state": infer_ui_state(result, full_analysis=full_analysis),
        },
        "scan": to_jsonable(result),
    }


def build_echo_payload(
    *,
    options: WebUiOptions,
    demo: bool,
    demo_state: DemoState | None = None,
) -> dict:
    if demo:
        state = demo_state or DemoState()
        return state.echo_payload()

    return {
        "mode": "live",
        "echo": {
            "remote_ping": to_jsonable(detect_remote(options.remote_host, count=1)),
        },
    }


def infer_ui_state(result: DiagnosticsResult, *, full_analysis: bool) -> str:
    if result.interface is None:
        return "system_error"
    if result.link is None or result.link.link_detected is False:
        return "no_link"
    if result.ip_config and result.ip_config.primary_ipv4 is None:
        return "no_dhcp"
    if result.remote_ping and not result.remote_ping.reachable:
        return "entity_not_found"
    if full_analysis:
        return "result"
    return "ready"


if __name__ == "__main__":
    raise SystemExit(main())
