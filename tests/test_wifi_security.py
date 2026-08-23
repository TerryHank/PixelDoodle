from __future__ import annotations

import asyncio
import os
import unittest
from unittest.mock import Mock, patch

from fastapi import HTTPException, Request

import main


def request_with_headers(**headers: str) -> Request:
    raw_headers = [
        (name.replace("_", "-").encode("latin-1"), value.encode("latin-1"))
        for name, value in headers.items()
    ]
    return Request({"type": "http", "method": "POST", "path": "/", "headers": raw_headers})


class WifiSecurityTests(unittest.TestCase):
    def tearDown(self) -> None:
        main.wifi_devices.clear()

    def test_wifi_transport_is_fail_closed_until_device_side_auth_is_enabled(self):
        with patch.dict(
            os.environ,
            {
                "PIXELDOODLE_DEVICE_LOCK_ENABLED": "true",
                "PIXELDOODLE_WIFI_DEVICE_AUTH_ENABLED": "false",
            },
            clear=False,
        ):
            with self.assertRaises(HTTPException) as raised:
                main._require_authenticated_wifi_receiver()
        self.assertEqual(raised.exception.status_code, 503)

    def test_legacy_serial_transport_is_fail_closed_when_paid_lock_is_enabled(self):
        with patch.dict(
            os.environ, {"PIXELDOODLE_DEVICE_LOCK_ENABLED": "true"}, clear=False
        ):
            with self.assertRaises(HTTPException) as raised:
                main._require_paid_serial_transport()
        self.assertEqual(raised.exception.status_code, 503)

    def test_wifi_registry_rejects_public_and_loopback_addresses(self):
        for value in ("8.8.8.8", "127.0.0.1", "169.254.1.1", "::1", "not-an-ip"):
            with self.subTest(value=value), self.assertRaises(HTTPException):
                main._validated_wifi_device_ip(value)
        self.assertEqual(main._validated_wifi_device_ip("192.168.3.112"), "192.168.3.112")

    def test_wifi_registration_requires_admin_and_registered_commerce_device(self):
        data = {"device_uuid": "A1B2C3D4E5F6", "ip": "192.168.3.112"}
        with self.assertRaises(HTTPException) as raised:
            asyncio.run(main._register_wifi_device_impl(data, request_with_headers()))
        self.assertEqual(raised.exception.status_code, 403)

        admin_key = "test-admin-key-at-least-16"
        request = request_with_headers(x_pixeldoodle_admin_key=admin_key)
        with patch.dict(os.environ, {"PIXELDOODLE_ADMIN_KEY": admin_key}, clear=False):
            with patch.object(
                main.business_services.devices,
                "get_enabled",
                side_effect=main.DeviceRegistryError("device is not registered"),
            ):
                with self.assertRaises(HTTPException) as missing:
                    asyncio.run(main._register_wifi_device_impl(data, request))
                self.assertEqual(missing.exception.status_code, 400)

            with patch.object(main.business_services.devices, "get_enabled"):
                result = asyncio.run(main._register_wifi_device_impl(data, request))
        self.assertTrue(result["success"])
        self.assertEqual(main.wifi_devices["A1B2C3D4E5F6"]["ip"], "192.168.3.112")

    def test_authenticated_wifi_forward_includes_device_grant_headers(self):
        device_id = "A1B2C3D4E5F6"
        token = "signed-device-grant"
        main.wifi_devices[device_id] = {"ip": "192.168.3.112", "updated_at": 0}
        response = Mock()
        response.raise_for_status.return_value = None
        data = {
            "device_uuid": device_id,
            "pixel_matrix": [["A1"]],
            "background_color": [0, 0, 0],
        }
        with patch.dict(
            os.environ,
            {
                "PIXELDOODLE_DEVICE_LOCK_ENABLED": "true",
                "PIXELDOODLE_WIFI_DEVICE_AUTH_ENABLED": "true",
            },
            clear=False,
        ), patch.object(
            main, "_authorize_device_command", return_value=(device_id, token)
        ), patch.object(
            main, "_record_device_activation"
        ), patch.object(
            main.requests, "post", return_value=response
        ) as post:
            result = asyncio.run(
                main._send_to_wifi_impl(data, request_with_headers())
            )

        self.assertTrue(result["success"])
        sent_headers = post.call_args.kwargs["headers"]
        self.assertEqual(sent_headers["X-PixelDoodle-Device-Id"], device_id)
        self.assertEqual(sent_headers["X-PixelDoodle-Device-Grant"], token)


if __name__ == "__main__":
    unittest.main()
