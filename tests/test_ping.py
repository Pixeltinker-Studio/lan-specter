import unittest

from specter.network.ping import parse_ping_output


class PingParserTests(unittest.TestCase):
    def test_parse_linux_ping_success(self):
        output = """
PING 192.168.1.1 (192.168.1.1) 56(84) bytes of data.
64 bytes from 192.168.1.1: icmp_seq=1 ttl=64 time=0.354 ms
64 bytes from 192.168.1.1: icmp_seq=2 ttl=64 time=0.402 ms

--- 192.168.1.1 ping statistics ---
2 packets transmitted, 2 received, 0% packet loss, time 1001ms
rtt min/avg/max/mdev = 0.354/0.378/0.402/0.024 ms
"""
        result = parse_ping_output("192.168.1.1", output)

        self.assertTrue(result.reachable)
        self.assertEqual(result.transmitted, 2)
        self.assertEqual(result.received, 2)
        self.assertEqual(result.packet_loss_percent, 0.0)
        self.assertEqual(result.avg_latency_ms, 0.378)

    def test_parse_linux_ping_loss(self):
        output = """
--- 192.168.1.99 ping statistics ---
2 packets transmitted, 0 received, 100% packet loss, time 1025ms
"""
        result = parse_ping_output("192.168.1.99", output, returncode=1)

        self.assertFalse(result.reachable)
        self.assertEqual(result.packet_loss_percent, 100.0)


if __name__ == "__main__":
    unittest.main()
