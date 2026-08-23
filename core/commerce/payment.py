"""Payment order state machine and paid device-access issuance."""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import uuid
from collections.abc import Callable, Mapping
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .db import connect, transaction
from .device_grant import (
    MAX_GRANT_SEQUENCE,
    DeviceGrantError,
    DeviceSecretProvider,
    StaticDeviceSecretProvider,
    create_device_grant,
    decode_and_verify_device_grant,
    normalize_device_id,
    token_to_wire_bytes,
)
from .payment_provider import (
    CheckoutRequest,
    PaymentProvider,
    PaymentProviderError,
    SandboxPaymentProvider,
)

USER_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$")
CURRENCY_PATTERN = re.compile(r"^[A-Z]{3}$")


class PaymentDomainError(ValueError):
    """Base class for errors safe to expose as a 4xx API response."""


class PaymentNotFoundError(PaymentDomainError):
    pass


class PaymentConflictError(PaymentDomainError):
    pass


class PaymentAccessDeniedError(PaymentDomainError):
    pass


def _iso(value: datetime) -> str:
    return (
        value.astimezone(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def _parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _user_id(value: str) -> str:
    normalized = (value or "").strip()
    if not USER_ID_PATTERN.fullmatch(normalized):
        raise PaymentDomainError("invalid user_id")
    return normalized


def _public_order(row: sqlite3.Row | Mapping[str, object]) -> dict:
    result = dict(row)
    result["metadata"] = json.loads(str(result.pop("metadata_json") or "{}"))
    result["checkout"] = json.loads(str(result.pop("checkout_payload") or "{}"))
    return result


PAID_HOOK = Callable[[sqlite3.Connection, dict], None]


class PaymentService:
    """Owns durable payment transitions; providers never write the database."""

    def __init__(
        self,
        providers: Mapping[str, PaymentProvider],
        *,
        db_path: str | Path | None = None,
        device_secrets: DeviceSecretProvider | None = None,
        on_paid: PAID_HOOK | None = None,
        clock: Callable[[], datetime] | None = None,
        grant_delivery_window_seconds: int = 600,
    ) -> None:
        self._providers = dict(providers)
        self._db_path = db_path
        self._device_secrets = device_secrets or StaticDeviceSecretProvider.from_env()
        self._on_paid = on_paid
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._grant_delivery_window_seconds = grant_delivery_window_seconds
        self.init_schema()

    def init_schema(self) -> None:
        with closing(connect(self._db_path)) as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS commerce_orders (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    device_id TEXT NOT NULL,
                    merchant_account_id TEXT,
                    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
                    currency TEXT NOT NULL,
                    status TEXT NOT NULL CHECK (
                        status IN ('creating', 'pending', 'paid', 'failed', 'cancelled', 'refunded')
                    ),
                    provider TEXT NOT NULL,
                    provider_order_id TEXT,
                    idempotency_key TEXT NOT NULL,
                    checkout_url TEXT,
                    checkout_payload TEXT NOT NULL DEFAULT '{}',
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    paid_at TEXT,
                    UNIQUE (user_id, idempotency_key)
                );
                CREATE UNIQUE INDEX IF NOT EXISTS idx_commerce_orders_provider_order
                    ON commerce_orders(provider, provider_order_id)
                    WHERE provider_order_id IS NOT NULL;
                CREATE INDEX IF NOT EXISTS idx_commerce_orders_user_created
                    ON commerce_orders(user_id, created_at DESC);

                CREATE TABLE IF NOT EXISTS payment_events (
                    provider TEXT NOT NULL,
                    provider_event_id TEXT NOT NULL,
                    order_id TEXT NOT NULL REFERENCES commerce_orders(id),
                    event_type TEXT NOT NULL,
                    payload_hash TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    received_at TEXT NOT NULL,
                    PRIMARY KEY (provider, provider_event_id)
                );

                CREATE TABLE IF NOT EXISTS device_access_grants (
                    id TEXT PRIMARY KEY,
                    order_id TEXT NOT NULL UNIQUE REFERENCES commerce_orders(id),
                    user_id TEXT NOT NULL,
                    device_id TEXT NOT NULL,
                    nonce_hex TEXT NOT NULL,
                    token_hash TEXT NOT NULL UNIQUE,
                    duration_seconds INTEGER NOT NULL,
                    not_after_epoch INTEGER NOT NULL CHECK (not_after_epoch > 0),
                    grant_sequence INTEGER NOT NULL CHECK (grant_sequence > 0),
                    status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
                    issued_at TEXT NOT NULL,
                    delivery_expires_at TEXT NOT NULL,
                    access_expires_at TEXT NOT NULL,
                    activated_at TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_device_access_lookup
                    ON device_access_grants(user_id, device_id, status, access_expires_at);

                CREATE TABLE IF NOT EXISTS device_grant_sequences (
                    device_id TEXT PRIMARY KEY,
                    high_water INTEGER NOT NULL CHECK (high_water >= 0),
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS commerce_outbox (
                    id TEXT PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    aggregate_id TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    processed_at TEXT,
                    UNIQUE(event_type, aggregate_id)
                );
                """
            )
            self._migrate_device_grants_v2(connection)

    def _migrate_device_grants_v2(self, connection: sqlite3.Connection) -> None:
        """Upgrade local v1 rows and seed the durable per-device high-water mark."""

        columns = {
            row["name"]
            for row in connection.execute("PRAGMA table_info(device_access_grants)")
        }
        if "not_after_epoch" not in columns:
            connection.execute(
                "ALTER TABLE device_access_grants ADD COLUMN not_after_epoch INTEGER"
            )
        if "grant_sequence" not in columns:
            connection.execute(
                "ALTER TABLE device_access_grants ADD COLUMN grant_sequence INTEGER"
            )

        legacy_rows = connection.execute(
            """
            SELECT * FROM device_access_grants
            WHERE not_after_epoch IS NULL OR grant_sequence IS NULL
            ORDER BY device_id, issued_at, id
            """
        ).fetchall()
        next_sequence: dict[str, int] = {}
        for row in legacy_rows:
            device_id = str(row["device_id"])
            if device_id not in next_sequence:
                existing_max = connection.execute(
                    """
                    SELECT COALESCE(MAX(grant_sequence), 0) AS high_water
                    FROM device_access_grants
                    WHERE device_id = ? AND grant_sequence IS NOT NULL
                    """,
                    (device_id,),
                ).fetchone()
                persisted = connection.execute(
                    """
                    SELECT high_water FROM device_grant_sequences
                    WHERE device_id = ?
                    """,
                    (device_id,),
                ).fetchone()
                next_sequence[device_id] = max(
                    int(existing_max["high_water"]),
                    int(persisted["high_water"]) if persisted is not None else 0,
                )
            if next_sequence[device_id] >= MAX_GRANT_SEQUENCE:
                raise PaymentConflictError("device grant sequence exhausted")
            next_sequence[device_id] += 1
            not_after_epoch = int(_parse_iso(row["access_expires_at"]).timestamp())
            token = create_device_grant(
                device_id,
                int(row["duration_seconds"]),
                not_after_epoch,
                next_sequence[device_id],
                self._device_secrets,
                nonce=bytes.fromhex(row["nonce_hex"]),
            )
            decoded = decode_and_verify_device_grant(token, self._device_secrets)
            connection.execute(
                """
                UPDATE device_access_grants
                SET not_after_epoch = ?, grant_sequence = ?, token_hash = ?
                WHERE id = ?
                """,
                (
                    not_after_epoch,
                    next_sequence[device_id],
                    decoded.token_hash,
                    row["id"],
                ),
            )

        now = _iso(self._clock())
        high_waters = connection.execute(
            """
            SELECT device_id, MAX(grant_sequence) AS high_water
            FROM device_access_grants
            WHERE grant_sequence IS NOT NULL
            GROUP BY device_id
            """
        ).fetchall()
        for row in high_waters:
            connection.execute(
                """
                INSERT INTO device_grant_sequences (device_id, high_water, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(device_id) DO UPDATE SET
                    high_water = MAX(device_grant_sequences.high_water, excluded.high_water),
                    updated_at = excluded.updated_at
                """,
                (row["device_id"], row["high_water"], now),
            )
        connection.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_device_grant_sequence
            ON device_access_grants(device_id, grant_sequence)
            """
        )

    def _next_grant_sequence(
        self, connection: sqlite3.Connection, device_id: str, now: datetime
    ) -> int:
        row = connection.execute(
            "SELECT high_water FROM device_grant_sequences WHERE device_id = ?",
            (device_id,),
        ).fetchone()
        if row is None:
            sequence = 1
            connection.execute(
                """
                INSERT INTO device_grant_sequences (device_id, high_water, updated_at)
                VALUES (?, ?, ?)
                """,
                (device_id, sequence, _iso(now)),
            )
            return sequence
        sequence = int(row["high_water"]) + 1
        if sequence > MAX_GRANT_SEQUENCE:
            raise PaymentConflictError("device grant sequence exhausted")
        connection.execute(
            """
            UPDATE device_grant_sequences SET high_water = ?, updated_at = ?
            WHERE device_id = ?
            """,
            (sequence, _iso(now), device_id),
        )
        return sequence

    def create_order(
        self,
        *,
        user_id: str,
        device_id: str,
        amount_cents: int,
        idempotency_key: str,
        provider: str,
        merchant_account_id: str | None = None,
        currency: str = "CNY",
        description: str = "PixelDoodle device session",
        metadata: Mapping[str, object] | None = None,
        expires_in_seconds: int = 900,
    ) -> dict:
        normalized_user = _user_id(user_id)
        normalized_device = normalize_device_id(device_id)
        normalized_currency = currency.strip().upper()
        if not isinstance(amount_cents, int) or not 1 <= amount_cents <= 100_000_000:
            raise PaymentDomainError(
                "amount_cents must be an integer between 1 and 100000000"
            )
        if not CURRENCY_PATTERN.fullmatch(normalized_currency):
            raise PaymentDomainError("currency must be a three-letter uppercase code")
        key = (idempotency_key or "").strip()
        if not 1 <= len(key) <= 128:
            raise PaymentDomainError(
                "idempotency_key is required and must not exceed 128 characters"
            )
        if not 60 <= expires_in_seconds <= 3600:
            raise PaymentDomainError("expires_in_seconds must be between 60 and 3600")
        payment_provider = self._providers.get(provider)
        if payment_provider is None:
            raise PaymentDomainError(f"payment provider is not configured: {provider}")

        now = self._clock()
        order_id = uuid.uuid4().hex
        expires_at = now + timedelta(seconds=expires_in_seconds)
        metadata_json = json.dumps(
            metadata or {}, ensure_ascii=False, separators=(",", ":")
        )
        with closing(connect(self._db_path)) as connection:
            try:
                with transaction(connection):
                    connection.execute(
                        """
                        INSERT INTO commerce_orders (
                            id, user_id, device_id, merchant_account_id, amount_cents,
                            currency, status, provider, idempotency_key, metadata_json,
                            created_at, updated_at, expires_at
                        ) VALUES (?, ?, ?, ?, ?, ?, 'creating', ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            order_id,
                            normalized_user,
                            normalized_device,
                            merchant_account_id,
                            amount_cents,
                            normalized_currency,
                            provider,
                            key,
                            metadata_json,
                            _iso(now),
                            _iso(now),
                            _iso(expires_at),
                        ),
                    )
            except sqlite3.IntegrityError:
                existing = connection.execute(
                    "SELECT * FROM commerce_orders WHERE user_id = ? AND idempotency_key = ?",
                    (normalized_user, key),
                ).fetchone()
                if existing is None:
                    raise
                if (
                    existing["device_id"] != normalized_device
                    or existing["amount_cents"] != amount_cents
                    or existing["currency"] != normalized_currency
                    or existing["provider"] != provider
                ):
                    raise PaymentConflictError(
                        "idempotency_key was already used with different order parameters"
                    )
                return _public_order(existing)

            request = CheckoutRequest(
                order_id=order_id,
                amount_cents=amount_cents,
                currency=normalized_currency,
                description=description,
                expires_at=_iso(expires_at),
            )
            try:
                checkout = payment_provider.create_checkout(request)
                checkout_payload = json.dumps(
                    {"qr_payload": checkout.qr_payload},
                    ensure_ascii=False,
                    separators=(",", ":"),
                )
                with transaction(connection):
                    connection.execute(
                        """
                        UPDATE commerce_orders
                        SET status = 'pending', provider_order_id = ?, checkout_url = ?,
                            checkout_payload = ?, updated_at = ?
                        WHERE id = ? AND status = 'creating'
                        """,
                        (
                            checkout.provider_order_id,
                            checkout.checkout_url,
                            checkout_payload,
                            _iso(self._clock()),
                            order_id,
                        ),
                    )
            except Exception:
                with transaction(connection):
                    connection.execute(
                        "UPDATE commerce_orders SET status = 'failed', updated_at = ? WHERE id = ?",
                        (_iso(self._clock()), order_id),
                    )
                raise

            row = connection.execute(
                "SELECT * FROM commerce_orders WHERE id = ?", (order_id,)
            ).fetchone()
            return _public_order(row)

    def get_order(self, order_id: str, *, user_id: str | None = None) -> dict:
        with closing(connect(self._db_path)) as connection:
            row = connection.execute(
                "SELECT * FROM commerce_orders WHERE id = ?", (order_id,)
            ).fetchone()
        if row is None:
            raise PaymentNotFoundError("payment order not found")
        if user_id is not None and row["user_id"] != _user_id(user_id):
            raise PaymentNotFoundError("payment order not found")
        return _public_order(row)

    def list_orders(self, user_id: str, *, limit: int = 50) -> list[dict]:
        normalized_user = _user_id(user_id)
        safe_limit = max(1, min(int(limit), 100))
        with closing(connect(self._db_path)) as connection:
            rows = connection.execute(
                """
                SELECT * FROM commerce_orders
                WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
                """,
                (normalized_user, safe_limit),
            ).fetchall()
        return [_public_order(row) for row in rows]

    def handle_webhook(
        self,
        provider_name: str,
        headers: Mapping[str, str],
        raw_body: bytes,
    ) -> dict:
        provider = self._providers.get(provider_name)
        if provider is None:
            raise PaymentDomainError(
                f"payment provider is not configured: {provider_name}"
            )
        try:
            event = provider.verify_webhook(headers, raw_body)
        except PaymentProviderError as error:
            raise PaymentAccessDeniedError(str(error)) from error
        if event.event_type != "payment.succeeded":
            raise PaymentDomainError(f"unsupported payment event: {event.event_type}")

        payload_hash = hashlib.sha256(raw_body).hexdigest()
        now_text = _iso(self._clock())
        with closing(connect(self._db_path)) as connection:
            with transaction(connection):
                existing_event = connection.execute(
                    """
                    SELECT payload_hash, order_id FROM payment_events
                    WHERE provider = ? AND provider_event_id = ?
                    """,
                    (provider_name, event.event_id),
                ).fetchone()
                if existing_event is not None:
                    if existing_event["payload_hash"] != payload_hash:
                        raise PaymentConflictError(
                            "provider event id was replayed with a different payload"
                        )
                    row = connection.execute(
                        "SELECT * FROM commerce_orders WHERE id = ?",
                        (existing_event["order_id"],),
                    ).fetchone()
                    return {"order": _public_order(row), "idempotent": True}

                row = connection.execute(
                    "SELECT * FROM commerce_orders WHERE id = ?", (event.order_id,)
                ).fetchone()
                if row is None:
                    raise PaymentNotFoundError("payment order not found")
                if row["provider"] != provider_name:
                    raise PaymentConflictError("payment provider does not match order")
                if row["provider_order_id"] != event.provider_order_id:
                    raise PaymentConflictError("provider order id does not match")
                if (
                    row["amount_cents"] != event.amount_cents
                    or row["currency"] != event.currency
                ):
                    raise PaymentConflictError(
                        "payment amount or currency does not match order"
                    )
                if row["status"] not in {"pending", "paid"}:
                    raise PaymentConflictError(
                        f"order cannot be paid from status {row['status']}"
                    )

                connection.execute(
                    """
                    INSERT INTO payment_events (
                        provider, provider_event_id, order_id, event_type,
                        payload_hash, payload_json, received_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        provider_name,
                        event.event_id,
                        event.order_id,
                        event.event_type,
                        payload_hash,
                        json.dumps(
                            event.raw_payload, ensure_ascii=False, separators=(",", ":")
                        ),
                        now_text,
                    ),
                )
                newly_paid = row["status"] != "paid"
                if newly_paid:
                    connection.execute(
                        """
                        UPDATE commerce_orders
                        SET status = 'paid', paid_at = ?, updated_at = ? WHERE id = ?
                        """,
                        (now_text, now_text, event.order_id),
                    )
                    outbox_payload = {
                        "order_id": event.order_id,
                        "user_id": row["user_id"],
                        "device_id": row["device_id"],
                        "merchant_account_id": row["merchant_account_id"],
                        "amount_cents": row["amount_cents"],
                        "currency": row["currency"],
                        "paid_at": now_text,
                    }
                    connection.execute(
                        """
                        INSERT INTO commerce_outbox (
                            id, event_type, aggregate_id, payload_json, created_at
                        ) VALUES (?, 'payment.paid', ?, ?, ?)
                        """,
                        (
                            uuid.uuid4().hex,
                            event.order_id,
                            json.dumps(
                                outbox_payload,
                                ensure_ascii=False,
                                separators=(",", ":"),
                            ),
                            now_text,
                        ),
                    )
                    if self._on_paid is not None:
                        paid_row = connection.execute(
                            "SELECT * FROM commerce_orders WHERE id = ?",
                            (event.order_id,),
                        ).fetchone()
                        self._on_paid(connection, _public_order(paid_row))

            paid_order = connection.execute(
                "SELECT * FROM commerce_orders WHERE id = ?", (event.order_id,)
            ).fetchone()
        return {"order": _public_order(paid_order), "idempotent": not newly_paid}

    def sandbox_pay(
        self, order_id: str, *, user_id: str, event_id: str | None = None
    ) -> dict:
        order = self.get_order(order_id, user_id=user_id)
        provider = self._providers.get(order["provider"])
        if not isinstance(provider, SandboxPaymentProvider):
            raise PaymentAccessDeniedError(
                "order is not handled by the sandbox provider"
            )
        if order["status"] == "paid":
            return {"order": order, "idempotent": True}
        if order["status"] != "pending":
            raise PaymentConflictError(
                f"sandbox order cannot be paid from status {order['status']}"
            )
        headers, raw_body = provider.build_paid_webhook(
            order, event_id or f"sandbox-event-{uuid.uuid4().hex}"
        )
        return self.handle_webhook(provider.name, headers, raw_body)

    def issue_device_grant(
        self,
        order_id: str,
        *,
        user_id: str,
        duration_seconds: int = 900,
    ) -> dict:
        normalized_user = _user_id(user_id)
        now = self._clock()
        with closing(connect(self._db_path)) as connection:
            with transaction(connection):
                order = connection.execute(
                    "SELECT * FROM commerce_orders WHERE id = ?", (order_id,)
                ).fetchone()
                if order is None or order["user_id"] != normalized_user:
                    raise PaymentNotFoundError("payment order not found")
                if order["status"] != "paid":
                    raise PaymentAccessDeniedError(
                        "device remains locked until payment succeeds"
                    )

                existing = connection.execute(
                    "SELECT * FROM device_access_grants WHERE order_id = ?", (order_id,)
                ).fetchone()
                if existing is not None:
                    if existing["status"] != "active":
                        raise PaymentAccessDeniedError("device grant was revoked")
                    if now >= _parse_iso(existing["delivery_expires_at"]):
                        raise PaymentAccessDeniedError(
                            "device grant delivery window expired; create a new payment order"
                        )
                    if int(now.timestamp()) >= int(existing["not_after_epoch"]):
                        raise PaymentAccessDeniedError(
                            "device access grant expired; create a new payment order"
                        )
                    high_water = connection.execute(
                        """
                        SELECT high_water FROM device_grant_sequences
                        WHERE device_id = ?
                        """,
                        (existing["device_id"],),
                    ).fetchone()
                    if (
                        high_water is None
                        or int(existing["grant_sequence"]) != int(high_water["high_water"])
                    ):
                        raise PaymentAccessDeniedError(
                            "device access grant was superseded by a newer grant"
                        )
                    token = create_device_grant(
                        existing["device_id"],
                        existing["duration_seconds"],
                        int(existing["not_after_epoch"]),
                        int(existing["grant_sequence"]),
                        self._device_secrets,
                        nonce=bytes.fromhex(existing["nonce_hex"]),
                    )
                    if hashlib.sha256(token_to_wire_bytes(token)).hexdigest() != existing[
                        "token_hash"
                    ]:
                        raise PaymentAccessDeniedError(
                            "device access grant does not match its database record"
                        )
                    return self._grant_response(existing, token, idempotent=True)

                grant_sequence = self._next_grant_sequence(
                    connection, order["device_id"], now
                )
                not_after_epoch = int(now.timestamp()) + duration_seconds
                token = create_device_grant(
                    order["device_id"],
                    duration_seconds,
                    not_after_epoch,
                    grant_sequence,
                    self._device_secrets,
                )
                decoded = decode_and_verify_device_grant(
                    token,
                    self._device_secrets,
                    now_epoch=int(now.timestamp()),
                )
                issued_at = _iso(now)
                access_expiry = datetime.fromtimestamp(
                    not_after_epoch, tz=timezone.utc
                )
                delivery_expires_at = _iso(
                    min(
                        now + timedelta(seconds=self._grant_delivery_window_seconds),
                        access_expiry,
                    )
                )
                access_expires_at = _iso(access_expiry)
                grant_id = uuid.uuid4().hex
                connection.execute(
                    """
                    INSERT INTO device_access_grants (
                        id, order_id, user_id, device_id, nonce_hex, token_hash,
                        duration_seconds, not_after_epoch, grant_sequence, status,
                        issued_at, delivery_expires_at, access_expires_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
                    """,
                    (
                        grant_id,
                        order_id,
                        normalized_user,
                        order["device_id"],
                        decoded.nonce_hex,
                        decoded.token_hash,
                        duration_seconds,
                        decoded.not_after_epoch,
                        decoded.grant_sequence,
                        issued_at,
                        delivery_expires_at,
                        access_expires_at,
                    ),
                )
                grant = connection.execute(
                    "SELECT * FROM device_access_grants WHERE id = ?", (grant_id,)
                ).fetchone()
                return self._grant_response(grant, token, idempotent=False)

    @staticmethod
    def _grant_response(grant: sqlite3.Row, token: str, *, idempotent: bool) -> dict:
        return {
            "grant_id": grant["id"],
            "order_id": grant["order_id"],
            "device_id": grant["device_id"],
            "access_token": token,
            "duration_seconds": grant["duration_seconds"],
            "not_after_epoch": grant["not_after_epoch"],
            "grant_sequence": grant["grant_sequence"],
            "delivery_expires_at": grant["delivery_expires_at"],
            "access_expires_at": grant["access_expires_at"],
            "activated_at": grant["activated_at"],
            "idempotent": idempotent,
        }

    def authorize_device_access(
        self,
        *,
        user_id: str,
        device_id: str,
        access_token: str,
    ) -> dict:
        normalized_user = _user_id(user_id)
        normalized_device = normalize_device_id(device_id)
        now = self._clock()
        now_epoch = int(now.timestamp())
        try:
            decoded = decode_and_verify_device_grant(
                access_token,
                self._device_secrets,
                expected_device_id=normalized_device,
                now_epoch=now_epoch,
            )
        except DeviceGrantError as error:
            raise PaymentAccessDeniedError(str(error)) from error
        with closing(connect(self._db_path)) as connection:
            grant = connection.execute(
                """
                SELECT * FROM device_access_grants
                WHERE token_hash = ? AND user_id = ? AND device_id = ?
                """,
                (decoded.token_hash, normalized_user, normalized_device),
            ).fetchone()
            high_water = connection.execute(
                """
                SELECT high_water FROM device_grant_sequences WHERE device_id = ?
                """,
                (normalized_device,),
            ).fetchone()
        if grant is None or grant["status"] != "active":
            raise PaymentAccessDeniedError("device access grant is unknown or revoked")
        if (
            int(grant["duration_seconds"]) != decoded.duration_seconds
            or int(grant["not_after_epoch"]) != decoded.not_after_epoch
            or int(grant["grant_sequence"]) != decoded.grant_sequence
            or str(grant["nonce_hex"]) != decoded.nonce_hex
        ):
            raise PaymentAccessDeniedError(
                "device access grant does not match its database record"
            )
        if high_water is None or decoded.grant_sequence != int(high_water["high_water"]):
            raise PaymentAccessDeniedError(
                "device access grant was superseded by a newer grant"
            )
        if now_epoch >= int(grant["not_after_epoch"]) or now >= _parse_iso(
            grant["access_expires_at"]
        ):
            raise PaymentAccessDeniedError("device access grant expired")
        if now >= _parse_iso(grant["delivery_expires_at"]):
            raise PaymentAccessDeniedError("device access grant delivery window expired")
        return self._grant_response(grant, access_token, idempotent=True)

    def record_device_activation(
        self,
        *,
        user_id: str,
        device_id: str,
        access_token: str,
    ) -> dict:
        grant = self.authorize_device_access(
            user_id=user_id, device_id=device_id, access_token=access_token
        )
        with closing(connect(self._db_path)) as connection:
            with transaction(connection):
                connection.execute(
                    """
                    UPDATE device_access_grants SET activated_at = COALESCE(activated_at, ?)
                    WHERE id = ?
                    """,
                    (_iso(self._clock()), grant["grant_id"]),
                )
                row = connection.execute(
                    "SELECT * FROM device_access_grants WHERE id = ?",
                    (grant["grant_id"],),
                ).fetchone()
        return self._grant_response(
            row, access_token, idempotent=grant["activated_at"] is not None
        )
