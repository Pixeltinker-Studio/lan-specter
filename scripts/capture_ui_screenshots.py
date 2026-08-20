#!/usr/bin/env python3
"""Capture the documented SPECTER UI states at the native display resolution."""

from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = REPO_ROOT / "docs" / "screenshots"
VIEWPORT = {"width": 1024, "height": 600}


@dataclass(frozen=True)
class Screen:
    name: str
    filename: str
    settle_ms: int = 250
    needs_ready_scan: bool = True


SCREENS = (
    Screen("boot", "01-boot.jpg", 180, False),
    Screen("plate", "02-unit-plate.jpg", 250, False),
    Screen("menu", "03-main-menu.jpg"),
    Screen("ready", "04-ethernetic-field-status.jpg"),
    Screen("entity-scan", "05-entity-scan.jpg", 450),
    Screen("analysis", "06-full-analysis.jpg", 1500),
    Screen("result", "07-analysis-complete.jpg"),
    Screen("interlock", "08-remote-entity-interlock.jpg"),
    Screen("field-collapse", "09-field-collapse.jpg"),
    Screen("wifi", "10-wlan-spectrum.jpg"),
    Screen("bluetooth", "11-ble-entity-finder.jpg", 450),
    Screen("external-intro", "12-external-capacity.jpg"),
    Screen("external-running", "13-external-analysis.jpg", 350),
    Screen("external-complete", "14-external-analysis-complete.jpg", 2500),
    Screen("diagnostics", "15-diagnostics.jpg"),
    Screen("acoustic", "16-acoustic-signals.jpg"),
    Screen("standby", "17-standby-containment.jpg", 650, False),
)
SCREEN_BY_NAME = {screen.name: screen for screen in SCREENS}


PREPARE_SCREEN_JS = r"""
async (name) => {
  clearTimeout(screensaverTimer);
  clearTimeout(internetSpeedPollTimer);
  stopBluetoothBeeper();
  app.classList.remove("screensaver-mode");
  uiState.screensaverActive = false;

  const getJson = async (path, options = {}) => {
    const response = await fetch(path, {
      cache: "no-store",
      headers: { Accept: "application/json", ...(options.headers || {}) },
      ...options,
    });
    if (!response.ok) throw new Error(`${path} returned ${response.status}`);
    return response.json();
  };
  const loadScan = async (full = false) => {
    uiState.latestPayload = await getJson(`/api/scan${full ? "?full=1" : ""}`, {
      method: "POST",
    });
    updateFooter();
  };

  if (name === "boot") {
    bootScreen();
  } else if (name === "plate") {
    plateScreen();
  } else if (name === "menu") {
    await loadScan();
    menuScreen();
  } else if (name === "ready") {
    await loadScan();
    readyScreen();
  } else if (name === "entity-scan") {
    await loadScan();
    entityScanScreen();
  } else if (name === "analysis") {
    await loadScan();
    analysisScreen();
  } else if (name === "result") {
    await loadScan(true);
    resultScreen();
  } else if (name === "interlock") {
    await loadScan();
    uiState.latestPayload.scan.remote_ping.reachable = false;
    uiState.latestPayload.scan.remote_ping.avg_latency_ms = null;
    analysisInterlockScreen();
  } else if (name === "field-collapse") {
    await loadScan();
    uiState.latestPayload.scan.link.link_detected = false;
    uiState.latestPayload.scan.link.speed_mbps = null;
    uiState.latestPayload.scan.link.duplex = null;
    uiState.latestPayload.scan.remote_ping.reachable = false;
    uiState.latestPayload.scan.remote_ping.avg_latency_ms = null;
    updateFooter();
    idleScreen();
  } else if (name === "wifi") {
    await loadScan();
    const payload = await getJson("/api/wifi/scan", { method: "POST" });
    uiState.wifi = payload.wifi;
    wifiScreen();
  } else if (name === "bluetooth") {
    await loadScan();
    const payload = await getJson("/api/bluetooth/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    uiState.bluetooth = payload.bluetooth;
    uiState.bluetoothUpdatedAtMs = Date.now();
    uiState.bluetoothTarget = payload.bluetooth.devices[0]?.address ?? null;
    bluetoothScreen();
    stopBluetoothBeeper();
  } else if (name === "external-intro") {
    await loadScan();
    uiState.internetSpeed = await getJson("/api/internet-speed");
    uiState.internetSpeedReview = true;
    internetSpeedScreen();
  } else if (name === "external-running") {
    await loadScan();
    uiState.internetSpeed = await getJson("/api/internet-speed");
    uiState.internetSpeed.request = {
      status: "running",
      phase: "download",
      started_at: new Date(Date.now() - 8400).toISOString(),
    };
    uiState.internetSpeedReview = false;
    internetSpeedScreen();
    clearTimeout(internetSpeedPollTimer);
  } else if (name === "external-complete") {
    await loadScan();
    await getJson("/api/internet-speed", { method: "POST" });
    const deadline = Date.now() + 5000;
    do {
      await new Promise((resolve) => setTimeout(resolve, 100));
      uiState.internetSpeed = await getJson("/api/internet-speed");
    } while (uiState.internetSpeed.request.status !== "completed" && Date.now() < deadline);
    if (uiState.internetSpeed.request.status !== "completed") {
      throw new Error("demo internet speed analysis did not complete");
    }
    uiState.internetSpeedReview = false;
    internetSpeedScreen();
  } else if (name === "diagnostics") {
    await loadScan();
    diagnosticsScreen();
  } else if (name === "acoustic") {
    await loadScan();
    const payload = await getJson("/api/beeper");
    uiState.beeper = payload.beeper;
    beeperScreen();
  } else if (name === "standby") {
    screensaverScreen();
  } else {
    throw new Error(`unknown screen: ${name}`);
  }
  clearTimeout(screensaverTimer);
}
"""


