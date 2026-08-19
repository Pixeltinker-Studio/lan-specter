import unittest

from specter.network.iperf import parse_iperf3_json


class IperfParserTests(unittest.TestCase):
    def test_parse_sum_sent(self):
        payload = """
{
  "end": {
    "sum_sent": {
      "seconds": 5.0001,
      "bytes": 588120000,
      "bits_per_second": 940980000.0,
      "retransmits": 2
    },
    "sum_received": {
      "seconds": 5.0001,
      "bytes": 587900000,
      "bits_per_second": 940620000.0
    }
  }
}
"""
        result = parse_iperf3_json("specter-re01", payload)

        self.assertTrue(result.success)
        self.assertEqual(result.mbps, 940.98)
        self.assertEqual(result.retransmits, 2)
        self.assertEqual(result.seconds, 5.0001)

    def test_parse_error_payload(self):
        result = parse_iperf3_json("specter-re01", '{"error": "unable to connect"}')

        self.assertFalse(result.success)
        self.assertEqual(result.error, "unable to connect")


if __name__ == "__main__":
    unittest.main()
