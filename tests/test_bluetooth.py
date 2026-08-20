import unittest
from types import SimpleNamespace
from unittest.mock import patch

from specter.hardware.bluetooth import BluetoothScannerService


class BluetoothScannerTests(unittest.TestCase):
    def test_advertisements_are_smoothed_and_sorted_by_signal(self):
        scanner = BluetoothScannerService(stale_after_seconds=30)
        near = SimpleNamespace(address="AA:00:00:00:00:01", name="Near beacon")
        far = SimpleNamespace(address="AA:00:00:00:00:02", name=None)

        scanner.record_advertisement(
            far,
            SimpleNamespace(rssi=-82, local_name="Far beacon", manufacturer_data={}, service_uuids=[]),
        )
        scanner.record_advertisement(
            near,
            SimpleNamespace(rssi=-66, local_name=None, manufacturer_data={76: b"data"}, service_uuids=["180f"]),
        )
        scanner.record_advertisement(
            near,
            SimpleNamespace(rssi=-46, local_name=None, manufacturer_data={76: b"data"}, service_uuids=["180f"]),
        )

        status = scanner.snapshot()

        self.assertEqual([device.address for device in status.devices], [near.address, far.address])
        self.assertEqual(status.devices[0].smoothed_rssi, -59.0)
        self.assertEqual(status.devices[0].trend, "approaching")
        self.assertEqual(status.devices[0].manufacturer_ids, (76,))

    @patch("specter.hardware.bluetooth.monotonic")
    def test_stale_devices_are_removed(self, monotonic_mock):
        monotonic_mock.side_effect = [10.0, 30.1]
        scanner = BluetoothScannerService(stale_after_seconds=15)
        scanner.record_advertisement(
            SimpleNamespace(address="AA:00:00:00:00:01", name="Beacon"),
            SimpleNamespace(rssi=-70, local_name=None, manufacturer_data={}, service_uuids=[]),
        )

        self.assertEqual(scanner.snapshot().devices, ())

    def test_invalid_advertisement_is_ignored(self):
        scanner = BluetoothScannerService()
        scanner.record_advertisement(
            SimpleNamespace(address="", name=None),
            SimpleNamespace(rssi=None, local_name=None, manufacturer_data={}, service_uuids=[]),
        )

        self.assertEqual(scanner.snapshot().devices, ())


if __name__ == "__main__":
    unittest.main()
