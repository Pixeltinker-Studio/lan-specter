from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime
from threading import Event, Lock, Thread
from time import monotonic
from typing import Any


@dataclass(frozen=True)
class BluetoothDeviceReading:
    address: str
    name: str | None
    rssi: int
    smoothed_rssi: float
    trend: str
    last_seen: str
    age_seconds: float
    manufacturer_ids: tuple[int, ...] = ()
    service_uuids: tuple[str, ...] = ()


@dataclass(frozen=True)
class BluetoothScannerStatus:
    running: bool
    adapter: str
    devices: tuple[BluetoothDeviceReading, ...]
    error: str | None = None


@dataclass
class _Observation:
    address: str
    name: str | None
    rssi: int
    smoothed_rssi: float
    trend: str
    last_seen: str
    seen_monotonic: float
    manufacturer_ids: tuple[int, ...]
    service_uuids: tuple[str, ...]


class BluetoothScannerService:
    """Own a BlueZ BLE scan loop and expose thread-safe RSSI snapshots."""

    def __init__(self, *, adapter: str = "hci0", stale_after_seconds: float = 15.0) -> None:
        self.adapter = adapter
        self.stale_after_seconds = stale_after_seconds
        self._lock = Lock()
        self._stop_event = Event()
        self._thread: Thread | None = None
        self._running = False
        self._error: str | None = None
        self._devices: dict[str, _Observation] = {}

    def start(self) -> BluetoothScannerStatus:
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return self._snapshot_locked()
            self._stop_event.clear()
            self._error = None
            self._running = True
            self._thread = Thread(target=self._thread_main, name="specter-ble-scanner", daemon=True)
            self._thread.start()
            return self._snapshot_locked()

    def stop(self) -> BluetoothScannerStatus:
        self._stop_event.set()
        with self._lock:
            thread = self._thread
        if thread is not None and thread.is_alive():
            thread.join(timeout=3)
        with self._lock:
            if thread is not None and thread.is_alive():
                self._error = "Bluetooth scanner did not stop within 3 seconds"
                self._running = True
                return self._snapshot_locked()
            self._running = False
            self._thread = None
            self._devices.clear()
            return self._snapshot_locked()

    def snapshot(self) -> BluetoothScannerStatus:
        with self._lock:
            return self._snapshot_locked()

    def record_advertisement(self, device: Any, advertisement_data: Any) -> None:
        address = str(getattr(device, "address", "") or getattr(device, "name", "") or "").strip()
        rssi = getattr(advertisement_data, "rssi", None)
        if not address or not isinstance(rssi, int):
            return

        now_monotonic = monotonic()
        now = datetime.now(UTC).isoformat()
        name = getattr(advertisement_data, "local_name", None) or getattr(device, "name", None)
        manufacturer_data = getattr(advertisement_data, "manufacturer_data", {}) or {}
        service_uuids = getattr(advertisement_data, "service_uuids", ()) or ()

        with self._lock:
            previous = self._devices.get(address)
            smoothed = float(rssi) if previous is None else (previous.smoothed_rssi * 0.65) + (rssi * 0.35)
            delta = 0.0 if previous is None else smoothed - previous.smoothed_rssi
            trend = "approaching" if delta >= 2.0 else "receding" if delta <= -2.0 else "stable"
            self._devices[address] = _Observation(
                address=address,
                name=str(name) if name else None,
                rssi=rssi,
                smoothed_rssi=smoothed,
                trend=trend,
                last_seen=now,
                seen_monotonic=now_monotonic,
                manufacturer_ids=tuple(sorted(int(identifier) for identifier in manufacturer_data)),
                service_uuids=tuple(str(uuid) for uuid in service_uuids),
            )

    def _thread_main(self) -> None:
        try:
            asyncio.run(self._scan_loop())
        except Exception as exc:
            with self._lock:
                self._error = str(exc)
        finally:
            with self._lock:
                self._running = False

    async def _scan_loop(self) -> None:
        try:
            from bleak import BleakScanner
        except ImportError as exc:
            raise RuntimeError("Python package 'bleak' is not installed") from exc

        scanner_options = {
            "adapter": self.adapter,
            "filters": {"DuplicateData": True},
        }
        async with BleakScanner(self.record_advertisement, bluez=scanner_options):
            while not self._stop_event.is_set():
                await asyncio.sleep(0.2)

    def _snapshot_locked(self) -> BluetoothScannerStatus:
        now = monotonic()
        stale_addresses = [
            address
            for address, observation in self._devices.items()
            if now - observation.seen_monotonic > self.stale_after_seconds
        ]
        for address in stale_addresses:
            del self._devices[address]

        readings = tuple(
            sorted(
                (
                    BluetoothDeviceReading(
                        address=observation.address,
                        name=observation.name,
                        rssi=observation.rssi,
                        smoothed_rssi=round(observation.smoothed_rssi, 1),
                        trend=observation.trend,
                        last_seen=observation.last_seen,
                        age_seconds=round(max(0.0, now - observation.seen_monotonic), 1),
                        manufacturer_ids=observation.manufacturer_ids,
                        service_uuids=observation.service_uuids,
                    )
                    for observation in self._devices.values()
                ),
                key=lambda reading: (-reading.smoothed_rssi, reading.address),
            )
        )
        return BluetoothScannerStatus(
            running=self._running,
            adapter=self.adapter,
            devices=readings,
            error=self._error,
        )
