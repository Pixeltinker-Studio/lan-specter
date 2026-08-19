from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class Severity(str, Enum):
    PASS = "pass"
    WARN = "warn"
    FAIL = "fail"
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class CommandResult:
    command: tuple[str, ...]
    returncode: int
    stdout: str
    stderr: str


@dataclass(frozen=True)
class LinkResult:
    interface: str
    link_detected: bool | None
    speed_mbps: int | None
    duplex: str | None
    autonegotiation: str | None = None
    error: str | None = None

    @property
    def severity(self) -> Severity:
        if self.error:
            return Severity.UNKNOWN
        if self.link_detected is False:
            return Severity.FAIL
        if self.link_detected is None:
            return Severity.UNKNOWN
        if self.speed_mbps is not None and self.speed_mbps < 1000:
            return Severity.WARN
        return Severity.PASS


@dataclass(frozen=True)
class Address:
    family: str
    address: str


@dataclass(frozen=True)
class IpConfigResult:
    interface: str
    addresses: tuple[Address, ...] = ()
    gateway: str | None = None
    dns_servers: tuple[str, ...] = ()
    dhcp_likely: bool | None = None
    error: str | None = None

    @property
    def primary_ipv4(self) -> str | None:
        for address in self.addresses:
            if address.family == "inet":
                return address.address
        return None


@dataclass(frozen=True)
class PingResult:
    target: str
    reachable: bool
    transmitted: int | None = None
    received: int | None = None
    packet_loss_percent: float | None = None
    min_latency_ms: float | None = None
    avg_latency_ms: float | None = None
    max_latency_ms: float | None = None
    error: str | None = None

    @property
    def severity(self) -> Severity:
        if self.reachable:
            if self.packet_loss_percent and self.packet_loss_percent > 0:
                return Severity.WARN
            return Severity.PASS
        return Severity.FAIL


@dataclass(frozen=True)
class IperfResult:
    target: str
    success: bool
    bits_per_second: float | None = None
    retransmits: int | None = None
    seconds: float | None = None
    reverse: bool = False
    error: str | None = None

    @property
    def mbps(self) -> float | None:
        if self.bits_per_second is None:
            return None
        return self.bits_per_second / 1_000_000

    @property
    def severity(self) -> Severity:
        if not self.success:
            return Severity.FAIL
        if self.mbps is not None and self.mbps < 100:
            return Severity.WARN
        return Severity.PASS


@dataclass(frozen=True)
class DiagnosticsResult:
    interface: str | None
    link: LinkResult | None = None
    ip_config: IpConfigResult | None = None
    gateway_ping: PingResult | None = None
    remote_ping: PingResult | None = None
    internet_ping: PingResult | None = None
    throughput: IperfResult | None = None
    errors: tuple[str, ...] = field(default_factory=tuple)

    @property
    def severity(self) -> Severity:
        if self.errors or self.interface is None:
            return Severity.FAIL

        severities = [
            result.severity
            for result in (
                self.link,
                self.gateway_ping,
                self.remote_ping,
                self.internet_ping,
                self.throughput,
            )
            if result is not None
        ]
        if Severity.FAIL in severities:
            return Severity.FAIL
        if Severity.WARN in severities:
            return Severity.WARN
        if Severity.UNKNOWN in severities:
            return Severity.UNKNOWN
        return Severity.PASS
