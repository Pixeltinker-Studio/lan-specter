import unittest
from threading import Event
from unittest.mock import patch

from specter.core.results import CommandResult
from specter.network.wifi import (
    WifiConnectRequest,
    WifiConnectResult,
    WifiConnectionService,
    connect_wifi,
    parse_access_points,
    parse_wifi_devices,
    read_wifi_status,
    set_wifi_radio,
    split_escaped_fields,
    validate_wifi_connect_request,
)


class WifiParserTests(unittest.TestCase):
    @patch("specter.network.wifi.run_command")
    def test_read_wifi_status_uses_networkmanager_measurements(self, run_command_mock):
        run_command_mock.side_effect = [
            CommandResult(command=("nmcli",), returncode=0, stdout="enabled\n", stderr=""),
            CommandResult(command=("nmcli",), returncode=0, stdout="wlan0:wifi:connected:SPECTER LAB\n", stderr=""),
            CommandResult(
                command=("nmcli",),
                returncode=0,
                stdout="*:AA\\:BB\\:CC\\:DD\\:EE\\:01:SPECTER LAB:Infra:36:5180:87:WPA2\n",
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
        self.assertNotIn("--separator", run_command_mock.call_args_list[1].args[0])
        self.assertNotIn("--separator", run_command_mock.call_args_list[2].args[0])

    @patch("specter.network.wifi.run_command")
    def test_read_wifi_status_does_not_scan_when_radio_is_disabled(self, run_command_mock):
        run_command_mock.side_effect = [
            CommandResult(command=("nmcli",), returncode=0, stdout="disabled\n", stderr=""),
            CommandResult(command=("nmcli",), returncode=0, stdout="wlan0:wifi:unavailable:--\n", stderr=""),
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
        fields = split_escaped_fields("wlan0:wifi:connected:Lab\\:Network\\\\East")

        self.assertEqual(fields, ("wlan0", "wifi", "connected", "Lab:Network\\East"))

    def test_parse_wifi_devices_selects_only_wifi_adapters(self):
        output = "\n".join(
            (
                "eth0:ethernet:connected:Wired connection 1",
                "wlan0:wifi:connected:SPECTER LAB",
                "p2p-dev-wlan0:wifi-p2p:disconnected:--",
            )
        )

        self.assertEqual(parse_wifi_devices(output), (("wlan0", "connected", "SPECTER LAB"),))

    def test_parse_access_points_keeps_bssids_and_real_signal_values(self):
        output = "\n".join(
            (
                " :AA\\:BB\\:CC\\:DD\\:EE\\:02:Guest:Infra:11:2462:41:WPA2",
                "*:AA\\:BB\\:CC\\:DD\\:EE\\:01:SPECTER LAB:Infra:36:5180:87:WPA2 WPA3",
                " :AA\\:BB\\:CC\\:DD\\:EE\\:03::Infra:1:2412:120:--",
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

    @patch("specter.network.wifi.run_command")
    def test_connect_wifi_uses_selected_adapter_and_access_point(self, run_command_mock):
        run_command_mock.return_value = CommandResult(command=("nmcli",), returncode=0, stdout="", stderr="")
        request = WifiConnectRequest(
            ssid="FIELD-NET",
            bssid="02:00:00:00:00:02",
            security="WPA2",
            password="field-secret",
            interface="wlan0",
        )

        result = connect_wifi(request)

        self.assertTrue(result.success)
        command = run_command_mock.call_args.args[0]
        self.assertEqual(command[command.index("ifname") + 1], "wlan0")
        self.assertEqual(command[command.index("bssid") + 1], "02:00:00:00:00:02")
        self.assertEqual(command[command.index("password") + 1], "field-secret")

    @patch("specter.network.wifi.run_command")
    def test_connect_open_wifi_does_not_add_password_argument(self, run_command_mock):
        run_command_mock.return_value = CommandResult(command=("nmcli",), returncode=0, stdout="", stderr="")

        result = connect_wifi(
            WifiConnectRequest(
                ssid="FIELD-GUEST",
                bssid="02:00:00:00:00:03",
                security="OPEN",
                interface="wlan0",
            )
        )

        self.assertTrue(result.success)
        self.assertNotIn("password", run_command_mock.call_args.args[0])

    def test_enterprise_wifi_requires_a_preconfigured_profile(self):
        error = validate_wifi_connect_request(
            WifiConnectRequest(
                ssid="FIELD-CORP",
                bssid="02:00:00:00:00:04",
                security="WPA2 802.1X",
                password="secret",
            )
        )

        self.assertIn("802.1X", error)

    def test_connection_service_never_exposes_password(self):
        entered = Event()
        release = Event()

        def runner(request):
            entered.set()
            release.wait(timeout=2)
            return WifiConnectResult(True, request.interface, request.ssid)

        service = WifiConnectionService(runner=runner)
        service.start(
            WifiConnectRequest(
                ssid="FIELD-NET",
                bssid="02:00:00:00:00:02",
                security="WPA2",
                password="field-secret",
                interface="wlan0",
            )
        )
        self.assertTrue(entered.wait(timeout=1))

        self.assertNotIn("field-secret", str(service.snapshot()))
        release.set()
        service.stop()


if __name__ == "__main__":
    unittest.main()
