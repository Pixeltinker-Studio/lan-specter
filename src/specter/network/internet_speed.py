from __future__ import annotations

import json
import os
import subprocess
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from math import isfinite
from threading import Event, Lock, Thread
from time import monotonic, sleep
from typing import Any

from specter.network.interface import choose_internet_interface


@dataclass(frozen=True)
class InternetSpeedOptions:
    binary: str = "librespeed-cli"
    interface: str | None = None
    server_json: str | None = None
    local_json: str | None = None
    server_id: int | None = None
    duration_seconds: int = 10
    http_timeout_seconds: int = 15
    process_timeout_seconds: int = 60
    secure: bool = True


@dataclass(frozen=True)
class InternetSpeedResult:
    success: bool
    interface: str | None
    server_name: str | None = None
    server_url: str | None = None
    download_mbps: float | None = None
    upload_mbps: float | None = None
    ping_ms: float | None = None
    jitter_ms: float | None = None
    bytes_sent: int | None = None
    bytes_received: int | None = None
    client_ip: str | None = None
    error_code: str | None = None
    error: str | None = None


InternetSpeedProgress = Callable[[str], None]
InternetSpeedRunner = Callable[[InternetSpeedOptions, Event, InternetSpeedProgress], InternetSpeedResult]


class InternetSpeedService:
    """Run one operator-requested LibreSpeed process without blocking the web UI."""

    def __init__(
        self,
        options: InternetSpeedOptions | None = None,
        *,
        runner: InternetSpeedRunner | None = None,
    ) -> None:
        self.options = options or InternetSpeedOptions()
        self._runner = runner or run_librespeed
        self._lock = Lock()
        self._cancel_event = Event()
        self._worker: Thread | None = None
        self._status = "idle"
        self._started_at: str | None = None
        self._completed_at: str | None = None
        self._phase: str | None = None
        self._phase_started_at: str | None = None
        self._result: InternetSpeedResult | None = None

    def start(self) -> bool:
        with self._lock:
            if self._worker is not None and self._worker.is_alive():
                return False
            self._cancel_event = Event()
            self._status = "running"
            self._started_at = _utc_now()
            self._completed_at = None
            self._phase = "server_selection"
            self._phase_started_at = self._started_at
            self._result = None
            self._worker = Thread(target=self._run, name="specter-internet-speed", daemon=True)
            self._worker.start()
            return True

    def cancel(self) -> bool:
        with self._lock:
            if self._status not in {"running", "cancelling"}:
                return False
            self._status = "cancelling"
            self._cancel_event.set()
            return True

    def stop(self, *, timeout: float = 3) -> None:
        self.cancel()
        worker = self._worker
        if worker is not None:
            worker.join(timeout=timeout)

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "request": {
                    "status": self._status,
                    "started_at": self._started_at,
                    "completed_at": self._completed_at,
                    "phase": self._phase,
                    "phase_started_at": self._phase_started_at,
                },
                "configuration": self._configuration(),
                "result": _result_dict(self._result),
            }

    def _run(self) -> None:
        try:
            result = self._runner(self.options, self._cancel_event, self._set_phase)
        except Exception as exc:
            result = _failure(self.options.interface, "internal_error", f"Internet speed test failed: {exc}")

        with self._lock:
            self._result = result
            self._completed_at = _utc_now()
            if result.success:
                self._status = "completed"
                self._phase = "complete"
            elif result.error_code == "cancelled":
                self._status = "cancelled"
            else:
                self._status = "failed"

    def _set_phase(self, phase: str) -> None:
        if phase not in {"server_selection", "latency", "download", "upload", "finalizing"}:
            return
        with self._lock:
            if self._status not in {"running", "cancelling"} or self._phase == phase:
                return
            self._phase = phase
            self._phase_started_at = _utc_now()

    def _configuration(self) -> dict:
        backend = self.options.server_json or self.options.local_json or "LibreSpeed.org public server pool"
        duration = max(1, self.options.duration_seconds)
        return {
            "backend": backend,
            "public_backend": not bool(self.options.server_json or self.options.local_json),
            "interface": self.options.interface,
            "duration_seconds": duration,
            "process_timeout_seconds": max(1, self.options.process_timeout_seconds),
            "data_usage": (
                "Variable; download and upload run at available connection capacity "
                f"for {duration} seconds each"
            ),
            "telemetry": "disabled",
        }


