import json
import unittest
from http.server import ThreadingHTTPServer
from threading import Thread
from urllib.request import Request, urlopen

from specter.ui.web import DemoState, WebUiOptions, build_handler


class WebApiTests(unittest.TestCase):
    def setUp(self):
        handler = build_handler(options=WebUiOptions(), demo=True, demo_state=DemoState())
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
        with urlopen(request, timeout=2) as response:
            return response.status, json.loads(response.read())

    def test_scan_read_and_start_are_separate(self):
        status, snapshot = self.request("/api/scan")
        self.assertEqual(status, 200)
        self.assertEqual(snapshot["request"]["status"], "idle")

        status, result = self.request("/api/scan?full=1", method="POST")
        self.assertEqual(status, 200)
        self.assertEqual(result["request"]["status"], "completed")
        self.assertTrue(result["request"]["full_analysis"])

    def test_wifi_radio_route_returns_confirmed_state(self):
        status, result = self.request("/api/wifi/radio", method="POST", payload={"enabled": False})

        self.assertEqual(status, 200)
        self.assertFalse(result["wifi"]["radio_enabled"])
        self.assertEqual(result["wifi"]["access_points"], [])

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


if __name__ == "__main__":
    unittest.main()
