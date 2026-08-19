from __future__ import annotations

import json

from specter.core.results import IperfResult
from specter.network.commands import CommandNotFoundError, run_command


def parse_iperf3_json(target: str, payload: str, *, reverse: bool = False) -> IperfResult:
    try:
        data = json.loads(payload)
    except json.JSONDecodeError as exc:
        return IperfResult(target=target, success=False, reverse=reverse, error=f"Invalid iperf3 JSON: {exc}")

    if error := data.get("error"):
        return IperfResult(target=target, success=False, reverse=reverse, error=str(error))

    end = data.get("end", {})
    summary = _select_summary(end, reverse=reverse)
    bits_per_second = summary.get("bits_per_second")
    retransmits = summary.get("retransmits")
    seconds = summary.get("seconds")

    if bits_per_second is None:
        return IperfResult(target=target, success=False, reverse=reverse, error="iperf3 result did not include throughput")

    return IperfResult(
        target=target,
        success=True,
        bits_per_second=float(bits_per_second),
        retransmits=int(retransmits) if retransmits is not None else None,
        seconds=float(seconds) if seconds is not None else None,
        reverse=reverse,
    )


def _select_summary(end: dict, *, reverse: bool) -> dict:
    if reverse:
        return end.get("sum_received") or end.get("sum") or {}
    return end.get("sum_sent") or end.get("sum") or {}


def run_iperf_client(
    target: str,
    *,
    seconds: int = 5,
    port: int = 5201,
    parallel: int = 1,
    reverse: bool = False,
) -> IperfResult:
    command = [
        "iperf3",
        "-c",
        target,
        "-p",
        str(port),
        "-t",
        str(seconds),
        "-P",
        str(parallel),
        "-J",
    ]
    if reverse:
        command.append("-R")

    try:
        result = run_command(command, timeout_seconds=seconds + 10)
    except CommandNotFoundError as exc:
        return IperfResult(target=target, success=False, reverse=reverse, error=str(exc))

    if result.returncode != 0 and not result.stdout.strip():
        error = result.stderr.strip() or "iperf3 failed"
        return IperfResult(target=target, success=False, reverse=reverse, error=error)

    parsed = parse_iperf3_json(target, result.stdout, reverse=reverse)
    if not parsed.success and result.stderr.strip() and not parsed.error:
        return IperfResult(target=target, success=False, reverse=reverse, error=result.stderr.strip())
    return parsed
