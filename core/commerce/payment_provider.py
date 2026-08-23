"""Replaceable payment-provider contract and a development-only sandbox."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Protocol

from ..auth import is_production_environment


class PaymentProviderError(ValueError):
    """Raised when a provider response cannot be trusted or processed."""


@dataclass(frozen=True)
class CheckoutRequest:
    order_id: str
    amount_cents: int
    currency: str
    description: str
    expires_at: str


@dataclass(frozen=True)
class CheckoutSession:
    provider_order_id: str
    checkout_url: str
    qr_payload: str


@dataclass(frozen=True)
class VerifiedPaymentEvent:
    event_id: str
    order_id: str
    provider_order_id: str
    event_type: str
    amount_cents: int
    currency: str
    raw_payload: dict


class PaymentProvider(Protocol):
    """The only contract a WeChat Pay/Alipay adapter must implement."""

    name: str

    def create_checkout(self, request: CheckoutRequest) -> CheckoutSession:
        """Create a provider-side order and return content suitable for a QR code."""

    def verify_webhook(
        self, headers: Mapping[str, str], raw_body: bytes
    ) -> VerifiedPaymentEvent:
        """Verify signature/decrypt payload and return a normalized event."""


def _header(headers: Mapping[str, str], name: str) -> str:
    wanted = name.lower()
    for key, value in headers.items():
        if key.lower() == wanted:
            return value
    return ""


class SandboxPaymentProvider:
    """Signed fake provider, constructible only when explicitly enabled."""

    name = "sandbox"

    def __init__(self, secret: str, base_url: str = "") -> None:
        if not secret:
            raise PaymentProviderError("sandbox payment secret is required")
        self._secret = secret.encode("utf-8")
        self._base_url = base_url.rstrip("/")

    @classmethod
    def from_env(cls) -> SandboxPaymentProvider:
        enabled = os.environ.get("PIXELDOODLE_SANDBOX_PAYMENT_ENABLED", "").lower()
        if enabled not in {"1", "true", "yes", "on"}:
            raise PaymentProviderError(
                "sandbox payment is disabled; set PIXELDOODLE_SANDBOX_PAYMENT_ENABLED=true"
            )
        if is_production_environment(os.environ):
            raise PaymentProviderError("sandbox payment cannot run in production")
        return cls(
            secret=os.environ.get(
                "PIXELDOODLE_SANDBOX_PAYMENT_SECRET", "local-development-only"
            ),
            base_url=os.environ.get("PIXELDOODLE_PUBLIC_BASE_URL", ""),
        )

    def create_checkout(self, request: CheckoutRequest) -> CheckoutSession:
        provider_order_id = f"sandbox-{request.order_id}"
        path = f"/api/commerce/sandbox/orders/{request.order_id}/pay"
        checkout_url = f"{self._base_url}{path}" if self._base_url else path
        return CheckoutSession(
            provider_order_id=provider_order_id,
            checkout_url=checkout_url,
            qr_payload=checkout_url,
        )

    def sign(self, raw_body: bytes) -> str:
        return hmac.new(self._secret, raw_body, hashlib.sha256).hexdigest()

    def build_paid_webhook(
        self, order: Mapping[str, object], event_id: str
    ) -> tuple[dict, bytes]:
        payload = {
            "event_id": event_id,
            "event_type": "payment.succeeded",
            "order_id": str(order["id"]),
            "provider_order_id": str(order["provider_order_id"]),
            "amount_cents": int(order["amount_cents"]),
            "currency": str(order["currency"]),
        }
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode(
            "utf-8"
        )
        return {"X-PixelDoodle-Signature": self.sign(body)}, body

    def verify_webhook(
        self, headers: Mapping[str, str], raw_body: bytes
    ) -> VerifiedPaymentEvent:
        supplied_signature = _header(headers, "X-PixelDoodle-Signature")
        expected_signature = self.sign(raw_body)
        if not supplied_signature or not hmac.compare_digest(
            supplied_signature, expected_signature
        ):
            raise PaymentProviderError("invalid sandbox webhook signature")

        try:
            payload = json.loads(raw_body)
            event = VerifiedPaymentEvent(
                event_id=str(payload["event_id"]),
                order_id=str(payload["order_id"]),
                provider_order_id=str(payload["provider_order_id"]),
                event_type=str(payload["event_type"]),
                amount_cents=int(payload["amount_cents"]),
                currency=str(payload["currency"]).upper(),
                raw_payload=payload,
            )
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
            raise PaymentProviderError("invalid sandbox webhook payload") from error

        if not event.event_id or not event.order_id or event.amount_cents <= 0:
            raise PaymentProviderError("invalid sandbox webhook fields")
        return event
