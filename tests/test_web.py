import unittest
from importlib.resources import files
from threading import Event, Thread

from specter.core.results import Address, DiagnosticsResult, IpConfigResult, LinkResult, PingResult
from specter.ui.web import DemoState, ScanCoordinator, WebUiOptions, build_echo_payload, build_scan_payload, infer_ui_state


class WebUiTests(unittest.TestCase):
    def test_menu_replaces_sound_controls_with_external_capacity(self):
        source = files("specter.ui.web_static").joinpath("app.js").read_text(encoding="utf-8")
        menu_source = source[source.index("function menuScreen()") : source.index("function plateScreen()")]

        self.assertIn('data-action="internet-speed"', menu_source)
        self.assertIn("EXTERNAL CAPACITY", menu_source)
        self.assertNotIn('data-action="beeper"', menu_source)

    def test_screensaver_uses_distance_reactive_unconnected_frames(self):
        source = files("specter.ui.web_static").joinpath("app.js").read_text(encoding="utf-8")
        screensaver_source = source[
            source.index("function screensaverScreen()") : source.index("function animateAnalysisProgress()")
        ]

        self.assertIn('class="containment-tunnel"', screensaver_source)
        self.assertIn("Array.from({ length: 8 }", screensaver_source)
        self.assertIn("requestAnimationFrame", screensaver_source)
        self.assertIn("distanceToTarget * 0.3", screensaver_source)
        self.assertIn("targetSpeed * 0.16", screensaver_source)
        self.assertIn("ENTITY DISSIPATION", screensaver_source)
        self.assertIn("entityIndex = (entityIndex + 1)", screensaver_source)
        self.assertIn("clamp(142 + pursuitDistance * 0.5", screensaver_source)
        self.assertNotIn('class="tunnel-rails"', screensaver_source)
        self.assertNotIn('class="containment-grid"', screensaver_source)
        self.assertNotIn('class="screensaver-readout"', screensaver_source)

    def test_scan_coordinator_coalesces_concurrent_compatible_scans(self):
        started = Event()
        release = Event()
        calls = []

        def build_payload(full_analysis):
            calls.append(full_analysis)
            started.set()
            self.assertTrue(release.wait(timeout=2))
            return {"mode": "test", "ui": {"state": "ready"}, "scan": {"sequence": len(calls)}}

        coordinator = ScanCoordinator(build_payload)
        results = []
        first = Thread(target=lambda: results.append(coordinator.run(full_analysis=False)))
        second = Thread(target=lambda: results.append(coordinator.run(full_analysis=False)))

        first.start()
        self.assertTrue(started.wait(timeout=2))
        second.start()
        release.set()
        first.join(timeout=2)
        second.join(timeout=2)

        self.assertFalse(first.is_alive())
        self.assertFalse(second.is_alive())
        self.assertEqual(calls, [False])
        self.assertEqual(len(results), 2)
        self.assertEqual(results[0]["request"]["scan_id"], results[1]["request"]["scan_id"])
        self.assertEqual(results[0]["request"]["status"], "completed")

    def test_scan_coordinator_snapshot_reports_running_request(self):
        started = Event()
        release = Event()

        def build_payload(full_analysis):
            started.set()
            self.assertTrue(release.wait(timeout=2))
            return {"mode": "test", "ui": {"state": "result"}, "scan": {}}

        coordinator = ScanCoordinator(build_payload)
        worker = Thread(target=lambda: coordinator.run(full_analysis=True))
        worker.start()
        self.assertTrue(started.wait(timeout=2))

        snapshot = coordinator.snapshot(mode="test")
        self.assertEqual(snapshot["request"]["status"], "running")
        self.assertTrue(snapshot["request"]["full_analysis"])

        release.set()
        worker.join(timeout=2)
        self.assertEqual(coordinator.snapshot(mode="test")["request"]["status"], "completed")

    def test_demo_payload_uses_structured_technical_scan_data(self):
        state = DemoState()
        state.started_at -= 20

        payload = build_scan_payload(options=WebUiOptions(), demo=True, demo_state=state, full_analysis=True)

        self.assertEqual(payload["mode"], "demo")
        self.assertEqual(payload["ui"]["state"], "result")
        self.assertTrue(payload["scan"]["link"]["link_detected"])
        self.assertEqual(payload["scan"]["link"]["speed_mbps"], 1000)
        self.assertEqual(payload["scan"]["throughput"]["mbps"], 936.0)

    def test_demo_echo_payload_uses_structured_ping_data(self):
        state = DemoState()
        state.started_at -= 20

        payload = build_echo_payload(options=WebUiOptions(), demo=True, demo_state=state)

        self.assertEqual(payload["mode"], "demo")
        self.assertIn("remote_ping", payload["echo"])
        self.assertEqual(payload["echo"]["remote_ping"]["target"], "specter-re01.local")
        self.assertIsInstance(payload["echo"]["remote_ping"]["avg_latency_ms"], float)

    def test_demo_hardware_payloads_are_explicitly_available(self):
        state = DemoState()
        state.bluetooth_scanning = True

        self.assertTrue(state.bluetooth_payload()["bluetooth"]["running"])
        self.assertTrue(state.beeper_payload()["beeper"]["available"])

    def test_infer_ready_state_from_live_result(self):
        result = DiagnosticsResult(
            interface="eth0",
            link=LinkResult(interface="eth0", link_detected=True, speed_mbps=1000, duplex="full"),
            ip_config=IpConfigResult(interface="eth0", addresses=(Address(family="inet", address="192.168.2.149/24"),)),
            remote_ping=PingResult(target="specter-re01.local", reachable=True),
        )

        self.assertEqual(infer_ui_state(result, full_analysis=False), "ready")
        self.assertEqual(infer_ui_state(result, full_analysis=True), "result")

    def test_infer_no_link_state(self):
        result = DiagnosticsResult(
            interface="eth0",
            link=LinkResult(interface="eth0", link_detected=False, speed_mbps=None, duplex=None),
        )

        self.assertEqual(infer_ui_state(result, full_analysis=False), "no_link")

    def test_infer_no_dhcp_state(self):
        result = DiagnosticsResult(
            interface="eth0",
            link=LinkResult(interface="eth0", link_detected=True, speed_mbps=1000, duplex="full"),
            ip_config=IpConfigResult(interface="eth0"),
        )

        self.assertEqual(infer_ui_state(result, full_analysis=False), "no_dhcp")

    def test_infer_entity_not_found_state(self):
        result = DiagnosticsResult(
            interface="eth0",
            link=LinkResult(interface="eth0", link_detected=True, speed_mbps=1000, duplex="full"),
            ip_config=IpConfigResult(interface="eth0", addresses=(Address(family="inet", address="192.168.2.149/24"),)),
            remote_ping=PingResult(target="specter-re01.local", reachable=False),
        )

        self.assertEqual(infer_ui_state(result, full_analysis=False), "entity_not_found")


if __name__ == "__main__":
    unittest.main()
