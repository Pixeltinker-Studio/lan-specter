import json
import unittest

from specter.core.results import DiagnosticsResult, IperfResult, LinkResult, PingResult
from specter.ui.cli import format_json


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


if __name__ == "__main__":
    unittest.main()
