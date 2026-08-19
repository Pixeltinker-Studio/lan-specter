import unittest

from specter.network.link import parse_ethtool_output


class LinkParserTests(unittest.TestCase):
    def test_parse_ethtool_link_up(self):
        output = """
Settings for eth0:
        Speed: 1000Mb/s
        Duplex: Full
        Auto-negotiation: on
        Link detected: yes
"""
        result = parse_ethtool_output("eth0", output)

        self.assertEqual(result.interface, "eth0")
        self.assertTrue(result.link_detected)
        self.assertEqual(result.speed_mbps, 1000)
        self.assertEqual(result.duplex, "full")
        self.assertEqual(result.autonegotiation, "on")

    def test_parse_ethtool_link_down(self):
        output = """
Settings for eth0:
        Speed: Unknown!
        Duplex: Unknown! (255)
        Link detected: no
"""
        result = parse_ethtool_output("eth0", output)

        self.assertFalse(result.link_detected)
        self.assertIsNone(result.speed_mbps)
        self.assertEqual(result.duplex, "unknown!")


if __name__ == "__main__":
    unittest.main()
