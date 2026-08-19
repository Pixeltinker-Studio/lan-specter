from __future__ import annotations

from dataclasses import dataclass

from specter.core.results import DiagnosticsResult
from specter.network.discovery import DEFAULT_REMOTE_HOSTNAME, detect_remote
from specter.network.interface import choose_interface
from specter.network.ip_config import read_ip_config
from specter.network.iperf import run_iperf_client
from specter.network.link import read_link
from specter.network.ping import ping


@dataclass(frozen=True)
class ScanOptions:
    interface: str | None = None
    remote_host: str = DEFAULT_REMOTE_HOSTNAME
    internet_target: str | None = "1.1.1.1"
    skip_iperf: bool = False
    iperf_seconds: int = 5
    iperf_port: int = 5201


def run_scan(options: ScanOptions | None = None) -> DiagnosticsResult:
    options = options or ScanOptions()
    interface = choose_interface(options.interface)
    if interface is None:
        return DiagnosticsResult(interface=None, errors=("No network interface found",))

    link = read_link(interface)
    ip_config = read_ip_config(interface)

    gateway_ping = ping(ip_config.gateway, count=2) if ip_config.gateway else None
    remote_ping = detect_remote(options.remote_host, count=2) if options.remote_host else None
    internet_ping = ping(options.internet_target, count=2) if options.internet_target else None

    throughput = None
    if not options.skip_iperf and remote_ping and remote_ping.reachable:
        throughput = run_iperf_client(
            remote_ping.target,
            seconds=options.iperf_seconds,
            port=options.iperf_port,
        )

    return DiagnosticsResult(
        interface=interface,
        link=link,
        ip_config=ip_config,
        gateway_ping=gateway_ping,
        remote_ping=remote_ping,
        internet_ping=internet_ping,
        throughput=throughput,
    )
