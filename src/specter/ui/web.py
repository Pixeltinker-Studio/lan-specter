from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from dataclasses import dataclass, field
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.resources import files
from time import monotonic
from urllib.parse import parse_qs, urlparse

from specter.core.diagnostics import ScanOptions, run_scan
from specter.core.results import DiagnosticsResult
from specter.core.serialization import to_jsonable
from specter.network.discovery import DEFAULT_REMOTE_HOSTNAME


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


@dataclass
class DemoState:
    started_at: float = field(default_factory=monotonic)
    analysis_runs: int = 0

    def payload(self, *, full_analysis: bool) -> dict:
        elapsed = monotonic() - self.started_at
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
                "remote_ping": _demo_ping("specter-re01.local", remote_reachable, 0.41),
                "internet_ping": _demo_ping("1.1.1.1", link_detected, 26.9),
                "throughput": _demo_iperf("specter-re01.local", throughput_bps),
                "errors": [],
                "severity": severity,
            },
        }


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


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="specter-ui", description="Run the local SPECTER HDMI web UI")
    parser.add_argument("--host", default="127.0.0.1", help="address to listen on")
    parser.add_argument("--port", type=int, default=8765, help="port to listen on")
    parser.add_argument("--demo", action="store_true", help="use simulated scan data")
    args = parser.parse_args(argv)
    return serve(host=args.host, port=args.port, demo=args.demo)


def serve(*, host: str = "127.0.0.1", port: int = 8765, demo: bool = False) -> int:
    options = WebUiOptions()
    demo_state = DemoState()
    handler = build_handler(options=options, demo=demo, demo_state=demo_state)
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
        server.server_close()
    return 0


def build_handler(*, options: WebUiOptions, demo: bool, demo_state: DemoState) -> type[BaseHTTPRequestHandler]:
    class SpecterRequestHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            parsed = urlparse(self.path)
            if parsed.path in {"", "/"}:
                self._serve_static("index.html")
                return
            if parsed.path == "/api/scan":
                query = parse_qs(parsed.query)
                full_analysis = query.get("full", ["0"])[0] == "1"
                self._send_json(build_scan_payload(options=options, demo=demo, demo_state=demo_state, full_analysis=full_analysis))
                return
            if parsed.path.startswith("/static/"):
                self._serve_static(parsed.path.removeprefix("/static/"))
                return
            self.send_error(HTTPStatus.NOT_FOUND)

        def log_message(self, format: str, *args: object) -> None:
            return

        def _send_json(self, payload: dict) -> None:
            body = json.dumps(payload, indent=2, sort_keys=True).encode("utf-8")
            self.send_response(HTTPStatus.OK)
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
