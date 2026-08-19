import json
import unittest

from specter.core.results import DiagnosticsResult, IperfResult, LinkResult, PingResult
from specter.ui.cli import format_dashboard, format_json


class CliFormatTests(unittest.TestCase):
    def test_format_json_includes_structured_scan_result(self):
        result = DiagnosticsResult(
            interface="eth0",
            link=LinkResult(
                interface="eth0",
                link_detected=True,
                speed_mbps=1000,
                duplex="full",
                autonegotiation="on",
            ),
            remote_ping=PingResult(
                target="specter-re01.local",
                reachable=True,
                transmitted=2,
                received=2,
                packet_loss_percent=0.0,
                avg_latency_ms=0.42,
            ),
            throughput=IperfResult(
                target="specter-re01.local",
                success=True,
                bits_per_second=936_000_000,
                retransmits=0,
                seconds=5.0,
            ),
        )

        data = json.loads(format_json(result))

        self.assertEqual(data["interface"], "eth0")
        self.assertEqual(data["severity"], "pass")
        self.assertEqual(data["link"]["speed_mbps"], 1000)
        self.assertEqual(data["remote_ping"]["target"], "specter-re01.local")
        self.assertEqual(data["throughput"]["mbps"], 936.0)

    def test_format_dashboard_is_compact_for_console_display(self):
        result = DiagnosticsResult(
            interface="eth0",
            link=LinkResult(
                interface="eth0",
                link_detected=True,
                speed_mbps=1000,
                duplex="full",
            ),
            gateway_ping=PingResult(target="192.168.2.1", reachable=True, avg_latency_ms=0.4, packet_loss_percent=0.0),
            remote_ping=PingResult(
                target="specter-re01.local",
                reachable=True,
                avg_latency_ms=0.5,
                packet_loss_percent=0.0,
            ),
            internet_ping=PingResult(target="1.1.1.1", reachable=True, avg_latency_ms=25.0, packet_loss_percent=0.0),
            throughput=IperfResult(target="specter-re01.local", success=True, bits_per_second=936_000_000),
        )

        output = format_dashboard(result)

        self.assertIn("SPECTER // ES-01", output)
        self.assertIn("STATUS     STABLE", output)
        self.assertIn("LINK       UP 1000M", output)
        self.assertIn("ENTITY     FOUND", output)
        self.assertIn("TRANSFER   936M", output)


if __name__ == "__main__":
    unittest.main()
