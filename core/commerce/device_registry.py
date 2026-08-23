"""Server-owned device pricing and merchant ownership registry."""

from __future__ import annotations

import sqlite3
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from .db import connect, transaction, utc_iso
from .device_grant import DeviceGrantError, normalize_device_id


class DeviceRegistryError(ValueError):
    pass


class DeviceNotRegisteredError(DeviceRegistryError):
    pass


@dataclass(frozen=True)
class CommerceDevice:
    device_id: str
    merchant_account_id: str
    display_name: str
    session_price_cents: int
    currency: str
    enabled: bool
    created_at: str
    updated_at: str

    def to_dict(self) -> dict:
        return {
            "device_id": self.device_id,
            "merchant_account_id": self.merchant_account_id,
            "display_name": self.display_name,
            "session_price_cents": self.session_price_cents,
            "currency": self.currency,
            "enabled": self.enabled,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


class DeviceCatalog(Protocol):
    def get_enabled(self, device_id: str) -> CommerceDevice: ...

    def list_owned(self, merchant_account_id: str) -> list[CommerceDevice]: ...


class SQLiteDeviceCatalog:
    def __init__(self, db_path: str | Path | None = None) -> None:
        self.db_path = db_path
        with closing(connect(db_path)) as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS commerce_devices (
                    device_id TEXT PRIMARY KEY,
                    merchant_account_id TEXT NOT NULL,
                    display_name TEXT NOT NULL,
                    session_price_cents INTEGER NOT NULL CHECK (session_price_cents > 0),
                    currency TEXT NOT NULL,
                    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_commerce_devices_merchant
                    ON commerce_devices(merchant_account_id, updated_at DESC);
                """
            )

    def register(
        self,
        *,
        device_id: str,
        merchant_account_id: str,
        display_name: str = "",
        session_price_cents: int = 100,
        currency: str = "CNY",
        enabled: bool = True,
    ) -> CommerceDevice:
        try:
            normalized_device = normalize_device_id(device_id)
        except DeviceGrantError as error:
            raise DeviceRegistryError(str(error)) from error
        account = merchant_account_id.strip()
        if not account or len(account) > 128:
            raise DeviceRegistryError("merchant_account_id is required")
        name = display_name.strip() or f"PixelDoodle {normalized_device[-4:]}"
        if len(name) > 80:
            raise DeviceRegistryError("display_name must not exceed 80 characters")
        if isinstance(session_price_cents, bool) or not 1 <= int(session_price_cents) <= 100_000_000:
            raise DeviceRegistryError("session_price_cents must be a positive integer")
        normalized_currency = currency.strip().upper()
        if len(normalized_currency) != 3 or not normalized_currency.isalpha():
            raise DeviceRegistryError("currency must be a three-letter code")
        now = utc_iso()

        with closing(connect(self.db_path)) as connection:
            with transaction(connection):
                connection.execute(
                    """
                    INSERT INTO commerce_devices (
                        device_id, merchant_account_id, display_name,
                        session_price_cents, currency, enabled, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(device_id) DO UPDATE SET
                        merchant_account_id = excluded.merchant_account_id,
                        display_name = excluded.display_name,
                        session_price_cents = excluded.session_price_cents,
                        currency = excluded.currency,
                        enabled = excluded.enabled,
                        updated_at = excluded.updated_at
                    """,
                    (
                        normalized_device,
                        account,
                        name,
                        int(session_price_cents),
                        normalized_currency,
                        int(enabled),
                        now,
                        now,
                    ),
                )
            return self._get(connection, normalized_device)

    def _get(self, connection: sqlite3.Connection, device_id: str) -> CommerceDevice:
        row = connection.execute(
            "SELECT * FROM commerce_devices WHERE device_id = ?", (device_id,)
        ).fetchone()
        if row is None:
            raise DeviceNotRegisteredError("device is not registered for paid sessions")
        return CommerceDevice(
            device_id=row["device_id"],
            merchant_account_id=row["merchant_account_id"],
            display_name=row["display_name"],
            session_price_cents=row["session_price_cents"],
            currency=row["currency"],
            enabled=bool(row["enabled"]),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    def get_enabled(self, device_id: str) -> CommerceDevice:
        try:
            normalized_device = normalize_device_id(device_id)
        except DeviceGrantError as error:
            raise DeviceRegistryError(str(error)) from error
        with closing(connect(self.db_path)) as connection:
            device = self._get(connection, normalized_device)
        if not device.enabled:
            raise DeviceNotRegisteredError("device is disabled")
        return device

    def list_owned(self, merchant_account_id: str) -> list[CommerceDevice]:
        account = merchant_account_id.strip()
        if not account:
            raise DeviceRegistryError("merchant_account_id is required")
        with closing(connect(self.db_path)) as connection:
            rows = connection.execute(
                """
                SELECT device_id FROM commerce_devices
                WHERE merchant_account_id = ? ORDER BY updated_at DESC
                """,
                (account,),
            ).fetchall()
            return [self._get(connection, row["device_id"]) for row in rows]


__all__ = [
    "CommerceDevice",
    "DeviceCatalog",
    "DeviceNotRegisteredError",
    "DeviceRegistryError",
    "SQLiteDeviceCatalog",
]
