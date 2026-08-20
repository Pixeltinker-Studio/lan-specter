from __future__ import annotations

from dataclasses import dataclass
from queue import Empty, Full, PriorityQueue
from threading import Event, Lock, Thread
from time import monotonic
from typing import Any, Callable


@dataclass(frozen=True)
class ToneStep:
    frequency_hz: int
    duration_seconds: float
    gap_seconds: float = 0.0


@dataclass(frozen=True)
class BeeperStatus:
    configured: bool
    available: bool
    muted: bool
    pin: int | None
    queued_patterns: int
    last_error: str | None = None


PATTERNS: dict[str, tuple[ToneStep, ...]] = {
    "boot": (
        ToneStep(440, 0.08, 0.03),
        ToneStep(660, 0.08, 0.03),
        ToneStep(880, 0.12),
    ),
    "input": (ToneStep(720, 0.035),),
    "scan_tick": (ToneStep(520, 0.045),),
    "acquired": (
        ToneStep(660, 0.07, 0.025),
        ToneStep(990, 0.13),
    ),
    "warning": (
        ToneStep(420, 0.12, 0.06),
        ToneStep(420, 0.12),
    ),
    "error": (
        ToneStep(300, 0.16, 0.05),
        ToneStep(220, 0.24),
    ),
}

_PRIORITIES = {
    "error": 0,
    "warning": 1,
    "acquired": 2,
    "boot": 3,
    "input": 5,
    "scan_tick": 6,
}


class BeeperService:
    """Play bounded GPIO tone patterns without blocking request or scan threads."""

    def __init__(
        self,
        *,
        pin: int | None,
        muted: bool = False,
        buzzer_factory: Callable[[int], Any] | None = None,
        tone_factory: Callable[[int], Any] | None = None,
        queue_size: int = 24,
    ) -> None:
        self.pin = pin
        self._muted = muted
        self._buzzer_factory = buzzer_factory
        self._tone_factory = tone_factory
        self._queue: PriorityQueue[tuple[int, int, str]] = PriorityQueue(maxsize=queue_size)
        self._lock = Lock()
        self._stop_event = Event()
        self._thread: Thread | None = None
        self._buzzer: Any | None = None
        self._available = False
        self._last_error: str | None = None
        self._sequence = 0
        self._last_scan_tick = 0.0

    def start(self) -> BeeperStatus:
        with self._lock:
            if self.pin is None:
                self._last_error = "Beeper GPIO pin is not configured"
                return self._status_locked()
            if self._thread is not None and self._thread.is_alive():
                return self._status_locked()
            try:
                buzzer_factory, tone_factory = self._resolve_factories()
                self._buzzer = buzzer_factory(self.pin)
                self._tone_factory = tone_factory
            except Exception as exc:
                self._available = False
                self._last_error = str(exc)
                return self._status_locked()

            self._stop_event.clear()
            self._available = True
            self._last_error = None
            self._thread = Thread(target=self._worker, name="specter-piezo-beeper", daemon=True)
            self._thread.start()
            return self._status_locked()

    def stop(self) -> BeeperStatus:
        self._stop_event.set()
        with self._lock:
            thread = self._thread
        if thread is not None and thread.is_alive():
            thread.join(timeout=3)
        self._clear_queue()
        with self._lock:
            self._silence_and_close()
            self._thread = None
            self._available = False
            return self._status_locked()

    def trigger(self, pattern: str) -> BeeperStatus:
        if pattern not in PATTERNS:
            with self._lock:
                self._last_error = f"Unknown beeper pattern: {pattern}"
                return self._status_locked()

        status = self.start()
        with self._lock:
            if not status.available or self._muted:
                return self._status_locked()
            now = monotonic()
            if pattern == "scan_tick":
                if now - self._last_scan_tick < 0.15 or self._queue.qsize() > 2:
                    return self._status_locked()
                self._last_scan_tick = now
            self._sequence += 1
            item = (_PRIORITIES[pattern], self._sequence, pattern)

        try:
            self._queue.put_nowait(item)
        except Full:
            with self._lock:
                self._last_error = "Beeper queue is full; pattern was dropped"
        return self.status()

    def set_muted(self, muted: bool) -> BeeperStatus:
        with self._lock:
            self._muted = muted
            buzzer = self._buzzer
        if muted and buzzer is not None:
            try:
                buzzer.stop()
            except Exception:
                pass
            self._clear_queue()
        return self.status()

    def status(self) -> BeeperStatus:
        with self._lock:
            return self._status_locked()

    def _worker(self) -> None:
        try:
            while not self._stop_event.is_set():
                try:
                    _, _, pattern = self._queue.get(timeout=0.2)
                except Empty:
                    continue
                try:
                    self._play_pattern(pattern)
                except Exception as exc:
                    with self._lock:
                        self._last_error = str(exc)
                finally:
                    self._queue.task_done()
        finally:
            with self._lock:
                self._silence_and_close()
                self._available = False

    def _play_pattern(self, pattern: str) -> None:
        with self._lock:
            buzzer = self._buzzer
            tone_factory = self._tone_factory
            muted = self._muted
        if buzzer is None or tone_factory is None or muted:
            return

        for step in PATTERNS[pattern]:
            if self._stop_event.is_set():
                break
            with self._lock:
                if self._muted:
                    break
            buzzer.play(tone_factory(step.frequency_hz))
            if self._stop_event.wait(step.duration_seconds):
                break
            buzzer.stop()
            if step.gap_seconds and self._stop_event.wait(step.gap_seconds):
                break
        buzzer.stop()

    def _resolve_factories(self) -> tuple[Callable[[int], Any], Callable[[int], Any]]:
        if self._buzzer_factory is not None and self._tone_factory is not None:
            return self._buzzer_factory, self._tone_factory
        try:
            from gpiozero import TonalBuzzer
            from gpiozero.tones import Tone
        except ImportError as exc:
            raise RuntimeError("Python package 'gpiozero' is not installed") from exc
        return lambda pin: TonalBuzzer(pin, octaves=2), Tone

    def _silence_and_close(self) -> None:
        buzzer = self._buzzer
        self._buzzer = None
        if buzzer is None:
            return
        try:
            buzzer.stop()
        finally:
            close = getattr(buzzer, "close", None)
            if callable(close):
                close()

    def _clear_queue(self) -> None:
        while True:
            try:
                self._queue.get_nowait()
            except Empty:
                return
            else:
                self._queue.task_done()

    def _status_locked(self) -> BeeperStatus:
        return BeeperStatus(
            configured=self.pin is not None,
            available=self._available,
            muted=self._muted,
            pin=self.pin,
            queued_patterns=self._queue.qsize(),
            last_error=self._last_error,
        )