def parse_librespeed_json(payload: str, *, interface: str | None) -> InternetSpeedResult:
    try:
        data = json.loads(payload)
    except json.JSONDecodeError as exc:
        return _failure(interface, "invalid_output", f"Invalid LibreSpeed JSON: {exc}")

    # LibreSpeed v1.0.14 always emits a JSON array because the CLI supports
    # testing multiple servers in one run. SPECTER requests one server, so a
    # successful response contains exactly one result object. Older releases
    # emitted that object directly; retain support for both formats.
    if isinstance(data, list):
        if not data:
            return _failure(interface, "invalid_output", "LibreSpeed returned no measurement result")
        if len(data) != 1:
            return _failure(interface, "invalid_output", "LibreSpeed returned multiple measurement results")
        data = data[0]

    if not isinstance(data, dict):
        return _failure(interface, "invalid_output", "LibreSpeed result must be a JSON object")

    required = ("download", "upload", "ping", "jitter")
    missing = [name for name in required if not _is_number(data.get(name))]
    if missing:
        return _failure(
            interface,
            "invalid_output",
            f"LibreSpeed result is missing numeric fields: {', '.join(missing)}",
        )

    values = {name: float(data[name]) for name in required}
    if any(value < 0 for value in values.values()):
        return _failure(interface, "invalid_output", "LibreSpeed result contains negative measurements")

    server = data.get("server") if isinstance(data.get("server"), dict) else {}
    server_name = _optional_string(server.get("name"))
    server_url = _optional_string(server.get("url") or server.get("server"))
    if server_name is None and server_url is None:
        return _failure(interface, "invalid_output", "LibreSpeed result is missing the measurement server")
    client = data.get("client") if isinstance(data.get("client"), dict) else {}
    return InternetSpeedResult(
        success=True,
        interface=interface,
        server_name=server_name,
        server_url=server_url,
        download_mbps=values["download"],
        upload_mbps=values["upload"],
        ping_ms=values["ping"],
        jitter_ms=values["jitter"],
        bytes_sent=_optional_int(data.get("bytes_sent")),
        bytes_received=_optional_int(data.get("bytes_received")),
        client_ip=_optional_string(client.get("ip")),
    )


def build_librespeed_command(options: InternetSpeedOptions, *, interface: str) -> tuple[str, ...]:
    command = [
        options.binary,
        "--json",
        "--debug",
        "--no-icmp",
        "--interface",
        interface,
        "--duration",
        str(max(1, options.duration_seconds)),
        "--timeout",
        str(max(1, options.http_timeout_seconds)),
    ]
    if options.server_json:
        command.extend(("--server-json", options.server_json))
    elif options.local_json:
        command.extend(("--local-json", options.local_json))
    if options.server_id is not None:
        command.extend(("--server", str(options.server_id)))
    if options.secure:
        command.append("--secure")
    return tuple(command)


def run_librespeed(
    options: InternetSpeedOptions,
    cancel_event: Event | None = None,
    progress: InternetSpeedProgress | None = None,
    *,
    process_factory: Callable[..., Any] = subprocess.Popen,
    env: Mapping[str, str] | None = None,
) -> InternetSpeedResult:
    cancel_event = cancel_event or Event()
    progress = progress or (lambda _phase: None)
    progress("server_selection")
    interface = choose_internet_interface(options.interface)
    if interface is None:
        return _failure(None, "no_interface", "No network interface found")

    command = build_librespeed_command(options, interface=interface)
    process_env = os.environ.copy()
    process_env["LC_ALL"] = "C"
    if env:
        process_env.update(env)

    try:
        process = process_factory(
            list(command),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=process_env,
        )
    except FileNotFoundError:
        return _failure(interface, "client_missing", f"Required command not found: {options.binary}")
    except OSError as exc:
        return _failure(interface, "client_failed", f"Unable to start {options.binary}: {exc}")

    stdout_chunks: list[str] = []
    stderr_chunks: list[str] = []
    stdout_reader = Thread(
        target=_read_process_stream,
        args=(process.stdout, stdout_chunks),
        daemon=True,
    )
    stderr_reader = Thread(
        target=_read_process_stream,
        args=(process.stderr, stderr_chunks, progress),
        daemon=True,
    )
    stdout_reader.start()
    stderr_reader.start()

    deadline = monotonic() + max(1, options.process_timeout_seconds)
    while process.poll() is None:
        if cancel_event.is_set():
            _terminate_process(process)
            _join_readers(stdout_reader, stderr_reader)
            return _failure(interface, "cancelled", "Internet speed test cancelled by operator")
        if monotonic() >= deadline:
            _terminate_process(process)
            _join_readers(stdout_reader, stderr_reader)
            return _failure(
                interface,
                "timeout",
                f"LibreSpeed exceeded the {max(1, options.process_timeout_seconds)} second process limit",
            )
        sleep(0.05)

    _join_readers(stdout_reader, stderr_reader)
    stdout = "".join(stdout_chunks)
    stderr = "".join(stderr_chunks)
    if process.returncode != 0:
        detail = _command_error(stderr, stdout)
        return _failure(interface, _classify_command_error(detail), detail)

    structured_output = _structured_output(stdout, stderr)
    result = parse_librespeed_json(structured_output, interface=interface)
    if not result.success and stderr.strip():
        return _failure(interface, result.error_code or "invalid_output", f"{result.error}; {stderr.strip()}")
    return result


