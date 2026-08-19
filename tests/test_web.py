import unittest

from specter.core.results import Address, DiagnosticsResult, IpConfigResult, LinkResult, PingResult
from specter.ui.web import DemoState, WebUiOptions, build_scan_payload, infer_ui_state


class WebUiTests(unittest.TestCase):
    def test_demo_payload_uses_structured_technical_scan_data(self):
        state = DemoState()
        state.started_at -= 20

        payload = build_scan_payload(options=WebUiOptions(), demo=True, demo_state=state, full_analysis=True)

        self.assertEqual(payload["mode"], "demo")
        self.assertEqual(payload["ui"]["state"], "result")
        self.assertTrue(payload["scan"]["link"]["link_detected"])
        self.assertEqual(payload["scan"]["link"]["speed_mbps"], 1000)
        self.assertEqual(payload["scan"]["throughput"]["mbps"], 936.0)

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


if __name__ == "__main__":
    unittest.main()
