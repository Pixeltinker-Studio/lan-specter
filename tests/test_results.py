import unittest

from specter.core.results import DiagnosticsResult, LinkResult, Severity


class ResultSeverityTests(unittest.TestCase):
    def test_warn_when_link_below_gigabit(self):
        result = DiagnosticsResult(
            interface="eth0",
            link=LinkResult(interface="eth0", link_detected=True, speed_mbps=100, duplex="full"),
        )

        self.assertEqual(result.severity, Severity.WARN)

    def test_fail_without_interface(self):
        result = DiagnosticsResult(interface=None, errors=("No network interface found",))

        self.assertEqual(result.severity, Severity.FAIL)


if __name__ == "__main__":
    unittest.main()