def request_json(base_url: str, path: str, *, method: str = "GET") -> dict[str, Any]:
    request = Request(
        f"{base_url.rstrip('/')}{path}",
        method=method,
        headers={"Accept": "application/json"},
    )
    with urlopen(request, timeout=3) as response:
        return json.load(response)


def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def start_demo_server() -> tuple[subprocess.Popen[bytes], str]:
    port = find_free_port()
    base_url = f"http://127.0.0.1:{port}"
    environment = os.environ.copy()
    source_path = str(REPO_ROOT / "src")
    environment["PYTHONPATH"] = os.pathsep.join(
        part for part in (source_path, environment.get("PYTHONPATH")) if part
    )
    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "specter.ui.web",
            "--demo",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
        ],
        cwd=REPO_ROOT,
        env=environment,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"demo server exited with status {process.returncode}")
        try:
            request_json(base_url, "/api/scan")
            return process, base_url
        except (HTTPError, URLError, TimeoutError):
            time.sleep(0.1)
    process.terminate()
    raise RuntimeError("demo server did not become ready within 10 seconds")


def require_demo_mode(base_url: str) -> None:
    payload = request_json(base_url, "/api/scan")
    if payload.get("mode") != "demo":
        raise RuntimeError(
            f"refusing to capture from {base_url}: /api/scan does not report demo mode"
        )


def wait_for_ready_scan(base_url: str) -> None:
    deadline = time.monotonic() + 12
    while time.monotonic() < deadline:
        payload = request_json(base_url, "/api/scan", method="POST")
        remote_ping = (payload.get("scan") or {}).get("remote_ping") or {}
        if remote_ping.get("reachable") is True:
            return
        time.sleep(0.25)
    raise RuntimeError("demo scan did not acquire the remote entity within 12 seconds")


