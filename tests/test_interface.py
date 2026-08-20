import unittest
from unittest.mock import patch

from specter.core.results import CommandResult
from specter.network.interface import choose_internet_interface, get_default_interfaces


class InterfaceSelectionTests(unittest.TestCase):
    @patch("specter.network.interface.run_command")
    def test_default_route_parser_keeps_all_routed_interfaces(self, run_command_mock):
        run_command_mock.return_value = CommandResult(
            command=("ip",),
            returncode=0,
            stdout=(
                "default via 192.168.1.1 dev wlan0 proto dhcp metric 600\n"
                "default via 192.168.1.1 dev end0 proto dhcp metric 100\n"
            ),
            stderr="",
        )

        self.assertEqual(get_default_interfaces(), ("wlan0", "end0"))

    @patch("specter.network.interface.get_default_interfaces", return_value=("wlan0", "end0"))
    def test_internet_speed_prefers_routed_wired_interface(self, _routes):
        self.assertEqual(choose_internet_interface(), "end0")

    @patch("specter.network.interface.get_default_interfaces", return_value=("wlan0",))
    def test_internet_speed_falls_back_to_routed_wifi(self, _routes):
        self.assertEqual(choose_internet_interface(), "wlan0")


if __name__ == "__main__":
    unittest.main()
