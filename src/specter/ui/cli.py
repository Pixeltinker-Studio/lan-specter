from __future__ import annotations

import argparse
from collections.abc import Sequence

from specter.core.diagnostics import ScanOptions, run_scan
from specter.core.results import DiagnosticsResult, IperfResult, PingResult, Severity


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "scan":
        options = ScanOptions(
            interface=args.interface,
            remote_host=args.remote,
            internet_target=None if args.no_internet else args.internet_target,
            skip_iperf=args.no_iperf,
            iperf_seconds=args.iperf_seconds,
            iperf_port=args.iperf_port,
        )
        result = run_scan(options)
        print(format_scan(result))
        return 0 if result.severity in {Severity.PASS, Severity.WARN, Severity.UNKNOWN} else 2

    parser.print_help()
    return 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="specter", description="SPECTER LAN diagnostic CLI")
    subparsers = parser.add_subparsers(dest="command")

    scan = subparsers.add_parser("scan", help="run the MVP LAN diagnostic scan")
    scan.add_argument("-i", "--interface", help="network interface to test, for example eth0")
    scan.add_argument("--remote", default="specter-re01", help="remote RE-01 hostname or address")
    scan.add_argument("--internet-target", default="1.1.1.1", help="internet connectivity ping target")
    scan.add_argument("--no-internet", action="store_true", help="skip internet ping")
    scan.add_argument("--no-iperf", action="store_true", help="skip iperf3 throughput test")
    scan.add_argument("--iperf-seconds", type=int, default=5, help="iperf3 test duration")
    scan.add_argument("--iperf-port", type=int, default=5201, help="iperf3 server port")

    return parser


def format_scan(result: DiagnosticsResult) -> str:
    lines = [
        "SPECTER ES-01",
        "Portable Ethernetic Spectrometer",
        "",
    ]

    if result.interface is None:
        lines.append("Interface       NOT FOUND")
        lines.extend(f"Error           {error}" for error in result.errors)
        return "\n".join(lines)

    lines.append(f"Interface       {result.interface}")

    if result.link:
        link_text = "UP" if result.link.link_detected else "DOWN" if result.link.link_detected is False else "UNKNOWN"
        speed = f"{result.link.speed_mbps} Mbps" if result.link.speed_mbps else "unknown"
        duplex = result.link.duplex or "unknown"
        lines.append(f"Link            {link_text}")
        lines.append(f"Speed           {speed}")
        lines.append(f"Duplex          {duplex}")
        if result.link.error:
            lines.append(f"Link Error      {result.link.error}")

    if result.ip_config:
        address = result.ip_config.primary_ipv4 or "not assigned"
        lines.append(f"Address         {address}")
        lines.append(f"Gateway         {result.ip_config.gateway or 'not found'}")
        if result.ip_config.dns_servers:
            lines.append(f"DNS             {', '.join(result.ip_config.dns_servers)}")

    if result.gateway_ping:
        lines.append(f"Gateway Echo    {_format_ping(result.gateway_ping)}")

    if result.remote_ping:
        entity = "FOUND" if result.remote_ping.reachable else "NOT FOUND"
        lines.append(f"Remote Entity   {entity}")
        lines.append(f"Remote Echo     {_format_ping(result.remote_ping)}")

    if result.internet_ping:
        lines.append(f"Internet Echo   {_format_ping(result.internet_ping)}")

    if result.throughput:
        lines.append(f"Throughput      {_format_iperf(result.throughput)}")

    lines.append("")
    lines.append(f"Status          {_format_status(result.severity)}")
    return "\n".join(lines)


def _format_ping(result: PingResult) -> str:
    if not result.reachable:
        return "unreachable"

    latency = f"{result.avg_latency_ms:.2f} ms" if result.avg_latency_ms is not None else "latency unknown"
    loss = f"{result.packet_loss_percent:.2f} %" if result.packet_loss_percent is not None else "loss unknown"
    return f"{latency}, loss {loss}"


def _format_iperf(result: IperfResult) -> str:
    if not result.success:
        return f"failed ({result.error})" if result.error else "failed"
    value = f"{result.mbps:.0f} Mbps" if result.mbps is not None else "unknown"
    if result.retransmits is not None:
        return f"{value}, retransmits {result.retransmits}"
    return value


def _format_status(severity: Severity) -> str:
    if severity == Severity.PASS:
        return "STABLE"
    if severity == Severity.WARN:
        return "ANOMALY"
    if severity == Severity.FAIL:
        return "UNSTABLE"
    return "UNKNOWN"


if __name__ == "__main__":
    raise SystemExit(main())
