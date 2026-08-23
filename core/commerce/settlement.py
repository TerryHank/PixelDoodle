"""Revenue allocation and payout settlement domain.

The payment domain owns ``commerce_orders``.  This module records an immutable
snapshot only after a caller has confirmed an order as paid.  It deliberately
does not know how a payment provider or merchant account is implemented.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import sqlite3
import uuid
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterator, Protocol, Sequence

from .db import connect, utc_iso


class SettlementError(RuntimeError):
    """Base error for the settlement domain."""


class SettlementValidationError(SettlementError, ValueError):
    """Raised when an allocation or settlement request is invalid."""


class SettlementIdempotencyConflict(SettlementError):
    """Raised when an idempotency key is reused for different input."""


class NothingToSettle(SettlementError):
    """Raised when an account has no earnings eligible for payout."""


class SettlementBatchNotFound(SettlementError):
    """Raised when a payout batch does not exist."""


class PayoutSubmissionError(SettlementError):
    """Raised when the provider outcome is unknown and the batch needs retry."""


@dataclass(frozen=True)
class ShareRuleLine:
    """One recipient in a revenue-sharing rule, expressed in basis points."""

    account_id: str
    role: str
    basis_points: int


@dataclass(frozen=True)
class PayoutLine:
    allocation_id: str
    order_id: str
    amount_cents: int


@dataclass(frozen=True)
class PayoutRequest:
    batch_id: str
    idempotency_key: str
    account_id: str
    currency: str
    amount_cents: int
    lines: tuple[PayoutLine, ...]


@dataclass(frozen=True)
class PayoutResult:
    """Provider result.  ``pending`` is finalized later by a provider event."""

    status: str
    provider_reference: str | None = None
    failure_reason: str | None = None


class PayoutProvider(Protocol):
    """Adapter implemented by a real bank, wallet, or merchant payout service."""

    name: str

    def submit(self, request: PayoutRequest) -> PayoutResult:
        """Submit idempotently using ``request.idempotency_key``."""


class SandboxPayoutProvider:
    """Deterministic local provider used for development and acceptance tests."""

    name = "sandbox"

    def __init__(self, result_status: str = "succeeded") -> None:
        if result_status not in {"succeeded", "pending", "failed"}:
            raise ValueError("invalid sandbox payout status")
        self.result_status = result_status

    def submit(self, request: PayoutRequest) -> PayoutResult:
        reference = "sandbox_" + hashlib.sha256(
            request.idempotency_key.encode("utf-8")
        ).hexdigest()[:24]
        return PayoutResult(
            status=self.result_status,
            provider_reference=reference,
            failure_reason=(
                "sandbox payout rejected" if self.result_status == "failed" else None
            ),
        )


_SCHEMA = """
CREATE TABLE IF NOT EXISTS revenue_orders (
    order_id TEXT PRIMARY KEY,
    payer_user_id TEXT NOT NULL,
    merchant_account_id TEXT NOT NULL,
    gross_cents INTEGER NOT NULL CHECK (gross_cents > 0),
    currency TEXT NOT NULL,
    rule_name TEXT NOT NULL,
    rule_snapshot_json TEXT NOT NULL,
    input_fingerprint TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    recorded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS revenue_allocations (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES revenue_orders(order_id) ON DELETE RESTRICT,
    line_number INTEGER NOT NULL,
    account_id TEXT NOT NULL,
    role TEXT NOT NULL,
    basis_points INTEGER NOT NULL CHECK (basis_points > 0 AND basis_points <= 10000),
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    currency TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (order_id, line_number),
    UNIQUE (order_id, account_id, role)
);

CREATE TABLE IF NOT EXISTS settlement_batches (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    account_id TEXT NOT NULL,
    currency TEXT NOT NULL,
    provider TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'succeeded', 'failed')),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    item_count INTEGER NOT NULL CHECK (item_count > 0),
    provider_reference TEXT,
    failure_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    finalized_at TEXT
);

