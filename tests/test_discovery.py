import unittest
from unittest.mock import patch

from specter.core.results import PingResult
from specter.network.discovery import DEFAULT_REMOTE_HOSTNAME, detect_remote, remote_candidates


class DiscoveryTests(unittest.TestCase):
    def test_default_remote_uses_mdns(self):
        self.assertEqual(DEFAULT_REMOTE_HOSTNAME, "specter-re01.local")

    def test_candidates_fall_back_from_mdns_to_plain_hostname(self):
        self.assertEqual(remote_candidates("specter-re01.local"), ("specter-re01.local", "specter-re01"))

    def test_candidates_fall_back_from_plain_hostname_to_mdns(self):
        self.assertEqual(remote_candidates("specter-re01"), ("specter-re01", "specter-re01.local"))

    @patch("specter.network.discovery.ping")
    def test_detect_remote_uses_first_reachable_candidate(self, ping_mock):
        ping_mock.side_effect = [
            PingResult(target="specter-re01", reachable=False),
            PingResult(target="specter-re01.local", reachable=True, avg_latency_ms=0.5),
        ]

        result = detect_remote("specter-re01")

        self.assertTrue(result.reachable)
        self.assertEqual(result.target, "specter-re01.local")


if __name__ == "__main__":
    unittest.main()
