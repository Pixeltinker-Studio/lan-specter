import json
import unittest
from http.server import ThreadingHTTPServer
from threading import Thread
from time import monotonic, sleep
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from specter.ui.web import DemoState, WebUiOptions, build_handler


class WebApiTests(unittest.TestCase):
    def setUp(self):
        self.demo_state = DemoState()
        self.demo_state.started_at -= 20
        handler = build_handler(options=WebUiOptions(), demo=True, demo_state=self.demo_state)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.worker = Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()
        host, port = self.server.server_address
        self.base_url = f"http://{host}:{port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.worker.join(timeout=2)

    def request(self, path, *, method="GET", payload=None):
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        request = Request(
            self.base_url + path,
            data=data,
            method=method,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
        )
        try:
            with urlopen(request, timeout=2) as response:
                return response.status, json.loads(response.read())
        except HTTPError as error:
            return error.code, json.loads(error.read())

    def test_scan_read_and_start_are_separate(self):
        status, snapshot = self.request("/api/scan")
        self.assertEqual(status, 200)
        self.assertEqual(snapshot["request"]["status"], "idle")

        self.request("/api/scan", method="POST")
        status, result = self.request("/api/scan?full=1", method="POST")
        self.assertEqual(status, 200)
        self.assertEqual(result["request"]["status"], "completed")
        self.assertTrue(result["request"]["full_analysis"])

    def test_full_analysis_is_blocked_without_acquired_remote_entity(self):
        self.demo_state.started_at = monotonic() - 7
        self.request("/api/scan", method="POST")

        status, result = self.request("/api/scan?full=1", method="POST")

        self.assertEqual(status, 409)
        self.assertEqual(result["request"]["status"], "blocked")
        self.assertEqual(result["code"], "R-031")
        self.assertEqual(self.demo_state.analysis_runs, 0)

    def test_wifi_radio_route_returns_confirmed_state(self):
        status, result = self.request("/api/wifi/radio", method="POST", payload={"enabled": False})

        self.assertEqual(status, 200)
        self.assertFalse(result["wifi"]["radio_enabled"])
        self.assertEqual(result["wifi"]["access_points"], [])

    def test_wifi_connect_route_activates_selected_network_without_echoing_password(self):
        status, started = self.request(
            "/api/wifi/connect",
            method="POST",
            payload={
                "ssid": "FIELD-NET",
                "bssid": "02:00:00:00:00:02",
                "security": "WPA2",
                "password": "field-secret",
            },
        )

        self.assertEqual(status, 202)
        self.assertEqual(started["request"]["status"], "running")
        self.assertNotIn("field-secret", str(started))

        result = started
        for _ in range(30):
            status, result = self.request("/api/wifi/connection")
            if result["request"]["status"] != "running":
                break
            sleep(0.05)

        self.assertEqual(status, 200)
        self.assertEqual(result["request"]["status"], "completed")
        self.assertTrue(result["result"]["success"])
        self.assertEqual(self.demo_state.wifi_connection, "FIELD-NET")

    def test_wifi_connect_route_rejects_missing_network_key(self):
        status, result = self.request(
            "/api/wifi/connect",
            method="POST",
            payload={
                "ssid": "FIELD-NET",
                "bssid": "02:00:00:00:00:02",
                "security": "WPA2",
                "password": "",
            },
        )

        self.assertEqual(status, 400)
        self.assertIn("requires a password", result["error"])

    def test_bluetooth_scanner_route_starts_demo_receiver(self):
        status, result = self.request("/api/bluetooth/scan", method="POST", payload={"enabled": True})

        self.assertEqual(status, 200)
        self.assertTrue(result["bluetooth"]["running"])
        self.assertGreater(len(result["bluetooth"]["devices"]), 0)

    def test_beeper_routes_expose_mute_and_patterns(self):
        status, muted = self.request("/api/beeper/mute", method="POST", payload={"muted": True})
        self.assertEqual(status, 200)
        self.assertTrue(muted["beeper"]["muted"])

        status, triggered = self.request("/api/beeper/trigger", method="POST", payload={"pattern": "warning"})
        self.assertEqual(status, 200)
        self.assertIn("warning", triggered["patterns"])

    def test_internet_speed_route_does_not_require_remote_entity(self):
        self.demo_state.started_at = monotonic()

        status, started = self.request("/api/internet-speed", method="POST")

        self.assertEqual(status, 202)
        self.assertEqual(started["request"]["status"], "running")
        self.assertIn("connection capacity", started["configuration"]["data_usage"])

        result = started
        for _ in range(50):
            status, result = self.request("/api/internet-speed")
            if result["request"]["status"] != "running":
                break
            sleep(0.05)

        self.assertEqual(status, 200)
        self.assertEqual(result["request"]["status"], "completed")
        self.assertTrue(result["result"]["success"])
        self.assertIsInstance(result["result"]["download_mbps"], float)
        self.assertIsInstance(result["result"]["upload_mbps"], float)
        self.assertIsInstance(result["result"]["ping_ms"], float)
        self.assertIsInstance(result["result"]["jitter_ms"], float)


if __name__ == "__main__":
    unittest.main()
