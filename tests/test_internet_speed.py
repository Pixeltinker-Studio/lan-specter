import unittest
from pathlib import Path
from threading import Event
from unittest.mock import patch

from specter.network.internet_speed import (
    InternetSpeedOptions,
    InternetSpeedResult,
    InternetSpeedService,
    build_librespeed_command,
    options_from_environment,
    parse_librespeed_json,
    run_librespeed,
)


FIXTURES = Path(__file__).parent / "fixtures"


class InternetSpeedTests(unittest.TestCase):
    def test_parse_structured_librespeed_fixture(self):
        payload = (FIXTURES / "librespeed_success.json").read_text(encoding="utf-8")

        result = parse_librespeed_json(payload, interface="wlan0")

        self.assertTrue(result.success)
        self.assertEqual(result.interface, "wlan0")
        self.assertEqual(result.server_name, "Berlin Measurement Node")
        self.assertEqual(result.download_mbps, 286.42)
        self.assertEqual(result.upload_mbps, 47.18)
        self.assertEqual(result.ping_ms, 18.73)
        self.assertEqual(result.jitter_ms, 1.26)
        self.assertEqual(result.bytes_received, 429630000)

    def test_parse_librespeed_v1_0_14_array_output(self):
        payload = (FIXTURES / "librespeed_v1_0_14_success.json").read_text(encoding="utf-8")

        result = parse_librespeed_json(payload, interface="eth0")

        self.assertTrue(result.success)
        self.assertEqual(result.interface, "eth0")
        self.assertEqual(result.server_name, "Frankfurt Measurement Node")
        self.assertEqual(result.download_mbps, 512.34)
        self.assertEqual(result.upload_mbps, 81.27)

    def test_parser_rejects_empty_librespeed_result_array(self):
        result = parse_librespeed_json("[]", interface="eth0")

        self.assertFalse(result.success)
        self.assertEqual(result.error_code, "invalid_output")
        self.assertIn("no measurement result", result.error)

    def test_parser_rejects_incomplete_success_output(self):
        result = parse_librespeed_json('{"download": 100}', interface="eth0")

        self.assertFalse(result.success)
        self.assertEqual(result.error_code, "invalid_output")
        self.assertIn("upload", result.error)

    def test_command_disables_telemetry_and_supports_custom_backend(self):
        options = InternetSpeedOptions(
            binary="/opt/specter/librespeed-cli",
            server_json="https://speed.example.net/servers.json",
            server_id=7,
            duration_seconds=8,
            http_timeout_seconds=12,
        )

        command = build_librespeed_command(options, interface="wlan0")

        self.assertEqual(command[0], "/opt/specter/librespeed-cli")
        self.assertIn("--json", command)
        self.assertNotIn("--share", command)
        self.assertFalse(any(argument.startswith("--telemetry") for argument in command))
        self.assertEqual(command[command.index("--interface") + 1], "wlan0")
        self.assertEqual(command[command.index("--server-json") + 1], "https://speed.example.net/servers.json")
        self.assertEqual(command[command.index("--server") + 1], "7")

    def test_environment_supports_self_hosted_server_list(self):
        options = options_from_environment(
            {
                "SPECTER_LIBRESPEED_BINARY": "/usr/local/bin/librespeed-cli",
                "SPECTER_LIBRESPEED_LOCAL_JSON": "/etc/specter/servers.json",
                "SPECTER_LIBRESPEED_INTERFACE": "eth0",
                "SPECTER_LIBRESPEED_DURATION": "7",
                "SPECTER_LIBRESPEED_PROCESS_TIMEOUT": "40",
                "SPECTER_LIBRESPEED_SECURE": "0",
            }
        )

        self.assertEqual(options.local_json, "/etc/specter/servers.json")
        self.assertEqual(options.interface, "eth0")
        self.assertEqual(options.duration_seconds, 7)
        self.assertEqual(options.process_timeout_seconds, 40)
        self.assertFalse(options.secure)

    def test_service_reports_estimated_duration_for_progress_display(self):
        service = InternetSpeedService(
            InternetSpeedOptions(duration_seconds=8, process_timeout_seconds=60)
        )

        configuration = service.snapshot()["configuration"]

        self.assertEqual(configuration["estimated_duration_seconds"], 26)

    def test_service_reports_cancelled_without_success_result(self):
        entered = Event()

        def runner(options, cancel_event):
            entered.set()
            self.assertTrue(cancel_event.wait(timeout=2))
            return InternetSpeedResult(
                success=False,
                interface="eth0",
                error_code="cancelled",
                error="Internet speed test cancelled by operator",
            )

        service = InternetSpeedService(InternetSpeedOptions(), runner=runner)
        self.assertTrue(service.start())
        self.assertTrue(entered.wait(timeout=1))
        self.assertTrue(service.cancel())
        service.stop(timeout=2)

        snapshot = service.snapshot()
        self.assertEqual(snapshot["request"]["status"], "cancelled")
        self.assertFalse(snapshot["result"]["success"])
        self.assertEqual(snapshot["result"]["error_code"], "cancelled")

    @patch("specter.network.internet_speed.choose_interface", return_value="eth0")
    def test_missing_client_never_returns_a_success_result(self, _choose_interface):
        def missing_process(*args, **kwargs):
            raise FileNotFoundError

        result = run_librespeed(InternetSpeedOptions(), process_factory=missing_process)

        self.assertFalse(result.success)
        self.assertEqual(result.interface, "eth0")
        self.assertEqual(result.error_code, "client_missing")


if __name__ == "__main__":
    unittest.main()