def jpeg_dimensions(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    if data[:2] != b"\xff\xd8":
        raise RuntimeError(f"{path} is not a JPEG file")
    offset = 2
    while offset + 9 <= len(data):
        if data[offset] != 0xFF:
            offset += 1
            continue
        marker = data[offset + 1]
        offset += 2
        if marker in {0xD8, 0xD9} or 0xD0 <= marker <= 0xD7:
            continue
        if offset + 2 > len(data):
            break
        segment_length = int.from_bytes(data[offset : offset + 2], "big")
        if marker in {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}:
            height = int.from_bytes(data[offset + 3 : offset + 5], "big")
            width = int.from_bytes(data[offset + 5 : offset + 7], "big")
            return width, height
        if segment_length < 2:
            break
        offset += segment_length
    raise RuntimeError(f"could not read JPEG dimensions from {path}")


def select_screens(value: str | None) -> list[Screen]:
    if value is None:
        return list(SCREENS)
    names = [name.strip() for name in value.split(",") if name.strip()]
    unknown = [name for name in names if name not in SCREEN_BY_NAME]
    if unknown:
        raise ValueError(f"unknown screen name(s): {', '.join(unknown)}")
    if not names:
        raise ValueError("--screens must contain at least one screen name")
    return [SCREEN_BY_NAME[name] for name in names]


def capture(
    screens: list[Screen],
    base_url: str,
    output_dir: Path,
    browser_executable: str | None,
) -> None:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise RuntimeError(
            'Playwright is not installed. Run: python -m pip install -e ".[screenshots]"'
        ) from exc

    output_dir.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        launch_options: dict[str, Any] = {"headless": True}
        if browser_executable:
            launch_options["executable_path"] = browser_executable
        browser = playwright.chromium.launch(**launch_options)
        context = browser.new_context(viewport=VIEWPORT, device_scale_factor=1)
        page = context.new_page()
        try:
            for screen_definition in screens:
                page.goto(
                    f"{base_url.rstrip('/')}?screensaver=999999&echo=999999&bluetooth=999999",
                    wait_until="networkidle",
                )
                page.wait_for_function("typeof plateScreen === 'function'")
                page.evaluate(PREPARE_SCREEN_JS, screen_definition.name)
                page.wait_for_timeout(screen_definition.settle_ms)
                destination = output_dir / screen_definition.filename
                page.screenshot(
                    path=str(destination),
                    type="jpeg",
                    quality=90,
                    full_page=False,
                )
                dimensions = jpeg_dimensions(destination)
                if dimensions != (VIEWPORT["width"], VIEWPORT["height"]):
                    raise RuntimeError(
                        f"{destination} is {dimensions[0]}x{dimensions[1]}, expected 1024x600"
                    )
                try:
                    displayed_destination = destination.relative_to(REPO_ROOT)
                except ValueError:
                    displayed_destination = destination
                print(f"captured {screen_definition.name:18} -> {displayed_destination}")
        finally:
            context.close()
            browser.close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Capture SPECTER demo UI screenshots at 1024x600."
    )
    parser.add_argument(
        "--screens",
        help="comma-separated screen names; defaults to the complete gallery",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="list accepted screen names and exit",
    )
    parser.add_argument(
        "--base-url",
        help="use an existing SPECTER demo server instead of starting one",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"destination directory (default: {DEFAULT_OUTPUT})",
    )
    parser.add_argument(
        "--browser-executable",
        help="path to an installed Chromium executable",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.list:
        for screen in SCREENS:
            print(f"{screen.name:18} {screen.filename}")
        return 0

    try:
        selected = select_screens(args.screens)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    server_process: subprocess.Popen[bytes] | None = None
    try:
        if args.base_url:
            base_url = args.base_url.rstrip("/")
        else:
            server_process, base_url = start_demo_server()
        require_demo_mode(base_url)
        if any(screen.needs_ready_scan for screen in selected):
            wait_for_ready_scan(base_url)
        capture(selected, base_url, args.output_dir.resolve(), args.browser_executable)
    except (HTTPError, URLError, TimeoutError, RuntimeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    finally:
        if server_process is not None and server_process.poll() is None:
            server_process.terminate()
            try:
                server_process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                server_process.kill()
                server_process.wait(timeout=3)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