def _read_process_stream(
    stream: Any,
    chunks: list[str],
    progress: InternetSpeedProgress | None = None,
) -> None:
    if stream is None:
        return
    try:
        for line in iter(stream.readline, ""):
            chunks.append(line)
            if progress is not None:
                phase = _phase_from_debug_line(line)
                if phase is not None:
                    progress(phase)
    except (OSError, ValueError):
        return


def _join_readers(*readers: Thread) -> None:
    for reader in readers:
        reader.join(timeout=2)


def _phase_from_debug_line(line: str) -> str | None:
    normalized = line.lower()
    if "ping test starting" in normalized:
        return "latency"
    if "download test starting" in normalized:
        return "download"
    if "upload test starting" in normalized:
        return "upload"
    if "upload test finished" in normalized:
        return "finalizing"
    return None


def _terminate_process(process: Any) -> None:
    try:
        process.terminate()
        process.wait(timeout=2)
    except (OSError, subprocess.TimeoutExpired):
        try:
            process.kill()
            process.wait(timeout=2)
        except (OSError, subprocess.TimeoutExpired):
            return


def _command_error(stderr: str, stdout: str) -> str:
    detail = stderr.strip() or stdout.strip() or "LibreSpeed exited without a result"
    return detail[-2000:]


def _structured_output(stdout: str, stderr: str) -> str:
    for candidate in (stdout.strip(), *reversed(stdout.splitlines()), *reversed(stderr.splitlines())):
        stripped = candidate.strip()
        if (stripped.startswith("{") and stripped.endswith("}")) or (
            stripped.startswith("[") and stripped.endswith("]")
        ):
            return stripped
    return stdout.strip()


def _classify_command_error(detail: str) -> str:
    normalized = detail.lower()
    internet_markers = (
        "network is unreachable",
        "no route to host",
        "temporary failure in name resolution",
        "could not resolve host",
        "no such host",
        "connection refused",
        "failed to retrieve",
        "failed to fetch",
        "no servers",
    )
    if any(marker in normalized for marker in internet_markers):
        return "no_internet"
    return "server_error"


def _failure(interface: str | None, code: str, message: str) -> InternetSpeedResult:
    return InternetSpeedResult(success=False, interface=interface, error_code=code, error=message)


def _is_number(value: object) -> bool:
    if not isinstance(value, int | float) or isinstance(value, bool):
        return False
    try:
        return isfinite(float(value))
    except OverflowError:
        return False


def _optional_int(value: object) -> int | None:
    return int(value) if _is_number(value) else None


def _optional_string(value: object) -> str | None:
    return value if isinstance(value, str) and value.strip() else None


def options_from_environment(environment: Mapping[str, str] | None = None) -> InternetSpeedOptions:
    values = os.environ if environment is None else environment
    return InternetSpeedOptions(
        binary=values.get("SPECTER_LIBRESPEED_BINARY", "librespeed-cli"),
        interface=_nonempty(values.get("SPECTER_LIBRESPEED_INTERFACE")),
        server_json=_nonempty(values.get("SPECTER_LIBRESPEED_SERVER_JSON")),
        local_json=_nonempty(values.get("SPECTER_LIBRESPEED_LOCAL_JSON")),
        server_id=_mapping_int(values, "SPECTER_LIBRESPEED_SERVER_ID"),
        duration_seconds=_mapping_int(values, "SPECTER_LIBRESPEED_DURATION", 10) or 10,
        http_timeout_seconds=_mapping_int(values, "SPECTER_LIBRESPEED_HTTP_TIMEOUT", 15) or 15,
        process_timeout_seconds=_mapping_int(values, "SPECTER_LIBRESPEED_PROCESS_TIMEOUT", 60) or 60,
        secure=_mapping_flag(values, "SPECTER_LIBRESPEED_SECURE", default=True),
    )


def _mapping_int(values: Mapping[str, str], name: str, default: int | None = None) -> int | None:
    raw = values.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _mapping_flag(values: Mapping[str, str], name: str, *, default: bool) -> bool:
    raw = values.get(name)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _nonempty(value: str | None) -> str | None:
    return value.strip() if value and value.strip() else None


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


def _result_dict(result: InternetSpeedResult | None) -> dict | None:
    if result is None:
        return None
    return {
        "success": result.success,
        "interface": result.interface,
        "server_name": result.server_name,
        "server_url": result.server_url,
        "download_mbps": result.download_mbps,
        "upload_mbps": result.upload_mbps,
        "ping_ms": result.ping_ms,
        "jitter_ms": result.jitter_ms,
        "bytes_sent": result.bytes_sent,
        "bytes_received": result.bytes_received,
        "client_ip": result.client_ip,
        "error_code": result.error_code,
        "error": result.error,
    }
