import unittest
from unittest.mock import patch

from specter.core.results import CommandResult
from specter.network.wifi import parse_access_points, parse_wifi_devices, read_wifi_status, set_wifi_radio, split_escaped_fields


class WifiParserTests(unittest.TestCase):
    @patch("specter.network.wifi.run_command")
    def test_read_wifi_status_uses_networkmanager_measurements(self, run_command_mock):
        run_command_mock.side_effect = [
            CommandResult(command=("nmcli",), returncode=0, stdout="enabled\n", stderr=""),
            CommandResult(command=("nmcli",), returncode=0, stdout="wlan0\twifi\tconnected\tSPECTER LAB\n", stderr=""),
            CommandResult(
                command=("nmcli",),
                returncode=0,
                stdout="*\tAA:BB:CC:DD:EE:01\tSPECTER LAB\tInfra\t36\t5180\t87\tWPA2\n",
                stderr="",
            ),
        ]

        status = read_wifi_status(rescan=True)

        self.assertTrue(status.adapter_available)
        self.assertTrue(status.radio_enabled)
        self.assertEqual(status.interface, "wlan0")
        self.assertEqual(status.connection, "SPECTER LAB")
        self.assertEqual(status.access_points[0].signal_percent, 87)
        self.assertIn("yes", run_command_mock.call_args_list[2].args[0])

    @patch("specter.network.wifi.run_command")
    def test_read_wifi_status_does_not_scan_when_radio_is_disabled(self, run_command_mock):
        run_command_mock.side_effect = [
            CommandResult(command=("nmcli",), returncode=0, stdout="disabled\n", stderr=""),
            CommandResult(command=("nmcli",), returncode=0, stdout="wlan0\twifi\tunavailable\t--\n", stderr=""),
        ]

        status = read_wifi_status(rescan=True)

        self.assertFalse(status.radio_enabled)
        self.assertEqual(status.access_points, ())
        self.assertEqual(run_command_mock.call_count, 2)

    @patch("specter.network.wifi.run_command")
    def test_set_wifi_radio_returns_nmcli_error(self, run_command_mock):
        run_command_mock.return_value = CommandResult(
            command=("nmcli",), returncode=4, stdout="", stderr="Not authorized"
        )

        error = set_wifi_radio(False)

        self.assertEqual(error, "Not authorized")
        self.assertEqual(run_command_mock.call_args.args[0], ("nmcli", "radio", "wifi", "off"))

    def test_split_escaped_fields_preserves_separator_and_backslash(self):
        fields = split_escaped_fields("wlan0\twifi\tconnected\tLab\\\tNetwork\\\\East")

        self.assertEqual(fields, ("wlan0", "wifi", "connected", "Lab\tNetwork\\East"))

    def test_parse_wifi_devices_selects_only_wifi_adapters(self):
        output = "\n".join(
            (
                "eth0\tethernet\tconnected\tWired connection 1",
                "wlan0\twifi\tconnected\tSPECTER LAB",
                "p2p-dev-wlan0\twifi-p2p\tdisconnected\t--",
            )
        )

        self.assertEqual(parse_wifi_devices(output), (("wlan0", "connected", "SPECTER LAB"),))

    def test_parse_access_points_keeps_bssids_and_real_signal_values(self):
        output = "\n".join(
            (
                " \tAA:BB:CC:DD:EE:02\tGuest\tInfra\t11\t2462\t41\tWPA2",
                "*\tAA:BB:CC:DD:EE:01\tSPECTER LAB\tInfra\t36\t5180\t87\tWPA2 WPA3",
                " \tAA:BB:CC:DD:EE:03\t\tInfra\t1\t2412\t120\t--",
            )
        )

        access_points = parse_access_points(output)

        self.assertEqual(len(access_points), 3)
        self.assertTrue(access_points[0].in_use)
        self.assertEqual(access_points[0].ssid, "SPECTER LAB")
        self.assertEqual(access_points[0].band, "5 GHz")
        self.assertEqual(access_points[0].signal_percent, 87)
        hidden = next(access_point for access_point in access_points if access_point.bssid.endswith(":03"))
        self.assertIsNone(hidden.ssid)
        self.assertEqual(hidden.signal_percent, 100)


if __name__ == "__main__":
    unittest.main()