CREATE TABLE IF NOT EXISTS settlement_items (
    id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL REFERENCES settlement_batches(id) ON DELETE RESTRICT,
    allocation_id TEXT NOT NULL REFERENCES revenue_allocations(id) ON DELETE RESTRICT,
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'succeeded', 'failed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (batch_id, allocation_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS settlement_one_active_claim
ON settlement_items(allocation_id)
WHERE status IN ('pending', 'processing', 'succeeded');

CREATE TABLE IF NOT EXISTS settlement_provider_events (
    provider TEXT NOT NULL,
    event_id TEXT NOT NULL,
    batch_id TEXT NOT NULL REFERENCES settlement_batches(id) ON DELETE RESTRICT,
    payload_fingerprint TEXT NOT NULL,
    received_at TEXT NOT NULL,
    PRIMARY KEY (provider, event_id)
);

CREATE INDEX IF NOT EXISTS revenue_allocations_account_idx
ON revenue_allocations(account_id, currency, created_at);

CREATE INDEX IF NOT EXISTS settlement_items_allocation_idx
ON settlement_items(allocation_id, status);

CREATE TRIGGER IF NOT EXISTS revenue_orders_no_update
BEFORE UPDATE ON revenue_orders
BEGIN SELECT RAISE(ABORT, 'revenue order snapshots are immutable'); END;

CREATE TRIGGER IF NOT EXISTS revenue_orders_no_delete
BEFORE DELETE ON revenue_orders
BEGIN SELECT RAISE(ABORT, 'revenue order snapshots are immutable'); END;

CREATE TRIGGER IF NOT EXISTS revenue_allocations_no_update
BEFORE UPDATE ON revenue_allocations
BEGIN SELECT RAISE(ABORT, 'revenue allocations are immutable'); END;

CREATE TRIGGER IF NOT EXISTS revenue_allocations_no_delete
BEFORE DELETE ON revenue_allocations
BEGIN SELECT RAISE(ABORT, 'revenue allocations are immutable'); END;
"""


@contextmanager
def _atomic(connection: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    """Use a transaction, or a savepoint when called by the payment transaction."""

    if connection.in_transaction:
        savepoint = "settlement_" + uuid.uuid4().hex
        connection.execute(f"SAVEPOINT {savepoint}")
        try:
            yield connection
        except BaseException:
            connection.execute(f"ROLLBACK TO {savepoint}")
            connection.execute(f"RELEASE {savepoint}")
            raise
        else:
            connection.execute(f"RELEASE {savepoint}")
        return

    connection.execute("BEGIN IMMEDIATE")
    try:
        yield connection
    except BaseException:
        connection.rollback()
        raise
    else:
        connection.commit()


@contextmanager
def _connection(
    db_path: str | Path | None,
    existing: sqlite3.Connection | None = None,
) -> Iterator[sqlite3.Connection]:
    if existing is not None:
        yield existing
        return
    connection = connect(db_path)
    try:
        yield connection
    finally:
        connection.close()


def _required_text(value: str, field: str, max_length: int = 200) -> str:
    normalized = str(value).strip()
    if not normalized:
        raise SettlementValidationError(f"{field} is required")
    if len(normalized) > max_length:
        raise SettlementValidationError(f"{field} is too long")
    return normalized


def _currency(value: str) -> str:
    normalized = _required_text(value, "currency", 3).upper()
    if len(normalized) != 3 or not normalized.isalpha():
        raise SettlementValidationError("currency must be a three-letter code")
    return normalized


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _fingerprint(value: Any) -> str:
    return hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def _scoped_idempotency_key(account_id: str, client_key: str) -> str:
    """Prevent one account from reserving another account's client key."""
    material = f"{account_id}\0{client_key}".encode("utf-8")
    return "acct_" + hashlib.sha256(material).hexdigest()


def _normalize_rule(lines: Sequence[ShareRuleLine]) -> tuple[ShareRuleLine, ...]:
    if not lines:
        raise SettlementValidationError("at least one share rule line is required")
    normalized: list[ShareRuleLine] = []
    identities: set[tuple[str, str]] = set()
    for line in lines:
        account_id = _required_text(line.account_id, "account_id")
        role = _required_text(line.role, "role", 50)
        basis_points = int(line.basis_points)
        if basis_points <= 0 or basis_points > 10000:
            raise SettlementValidationError("basis_points must be between 1 and 10000")
        identity = (account_id, role)
        if identity in identities:
            raise SettlementValidationError("duplicate account and role in share rule")
        identities.add(identity)
        normalized.append(ShareRuleLine(account_id, role, basis_points))
    if sum(line.basis_points for line in normalized) != 10000:
        raise SettlementValidationError("share rule basis points must total 10000")
    return tuple(normalized)


def allocate_cents(
    gross_cents: int, lines: Sequence[ShareRuleLine]
) -> tuple[int, ...]:
    """Allocate every cent using the deterministic largest-remainder method."""

    gross_cents = int(gross_cents)
    if gross_cents <= 0:
        raise SettlementValidationError("gross_cents must be greater than zero")
    normalized = _normalize_rule(lines)
    numerators = [gross_cents * line.basis_points for line in normalized]
    amounts = [numerator // 10000 for numerator in numerators]
    remainder_count = gross_cents - sum(amounts)
    ranked = sorted(
        range(len(normalized)),
        key=lambda index: (-(numerators[index] % 10000), index),
    )
    for index in ranked[:remainder_count]:
        amounts[index] += 1
    if sum(amounts) != gross_cents:
        raise AssertionError("allocated cents do not conserve the order total")
    return tuple(amounts)


def standard_merchant_rule(
    merchant_account_id: str,
    *,
    platform_account_id: str = "platform",
    merchant_basis_points: int = 8000,
) -> tuple[ShareRuleLine, ShareRuleLine]:
    """Convenience helper; production callers should persist their chosen rule."""

    merchant_basis_points = int(merchant_basis_points)
    return _normalize_rule(
        (
            ShareRuleLine(merchant_account_id, "merchant", merchant_basis_points),
            ShareRuleLine(
                platform_account_id, "platform", 10000 - merchant_basis_points
            ),
        )
    )  # type: ignore[return-value]


class SettlementService:
    """SQLite-backed allocation ledger and payout orchestrator."""

    def __init__(
        self,
        db_path: str | Path | None = None,
        *,
        payout_provider: PayoutProvider | None = None,
        now: Callable[[], str] = utc_iso,
    ) -> None:
        self.db_path = db_path
        self.payout_provider = payout_provider or SandboxPayoutProvider()
        self._now = now
        connection = connect(db_path)
        try:
            connection.executescript(_SCHEMA)
        finally:
            connection.close()

    def record_paid_order(
        self,
        *,
        order_id: str,
        payer_user_id: str,
        merchant_account_id: str,
        gross_cents: int,
        rule_lines: Sequence[ShareRuleLine],
        currency: str = "CNY",
        rule_name: str = "default",
        occurred_at: str | None = None,
        connection: sqlite3.Connection | None = None,
    ) -> dict[str, Any]:
        """Record exactly one immutable allocation snapshot for a paid order."""

        order_id = _required_text(order_id, "order_id")
        payer_user_id = _required_text(payer_user_id, "payer_user_id")
        merchant_account_id = _required_text(
            merchant_account_id, "merchant_account_id"
        )
        rule_name = _required_text(rule_name, "rule_name", 100)
        currency = _currency(currency)
        gross_cents = int(gross_cents)
        if gross_cents <= 0:
            raise SettlementValidationError("gross_cents must be greater than zero")
        normalized_rule = _normalize_rule(rule_lines)
        amounts = allocate_cents(gross_cents, normalized_rule)
        rule_snapshot = {
            "version": 1,
            "name": rule_name,
            "lines": [asdict(line) for line in normalized_rule],
        }
        occurred_at = occurred_at or self._now()
        input_snapshot = {
            "order_id": order_id,
            "payer_user_id": payer_user_id,
            "merchant_account_id": merchant_account_id,
            "gross_cents": gross_cents,
            "currency": currency,
            "rule": rule_snapshot,
        }
        input_fingerprint = _fingerprint(input_snapshot)

        with _connection(self.db_path, connection) as opened:
            with _atomic(opened):
                existing = opened.execute(
                    "SELECT input_fingerprint FROM revenue_orders WHERE order_id = ?",
                    (order_id,),
                ).fetchone()
                if existing:
                    if existing["input_fingerprint"] != input_fingerprint:
                        raise SettlementIdempotencyConflict(
                            "order_id was already allocated with different input"
                        )
                    return self._get_revenue_order(opened, order_id)

                recorded_at = self._now()
                opened.execute(
                    """
                    INSERT INTO revenue_orders (
                        order_id, payer_user_id, merchant_account_id, gross_cents,
                        currency, rule_name, rule_snapshot_json, input_fingerprint,
                        occurred_at, recorded_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        order_id,
                        payer_user_id,
                        merchant_account_id,
                        gross_cents,
                        currency,
                        rule_name,
                        _canonical_json(rule_snapshot),
                        input_fingerprint,
                        occurred_at,
                        recorded_at,
                    ),
                )
                for line_number, (line, amount_cents) in enumerate(
                    zip(normalized_rule, amounts, strict=True)
                ):
                    opened.execute(
                        """
                        INSERT INTO revenue_allocations (
                            id, order_id, line_number, account_id, role,
                            basis_points, amount_cents, currency, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            uuid.uuid4().hex,
                            order_id,
                            line_number,
                            line.account_id,
                            line.role,
                            line.basis_points,
                            amount_cents,
                            currency,
                            recorded_at,
                        ),
                    )
                return self._get_revenue_order(opened, order_id)

    def _get_revenue_order(
        self, connection: sqlite3.Connection, order_id: str
    ) -> dict[str, Any]:
        row = connection.execute(
            "SELECT * FROM revenue_orders WHERE order_id = ?", (order_id,)
        ).fetchone()
        if row is None:
            raise SettlementValidationError("revenue order does not exist")
        allocations = connection.execute(
            """
            SELECT id, line_number, account_id, role, basis_points, amount_cents,
                   currency, created_at
            FROM revenue_allocations
            WHERE order_id = ?
            ORDER BY line_number
            """,
            (order_id,),
        ).fetchall()
        return {
            "order_id": row["order_id"],
            "payer_user_id": row["payer_user_id"],
            "merchant_account_id": row["merchant_account_id"],
            "gross_cents": row["gross_cents"],
            "currency": row["currency"],
            "rule_name": row["rule_name"],
            "rule_snapshot": json.loads(row["rule_snapshot_json"]),
            "occurred_at": row["occurred_at"],
            "recorded_at": row["recorded_at"],
            "allocations": [dict(allocation) for allocation in allocations],
        }

    def get_revenue_order(self, order_id: str) -> dict[str, Any]:
        order_id = _required_text(order_id, "order_id")
        with _connection(self.db_path) as connection:
            return self._get_revenue_order(connection, order_id)

    def create_settlement_batch(
        self,
        *,
        account_id: str,
        idempotency_key: str,
        currency: str = "CNY",
        minimum_cents: int = 1,
        max_items: int = 1000,
    ) -> dict[str, Any]:
        account_id = _required_text(account_id, "account_id")
        client_idempotency_key = _required_text(idempotency_key, "idempotency_key")
        idempotency_key = _scoped_idempotency_key(
            account_id, client_idempotency_key
        )
        currency = _currency(currency)
        minimum_cents = max(1, int(minimum_cents))
        max_items = int(max_items)
        if max_items <= 0 or max_items > 10000:
            raise SettlementValidationError("max_items must be between 1 and 10000")

        with _connection(self.db_path) as connection:
            with _atomic(connection):
                existing = connection.execute(
                    """
                    SELECT * FROM settlement_batches
                    WHERE account_id = ? AND idempotency_key IN (?, ?)
                    ORDER BY CASE WHEN idempotency_key = ? THEN 0 ELSE 1 END
                    LIMIT 1
                    """,
                    (
                        account_id,
                        idempotency_key,
                        client_idempotency_key,
                        idempotency_key,
                    ),
                ).fetchone()
                if existing:
                    if (
                        existing["account_id"] != account_id
                        or existing["currency"] != currency
                        or existing["provider"] != self.payout_provider.name
                    ):
                        raise SettlementIdempotencyConflict(
                            "idempotency_key was reused for a different settlement"
                        )
                    return self._get_batch(connection, existing["id"])

                allocations = connection.execute(
                    """
                    SELECT allocation.*
                    FROM revenue_allocations AS allocation
                    WHERE allocation.account_id = ? AND allocation.currency = ?
                      AND NOT EXISTS (
                          SELECT 1 FROM settlement_items AS item
                          WHERE item.allocation_id = allocation.id
                            AND item.status IN ('pending', 'processing', 'succeeded')
                      )
                    ORDER BY allocation.created_at, allocation.id
                    LIMIT ?
                    """,
                    (account_id, currency, max_items),
                ).fetchall()
                amount_cents = sum(row["amount_cents"] for row in allocations)
                if not allocations or amount_cents < minimum_cents:
                    raise NothingToSettle("account has no earnings above the threshold")

                batch_id = uuid.uuid4().hex
                created_at = self._now()
                connection.execute(
                    """
                    INSERT INTO settlement_batches (
                        id, idempotency_key, account_id, currency, provider, status,
                        amount_cents, item_count, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
                    """,
                    (
                        batch_id,
                        idempotency_key,
                        account_id,
                        currency,
                        self.payout_provider.name,
                        amount_cents,
                        len(allocations),
                        created_at,
                        created_at,
                    ),
                )
                for allocation in allocations:
                    connection.execute(
                        """
                        INSERT INTO settlement_items (
                            id, batch_id, allocation_id, amount_cents, status,
                            created_at, updated_at
                        ) VALUES (?, ?, ?, ?, 'pending', ?, ?)
                        """,
                        (
                            uuid.uuid4().hex,
                            batch_id,
                            allocation["id"],
                            allocation["amount_cents"],
                            created_at,
                            created_at,
                        ),
                    )
                return self._get_batch(connection, batch_id)

    def execute_settlement_batch(self, batch_id: str) -> dict[str, Any]:
        """Submit a batch; unknown provider outcomes remain claimed for safe retry."""

        batch_id = _required_text(batch_id, "batch_id")
        with _connection(self.db_path) as connection:
            with _atomic(connection):
                batch = self._get_batch(connection, batch_id)
                if batch["provider"] != self.payout_provider.name:
                    raise SettlementValidationError(
                        "configured payout provider does not own this batch"
                    )
                if batch["status"] in {"succeeded", "failed"}:
                    return batch
                now = self._now()
                connection.execute(
                    """
                    UPDATE settlement_batches
                    SET status = 'processing', updated_at = ?
                    WHERE id = ? AND status IN ('pending', 'processing')
                    """,
                    (now, batch_id),
                )
                connection.execute(
                    """
                    UPDATE settlement_items
                    SET status = 'processing', updated_at = ?
                    WHERE batch_id = ? AND status IN ('pending', 'processing')
                    """,
                    (now, batch_id),
                )
                batch = self._get_batch(connection, batch_id)

            request = PayoutRequest(
                batch_id=batch["id"],
                idempotency_key=batch["idempotency_key"],
                account_id=batch["account_id"],
                currency=batch["currency"],
                amount_cents=batch["amount_cents"],
                lines=tuple(
                    PayoutLine(
                        allocation_id=item["allocation_id"],
                        order_id=item["order_id"],
                        amount_cents=item["amount_cents"],
                    )
                    for item in batch["items"]
                ),
            )
            try:
                result = self.payout_provider.submit(request)
            except Exception as error:
                self._record_submission_exception(connection, batch_id, error)
                raise PayoutSubmissionError(
                    "payout provider response is unknown; retry this batch with "
                    "the same idempotency key"
                ) from error
            return self._apply_result(connection, batch_id, result)

    def _record_submission_exception(
        self,
        connection: sqlite3.Connection,
        batch_id: str,
        error: Exception,
    ) -> None:
        """Keep allocations claimed while persisting enough state to recover."""

        reason = f"{type(error).__name__}: {error}".strip()[:500]
        now = self._now()
        with _atomic(connection):
            connection.execute(
                """
                UPDATE settlement_batches
                SET failure_reason = ?, updated_at = ?
                WHERE id = ? AND status = 'processing'
                """,
                (reason, now, batch_id),
            )
            connection.execute(
                """
                UPDATE settlement_items
                SET updated_at = ?
                WHERE batch_id = ? AND status = 'processing'
                """,
                (now, batch_id),
            )

    def retry_processing_batches(
        self,
        *,
        stale_after_seconds: int = 300,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """Retry stale uncertain/pending batches using their original provider key.

        Provider exceptions are represented by the still-processing batch so a
        scheduler can continue with other batches and retry again later.
        """

        stale_after_seconds = int(stale_after_seconds)
        if stale_after_seconds < 0 or stale_after_seconds > 86400 * 30:
            raise SettlementValidationError(
                "stale_after_seconds must be between 0 and 2592000"
            )
        limit = min(1000, max(1, int(limit)))
        cutoff = self._stale_cutoff(stale_after_seconds)
        with _connection(self.db_path) as connection:
            rows = connection.execute(
                """
                SELECT id
                FROM settlement_batches
                WHERE provider = ? AND status = 'processing' AND updated_at <= ?
                ORDER BY updated_at, id
                LIMIT ?
                """,
                (self.payout_provider.name, cutoff, limit),
            ).fetchall()

        results: list[dict[str, Any]] = []
        for row in rows:
            try:
                results.append(self.execute_settlement_batch(row["id"]))
            except PayoutSubmissionError:
                results.append(self.get_settlement_batch(row["id"]))
        return results

    def _stale_cutoff(self, stale_after_seconds: int) -> str:
        try:
            now = datetime.fromisoformat(self._now().replace("Z", "+00:00"))
        except ValueError as error:
            raise SettlementValidationError("now() must return an ISO-8601 timestamp") from error
        if now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)
        return (
            (now.astimezone(timezone.utc) - timedelta(seconds=stale_after_seconds))
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z")
        )

    def apply_provider_event(
        self,
        *,
        provider: str,
        event_id: str,
        batch_id: str,
        result: PayoutResult,
    ) -> dict[str, Any]:
        """Apply a verified asynchronous provider event exactly once."""

        provider = _required_text(provider, "provider", 100)
        event_id = _required_text(event_id, "event_id")
        batch_id = _required_text(batch_id, "batch_id")
        payload_fingerprint = _fingerprint(asdict(result))
        with _connection(self.db_path) as connection:
            with _atomic(connection):
                batch = self._get_batch(connection, batch_id)
                if batch["provider"] != provider:
                    raise SettlementValidationError("provider does not own this batch")
                existing = connection.execute(
                    """
                    SELECT batch_id, payload_fingerprint
                    FROM settlement_provider_events
                    WHERE provider = ? AND event_id = ?
                    """,
                    (provider, event_id),
                ).fetchone()
                if existing:
                    if (
                        existing["batch_id"] != batch_id
                        or existing["payload_fingerprint"] != payload_fingerprint
                    ):
                        raise SettlementIdempotencyConflict(
                            "provider event id was reused with different input"
                        )
                    return batch
                connection.execute(
                    """
                    INSERT INTO settlement_provider_events (
                        provider, event_id, batch_id, payload_fingerprint, received_at
                    ) VALUES (?, ?, ?, ?, ?)
                    """,
                    (provider, event_id, batch_id, payload_fingerprint, self._now()),
                )
                return self._apply_result(connection, batch_id, result, atomic=False)

    def _apply_result(
        self,
        connection: sqlite3.Connection,
        batch_id: str,
        result: PayoutResult,
        *,
        atomic: bool = True,
    ) -> dict[str, Any]:
        if result.status not in {"succeeded", "pending", "failed"}:
            raise SettlementValidationError("invalid payout provider status")

        @contextmanager
        def optional_transaction() -> Iterator[None]:
            if atomic:
                with _atomic(connection):
                    yield
            else:
                yield

        with optional_transaction():
            current = self._get_batch(connection, batch_id)
            if current["status"] in {"succeeded", "failed"}:
                expected = current["status"]
                if result.status != expected:
                    raise SettlementValidationError(
                        f"cannot change finalized settlement from {expected}"
                    )
                return current
            stored_status = "processing" if result.status == "pending" else result.status
            now = self._now()
            finalized_at = now if stored_status in {"succeeded", "failed"} else None
            connection.execute(
                """
                UPDATE settlement_batches
                SET status = ?, provider_reference = COALESCE(?, provider_reference),
                    failure_reason = ?, updated_at = ?, finalized_at = ?
                WHERE id = ?
                """,
                (
                    stored_status,
                    result.provider_reference,
                    result.failure_reason,
                    now,
                    finalized_at,
                    batch_id,
                ),
            )
            connection.execute(
                """
                UPDATE settlement_items
                SET status = ?, updated_at = ?
                WHERE batch_id = ?
                """,
                (stored_status, now, batch_id),
            )
            return self._get_batch(connection, batch_id)

    def _get_batch(
        self, connection: sqlite3.Connection, batch_id: str
    ) -> dict[str, Any]:
        row = connection.execute(
            "SELECT * FROM settlement_batches WHERE id = ?", (batch_id,)
        ).fetchone()
        if row is None:
            raise SettlementBatchNotFound("settlement batch does not exist")
        items = connection.execute(
            """
            SELECT item.id, item.allocation_id, allocation.order_id,
                   item.amount_cents, item.status, item.created_at, item.updated_at
            FROM settlement_items AS item
            JOIN revenue_allocations AS allocation ON allocation.id = item.allocation_id
            WHERE item.batch_id = ?
            ORDER BY item.created_at, item.id
            """,
            (batch_id,),
        ).fetchall()
        result = dict(row)
        result["items"] = [dict(item) for item in items]
        return result

    def get_settlement_batch(self, batch_id: str) -> dict[str, Any]:
        with _connection(self.db_path) as connection:
            return self._get_batch(
                connection, _required_text(batch_id, "batch_id")
            )

    def list_earnings(
        self,
        *,
        account_id: str,
        currency: str | None = None,
        status: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> dict[str, Any]:
        account_id = _required_text(account_id, "account_id")
        currency = _currency(currency) if currency else None
        if status not in {None, "available", "processing", "settled"}:
            raise SettlementValidationError("invalid earnings status")
        limit = min(1000, max(1, int(limit)))
        offset = max(0, int(offset))
        with _connection(self.db_path) as connection:
            items = self._query_earnings(
                connection,
                account_id=account_id,
                currency=currency,
                status=status,
                limit=limit,
                offset=offset,
            )
            all_rows = self._query_earnings(
                connection,
                account_id=account_id,
                currency=currency,
                status=status,
                limit=None,
                offset=0,
            )
        summary: dict[str, dict[str, int]] = {}
        for row in all_rows:
            currency_summary = summary.setdefault(
                row["currency"],
                {
                    "available_cents": 0,
                    "processing_cents": 0,
                    "settled_cents": 0,
                    "total_cents": 0,
                },
            )
            amount_cents = row["share_cents"]
            currency_summary[f"{row['status']}_cents"] += amount_cents
            currency_summary["total_cents"] += amount_cents
        return {"items": items, "summary": summary, "total": len(all_rows)}

    def _query_earnings(
        self,
        connection: sqlite3.Connection,
        *,
        account_id: str,
        currency: str | None,
        status: str | None,
        limit: int | None,
        offset: int,
    ) -> list[dict[str, Any]]:
        sql = """
        WITH earnings AS (
            SELECT
                allocation.id AS allocation_id,
                allocation.order_id,
                allocation.account_id,
                allocation.role,
                revenue.gross_cents,
                allocation.amount_cents AS share_cents,
                allocation.currency,
                allocation.basis_points,
                allocation.created_at,
                CASE
                    WHEN EXISTS (
                        SELECT 1 FROM settlement_items item
                        WHERE item.allocation_id = allocation.id
                          AND item.status = 'succeeded'
                    ) THEN 'settled'
                    WHEN EXISTS (
                        SELECT 1 FROM settlement_items item
                        WHERE item.allocation_id = allocation.id
                          AND item.status IN ('pending', 'processing')
                    ) THEN 'processing'
                    ELSE 'available'
                END AS status,
                (
                    SELECT item.batch_id FROM settlement_items item
                    WHERE item.allocation_id = allocation.id
                      AND item.status IN ('succeeded', 'processing', 'pending')
                    ORDER BY CASE item.status
                        WHEN 'succeeded' THEN 3
                        WHEN 'processing' THEN 2
                        ELSE 1 END DESC,
                        item.created_at DESC
                    LIMIT 1
                ) AS settlement_batch_id
            FROM revenue_allocations allocation
            JOIN revenue_orders revenue ON revenue.order_id = allocation.order_id
            WHERE allocation.account_id = ?
        )
        SELECT * FROM earnings
        WHERE (? IS NULL OR currency = ?)
          AND (? IS NULL OR status = ?)
        ORDER BY created_at DESC, allocation_id DESC
        """
        parameters: list[Any] = [account_id, currency, currency, status, status]
        if limit is not None:
            sql += " LIMIT ? OFFSET ?"
            parameters.extend((limit, offset))
        return [dict(row) for row in connection.execute(sql, parameters).fetchall()]

    def export_earnings_csv(
        self,
        *,
        account_id: str,
        currency: str | None = None,
        status: str | None = None,
    ) -> bytes:
        """Return UTF-8-with-BOM CSV bytes suitable for spreadsheet download."""

        account_id = _required_text(account_id, "account_id")
        currency = _currency(currency) if currency else None
        if status not in {None, "available", "processing", "settled"}:
            raise SettlementValidationError("invalid earnings status")
        with _connection(self.db_path) as connection:
            rows = self._query_earnings(
                connection,
                account_id=account_id,
                currency=currency,
                status=status,
                limit=None,
                offset=0,
            )
        output = io.StringIO(newline="")
        fieldnames = [
            "allocation_id",
            "order_id",
            "account_id",
            "role",
            "gross_cents",
            "share_cents",
            "currency",
            "basis_points",
            "status",
            "created_at",
            "settlement_batch_id",
        ]
        writer = csv.DictWriter(output, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            protected = {
                key: self._protect_csv_cell(value) for key, value in row.items()
            }
            writer.writerow(protected)
        return ("\ufeff" + output.getvalue()).encode("utf-8")

    @staticmethod
    def _protect_csv_cell(value: Any) -> Any:
        if isinstance(value, str) and value.startswith(("=", "+", "-", "@")):
            return "'" + value
        return value

    def list_unsettled_accounts(
        self, *, minimum_cents: int = 1, limit: int = 100
    ) -> list[dict[str, Any]]:
        minimum_cents = max(1, int(minimum_cents))
        limit = min(1000, max(1, int(limit)))
        with _connection(self.db_path) as connection:
            rows = connection.execute(
                """
                SELECT allocation.account_id, allocation.currency,
                       SUM(allocation.amount_cents) AS available_cents,
                       COUNT(*) AS item_count
                FROM revenue_allocations allocation
                WHERE NOT EXISTS (
                    SELECT 1 FROM settlement_items item
                    WHERE item.allocation_id = allocation.id
                      AND item.status IN ('pending', 'processing', 'succeeded')
                )
                GROUP BY allocation.account_id, allocation.currency
                HAVING SUM(allocation.amount_cents) >= ?
                ORDER BY allocation.account_id, allocation.currency
                LIMIT ?
                """,
                (minimum_cents, limit),
            ).fetchall()
            return [dict(row) for row in rows]

    def run_automatic_cycle(
        self,
        *,
        cycle_id: str,
        minimum_cents: int = 1,
        max_accounts: int = 100,
        max_items_per_batch: int = 1000,
        retry_stale_after_seconds: int = 300,
    ) -> list[dict[str, Any]]:
        """Retry stale batches, then settle eligible accounts for one cycle id."""

        cycle_id = _required_text(cycle_id, "cycle_id", 100)
        results = self.retry_processing_batches(
            stale_after_seconds=retry_stale_after_seconds,
            limit=max_accounts,
        )
        candidates = self.list_unsettled_accounts(
            minimum_cents=minimum_cents, limit=max_accounts
        )
        for candidate in candidates:
            key_material = (
                f"{cycle_id}\0{candidate['account_id']}\0{candidate['currency']}"
            )
            key = "auto_" + hashlib.sha256(key_material.encode("utf-8")).hexdigest()
            batch = self.create_settlement_batch(
                account_id=candidate["account_id"],
                currency=candidate["currency"],
                idempotency_key=key,
                minimum_cents=minimum_cents,
                max_items=max_items_per_batch,
            )
            try:
                results.append(self.execute_settlement_batch(batch["id"]))
            except PayoutSubmissionError:
                results.append(self.get_settlement_batch(batch["id"]))
        return results


__all__ = [
    "NothingToSettle",
    "PayoutLine",
    "PayoutProvider",
    "PayoutRequest",
    "PayoutResult",
    "PayoutSubmissionError",
    "SandboxPayoutProvider",
    "SettlementBatchNotFound",
    "SettlementError",
    "SettlementIdempotencyConflict",
    "SettlementService",
    "SettlementValidationError",
    "ShareRuleLine",
    "allocate_cents",
    "standard_merchant_rule",
]
