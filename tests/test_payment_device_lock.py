from __future__ import annotations

import asyncio
import json
import os
import sqlite3
import tempfile
import unittest
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from core.ble_export import _activate_connected_device, build_device_activation_packets
from core.business_api import create_business_router
from core.commerce.device_grant import (
    GRANT_BYTES,
    GRANT_VERSION,
    DeviceGrantError,
    StaticDeviceSecretProvider,
    create_device_grant,
    decode_and_verify_device_grant,
    token_to_wire_bytes,
)
from core.commerce.payment import (
    PaymentAccessDeniedError,
    PaymentConflictError,
    PaymentService,
)
from core.commerce.payment_provider import PaymentProviderError, SandboxPaymentProvider


DEVICE_ID = "A1B2C3D4E5F6"
USER_ID = "customer-1"


class Clock:
    def __init__(self) -> None:
        self.value = datetime(2026, 8, 23, 8, 0, tzinfo=timezone.utc)

    def __call__(self) -> datetime:
        return self.value

    def advance(self, seconds: int) -> None:
        self.value += timedelta(seconds=seconds)


class PaymentDeviceLockTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.clock = Clock()
        self.provider = SandboxPaymentProvider("sandbox-test-secret")
        self.paid_orders: list[str] = []

        def on_paid(_connection, order: dict) -> None:
            self.paid_orders.append(order["id"])

        self.service = PaymentService(
            {"sandbox": self.provider},
            db_path=Path(self.temp_dir.name) / "business.db",
            device_secrets=StaticDeviceSecretProvider("firmware-test-secret-1234"),
            on_paid=on_paid,
            clock=self.clock,
            grant_delivery_window_seconds=120,
        )

    def tearDown(self):
        self.temp_dir.cleanup()

    def create_order(self, key: str = "request-1") -> dict:
        return self.service.create_order(
            user_id=USER_ID,
            device_id=DEVICE_ID,
            amount_cents=1990,
            idempotency_key=key,
            provider="sandbox",
        )

    def paid_grant(self, duration_seconds: int = 900):
        order = self.create_order()
        self.service.sandbox_pay(order["id"], user_id=USER_ID)
        return order, self.service.issue_device_grant(
            order["id"], user_id=USER_ID, duration_seconds=duration_seconds
        )

    def test_order_creation_is_idempotent_and_parameter_conflicts(self):
        first = self.create_order()
        repeated = self.create_order()
        self.assertEqual(first["id"], repeated["id"])
        self.assertEqual(first["status"], "pending")
        self.assertTrue(first["checkout"]["qr_payload"].endswith(f"/{first['id']}/pay"))

        with self.assertRaises(PaymentConflictError):
            self.service.create_order(
                user_id=USER_ID,
                device_id=DEVICE_ID,
                amount_cents=2990,
                idempotency_key="request-1",
                provider="sandbox",
            )

    def test_sandbox_checkout_url_resolves_to_non_mutating_confirmation_page(self):
        order = self.create_order()
        router = create_business_router(SimpleNamespace(sandbox_payment=True))
        route = next(
            item
            for item in router.routes
            if item.path == "/api/commerce/sandbox/orders/{order_id}/pay"
            and "GET" in item.methods
        )

        response = asyncio.run(route.endpoint(order["id"]))
        body = response.body.decode("utf-8")

        self.assertEqual(response.status_code, 200)
        self.assertIn(order["id"], body)
        self.assertIn("不会完成支付", body)
        self.assertEqual(
            self.service.get_order(order["id"], user_id=USER_ID)["status"],
            "pending",
        )

    def test_signed_webhook_is_idempotent_and_paid_hook_runs_once(self):
        order = self.create_order()
        headers, body = self.provider.build_paid_webhook(order, "event-1")
        first = self.service.handle_webhook("sandbox", headers, body)
        repeated = self.service.handle_webhook("sandbox", headers, body)

        self.assertEqual(first["order"]["status"], "paid")
        self.assertFalse(first["idempotent"])
        self.assertTrue(repeated["idempotent"])
        self.assertEqual(self.paid_orders, [order["id"]])

        changed = json.loads(body)
        changed["amount_cents"] += 1
        tampered = json.dumps(changed, separators=(",", ":")).encode()
        with self.assertRaises(PaymentAccessDeniedError):
            self.service.handle_webhook("sandbox", headers, tampered)

    def test_reused_provider_event_with_different_signed_payload_is_rejected(self):
        order = self.create_order()
        headers, body = self.provider.build_paid_webhook(order, "event-reused")
        self.service.handle_webhook("sandbox", headers, body)
        payload = json.loads(body)
        payload["extra"] = "different"
        changed_body = json.dumps(payload, separators=(",", ":")).encode()
        changed_headers = {"X-PixelDoodle-Signature": self.provider.sign(changed_body)}
        with self.assertRaises(PaymentConflictError):
            self.service.handle_webhook("sandbox", changed_headers, changed_body)

    def test_device_stays_locked_until_paid_then_gets_bound_grant(self):
        order = self.create_order()
        with self.assertRaisesRegex(PaymentAccessDeniedError, "locked"):
            self.service.issue_device_grant(order["id"], user_id=USER_ID)

        self.service.sandbox_pay(order["id"], user_id=USER_ID, event_id="paid-1")
        grant = self.service.issue_device_grant(
            order["id"], user_id=USER_ID, duration_seconds=300
        )
        repeated = self.service.issue_device_grant(
            order["id"], user_id=USER_ID, duration_seconds=300
        )
        self.assertEqual(repeated["access_token"], grant["access_token"])
        self.assertTrue(repeated["idempotent"])

        decoded = decode_and_verify_device_grant(
            grant["access_token"],
            StaticDeviceSecretProvider("firmware-test-secret-1234"),
            expected_device_id=DEVICE_ID,
        )
        self.assertEqual(decoded.duration_seconds, 300)
        self.assertEqual(decoded.not_after_epoch, int(self.clock().timestamp()) + 300)
        self.assertEqual(decoded.grant_sequence, 1)
        with self.assertRaises(PaymentAccessDeniedError):
            self.service.authorize_device_access(
                user_id="customer-2",
                device_id=DEVICE_ID,
                access_token=grant["access_token"],
            )

    def test_v2_wire_contract_contains_expiry_sequence_and_nonce(self):
        _order, grant = self.paid_grant(300)
        wire = token_to_wire_bytes(grant["access_token"])

        self.assertEqual(len(wire), 51)
        self.assertEqual(wire[0], GRANT_VERSION)
        self.assertEqual(wire[1:7], bytes.fromhex(DEVICE_ID))
        self.assertEqual(int.from_bytes(wire[7:11], "little"), 300)
        self.assertEqual(
            int.from_bytes(wire[11:19], "little"), grant["not_after_epoch"]
        )
        self.assertEqual(
            int.from_bytes(wire[19:27], "little"), grant["grant_sequence"]
        )
        self.assertEqual(len(wire[27:35]), 8)
        self.assertEqual(len(wire[35:51]), 16)

    def test_newer_grant_supersedes_old_token_and_high_water_is_durable(self):
        _first_order, first = self.paid_grant(300)
        second_order = self.create_order("request-2")
        self.service.sandbox_pay(second_order["id"], user_id=USER_ID)
        second = self.service.issue_device_grant(
            second_order["id"], user_id=USER_ID, duration_seconds=300
        )

        self.assertEqual(first["grant_sequence"], 1)
        self.assertEqual(second["grant_sequence"], 2)
        with self.assertRaisesRegex(PaymentAccessDeniedError, "superseded"):
            self.service.authorize_device_access(
                user_id=USER_ID,
                device_id=DEVICE_ID,
                access_token=first["access_token"],
            )
        self.service.authorize_device_access(
            user_id=USER_ID,
            device_id=DEVICE_ID,
            access_token=second["access_token"],
        )

        restarted = PaymentService(
            {"sandbox": self.provider},
            db_path=Path(self.temp_dir.name) / "business.db",
            device_secrets=StaticDeviceSecretProvider("firmware-test-secret-1234"),
            clock=self.clock,
            grant_delivery_window_seconds=120,
        )
        third_order = restarted.create_order(
            user_id=USER_ID,
            device_id=DEVICE_ID,
            amount_cents=1990,
            idempotency_key="request-3",
            provider="sandbox",
        )
        restarted.sandbox_pay(third_order["id"], user_id=USER_ID)
        third = restarted.issue_device_grant(
            third_order["id"], user_id=USER_ID, duration_seconds=300
        )
        self.assertEqual(third["grant_sequence"], 3)

        with closing(
            sqlite3.connect(Path(self.temp_dir.name) / "business.db")
        ) as connection:
            high_water = connection.execute(
                "SELECT high_water FROM device_grant_sequences WHERE device_id = ?",
                (DEVICE_ID,),
            ).fetchone()[0]
        self.assertEqual(high_water, 3)

    def test_server_requires_db_record_and_open_delivery_window(self):
        _order, grant = self.paid_grant(300)
        unknown = create_device_grant(
            DEVICE_ID,
            300,
            grant["not_after_epoch"],
            grant["grant_sequence"] + 100,
            StaticDeviceSecretProvider("firmware-test-secret-1234"),
            nonce=b"unknown!",
        )
        with self.assertRaisesRegex(PaymentAccessDeniedError, "unknown or revoked"):
            self.service.authorize_device_access(
                user_id=USER_ID, device_id=DEVICE_ID, access_token=unknown
            )

        self.clock.advance(121)
        with self.assertRaisesRegex(PaymentAccessDeniedError, "delivery window expired"):
            self.service.authorize_device_access(
                user_id=USER_ID,
                device_id=DEVICE_ID,
                access_token=grant["access_token"],
            )

    def test_server_rejects_expired_access_and_redelivery(self):
        order, grant = self.paid_grant(60)
        self.clock.advance(61)
        with self.assertRaisesRegex(PaymentAccessDeniedError, "expired"):
            self.service.authorize_device_access(
                user_id=USER_ID,
                device_id=DEVICE_ID,
                access_token=grant["access_token"],
            )
        self.clock.advance(60)
        with self.assertRaisesRegex(PaymentAccessDeniedError, "delivery window expired"):
            self.service.issue_device_grant(order["id"], user_id=USER_ID)

    def test_ble_packets_reassemble_exact_signed_payload(self):
        _order, grant = self.paid_grant()
        packets = build_device_activation_packets(grant["access_token"])
        self.assertEqual(packets[0], bytes([0x0B, GRANT_BYTES, 0]))
        self.assertEqual(packets[-1], bytes([0x0D]))
        self.assertEqual(
            b"".join(packet[1:] for packet in packets[1:-1]),
            token_to_wire_bytes(grant["access_token"]),
        )

    def test_ble_rejection_is_a_hard_failure(self):
        _order, grant = self.paid_grant()

        class RejectingClient:
            async def start_notify(self, _characteristic, callback):
                self.callback = callback

            async def write_gatt_char(self, _characteristic, packet):
                if packet == bytes([0x0D]):
                    self.callback(None, bytearray([0x27, 0x04]))

            async def stop_notify(self, _characteristic):
                pass

        with self.assertRaisesRegex(PermissionError, "status=4"):
            asyncio.run(
                _activate_connected_device(
                    RejectingClient(), grant["access_token"]
                )
            )

    def test_grant_tampering_and_wrong_device_are_rejected(self):
        _order, grant = self.paid_grant()
        token = grant["access_token"]
        secret = StaticDeviceSecretProvider("firmware-test-secret-1234")
        with self.assertRaisesRegex(DeviceGrantError, "another device"):
            decode_and_verify_device_grant(
                token, secret, expected_device_id="000000000001"
            )
        replacement = "A" if token[-1] != "A" else "B"
        with self.assertRaises(DeviceGrantError):
            decode_and_verify_device_grant(token[:-1] + replacement, secret)

    def test_sandbox_requires_explicit_nonproduction_enablement(self):
        clean_environment = {
            key: value
            for key, value in os.environ.items()
            if key not in {"PIXELDOODLE_SANDBOX_PAYMENT_ENABLED", "PIXELDOODLE_ENV"}
        }
        with patch.dict(os.environ, clean_environment, clear=True):
            with self.assertRaisesRegex(PaymentProviderError, "disabled"):
                SandboxPaymentProvider.from_env()
            os.environ["PIXELDOODLE_SANDBOX_PAYMENT_ENABLED"] = "true"
            os.environ["PIXELDOODLE_ENV"] = " PrOd "
            with self.assertRaisesRegex(PaymentProviderError, "production"):
                SandboxPaymentProvider.from_env()

    def test_device_secret_is_required_for_all_production_aliases(self):
        clean_environment = {
            key: value
            for key, value in os.environ.items()
            if key not in {"PIXELDOODLE_DEVICE_ACTIVATION_SECRET", "PIXELDOODLE_ENV"}
        }
        with patch.dict(os.environ, clean_environment, clear=True):
            for environment in ("prod", " production ", "PROD"):
                os.environ["PIXELDOODLE_ENV"] = environment
                with self.subTest(environment=environment):
                    with self.assertRaisesRegex(DeviceGrantError, "required in production"):
                        StaticDeviceSecretProvider.from_env()


if __name__ == "__main__":
    unittest.main()
