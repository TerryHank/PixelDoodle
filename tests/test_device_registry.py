import tempfile
import unittest
from pathlib import Path

from core.commerce.device_registry import (
    DeviceNotRegisteredError,
    SQLiteDeviceCatalog,
)


class DeviceRegistryTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.catalog = SQLiteDeviceCatalog(Path(self.temp_dir.name) / "business.db")

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_server_owned_price_and_merchant_are_persisted(self):
        registered = self.catalog.register(
            device_id="A1B2C3D4E5F6",
            merchant_account_id="merchant-1",
            session_price_cents=299,
        )

        loaded = self.catalog.get_enabled("a1b2c3d4e5f6")
        self.assertEqual(registered, loaded)
        self.assertEqual(loaded.session_price_cents, 299)
        self.assertEqual(loaded.merchant_account_id, "merchant-1")

    def test_disabled_device_cannot_create_a_paid_session(self):
        self.catalog.register(
            device_id="A1B2C3D4E5F6",
            merchant_account_id="merchant-1",
            enabled=False,
        )

        with self.assertRaises(DeviceNotRegisteredError):
            self.catalog.get_enabled("A1B2C3D4E5F6")

    def test_lists_only_the_owners_devices(self):
        self.catalog.register(
            device_id="A1B2C3D4E5F6", merchant_account_id="merchant-1"
        )
        self.catalog.register(
            device_id="010203040506", merchant_account_id="merchant-2"
        )

        self.assertEqual(
            [item.device_id for item in self.catalog.list_owned("merchant-1")],
            ["A1B2C3D4E5F6"],
        )


if __name__ == "__main__":
    unittest.main()
