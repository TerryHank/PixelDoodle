import csv
import io
import sqlite3
import tempfile
import unittest
from pathlib import Path

from core.commerce.db import connect
from core.commerce.payment import PaymentService
from core.commerce.payment_provider import SandboxPaymentProvider
from core.commerce.settlement import (
    NothingToSettle,
    PayoutResult,
    PayoutSubmissionError,
    SettlementIdempotencyConflict,
    SettlementService,
    SettlementValidationError,
    ShareRuleLine,
    allocate_cents,
    standard_merchant_rule,
)


class StubPayoutProvider:
    name = "stub-pay"

    def __init__(self, status="succeeded", raises=False):
        self.status = status
        self.raises = raises
        self.requests = []

    def submit(self, request):
        self.requests.append(request)
        if self.raises:
            raise ConnectionError("provider response was lost")
        return PayoutResult(
            self.status,
            provider_reference=f"stub-{request.idempotency_key}",
            failure_reason="rejected" if self.status == "failed" else None,
        )


class LostResponseOnceProvider:
    """Models a provider that debits once, then loses the first response."""

    name = "lost-response-pay"

    def __init__(self):
        self.requests = []
        self.debits_by_key = {}

    def submit(self, request):
        self.requests.append(request)
        if request.idempotency_key not in self.debits_by_key:
            self.debits_by_key[request.idempotency_key] = request.amount_cents
            raise ConnectionError("provider accepted payout but response was lost")
        self.assert_same_amount(request)
        return PayoutResult(
            "succeeded",
            provider_reference=f"paid-{request.idempotency_key}",
        )

    def assert_same_amount(self, request):
        if self.debits_by_key[request.idempotency_key] != request.amount_cents:
            raise AssertionError("idempotency key was reused with a different amount")


class SettlementTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "business.db"
        self.provider = StubPayoutProvider()
        self.service = SettlementService(
            self.db_path,
            payout_provider=self.provider,
            now=lambda: "2026-08-23T12:00:00.000Z",
        )

    def tearDown(self):
        self.temp_dir.cleanup()

    def record_order(
        self,
        order_id="order-1",
        gross_cents=101,
        merchant="merchant-a",
        payer="buyer-a",
        rule=None,
    ):
        return self.service.record_paid_order(
            order_id=order_id,
            payer_user_id=payer,
            merchant_account_id=merchant,
            gross_cents=gross_cents,
            currency="CNY",
            rule_name="merchant-80-platform-20",
            rule_lines=rule or standard_merchant_rule(merchant),
            occurred_at="2026-08-23T11:59:00.000Z",
        )

    def test_integer_allocation_conserves_every_cent(self):
        rule = (
            ShareRuleLine("a", "merchant", 5000),
            ShareRuleLine("b", "partner", 3000),
            ShareRuleLine("c", "platform", 2000),
        )

        self.assertEqual(allocate_cents(101, rule), (51, 30, 20))
        self.assertEqual(sum(allocate_cents(1, rule)), 1)

    def test_rule_must_total_exactly_ten_thousand_basis_points(self):
        with self.assertRaises(SettlementValidationError):
            allocate_cents(
                100,
                (
                    ShareRuleLine("merchant", "merchant", 7000),
                    ShareRuleLine("platform", "platform", 2000),
                ),
            )

    def test_paid_order_records_rule_snapshot_and_is_idempotent(self):
        first = self.record_order()
        second = self.record_order()

        self.assertEqual(first, second)
        self.assertEqual(first["gross_cents"], 101)
        self.assertEqual(
            [line["amount_cents"] for line in first["allocations"]], [81, 20]
        )
        self.assertEqual(
            sum(line["amount_cents"] for line in first["allocations"]), 101
        )
        self.assertEqual(first["rule_snapshot"]["version"], 1)

        connection = connect(self.db_path)
        try:
            count = connection.execute(
                "SELECT COUNT(*) FROM revenue_allocations WHERE order_id = 'order-1'"
            ).fetchone()[0]
        finally:
            connection.close()
        self.assertEqual(count, 2)

    def test_retry_without_paid_timestamp_is_still_idempotent(self):
        timestamps = iter(
            (
                "2026-08-23T12:00:00.000Z",
                "2026-08-23T12:00:01.000Z",
                "2026-08-23T12:00:02.000Z",
            )
        )
        service = SettlementService(
            self.db_path,
            payout_provider=self.provider,
            now=lambda: next(timestamps),
        )
        arguments = {
            "order_id": "order-no-time",
            "payer_user_id": "buyer-a",
            "merchant_account_id": "merchant-a",
            "gross_cents": 100,
            "rule_lines": standard_merchant_rule("merchant-a"),
        }

        first = service.record_paid_order(**arguments)
        second = service.record_paid_order(**arguments)

        self.assertEqual(first, second)

    def test_reusing_order_id_with_different_financial_input_is_rejected(self):
        self.record_order()

        with self.assertRaises(SettlementIdempotencyConflict):
            self.record_order(gross_cents=102)

    def test_external_payment_transaction_controls_commit(self):
        connection = connect(self.db_path)
        try:
            connection.execute("BEGIN IMMEDIATE")
            self.service.record_paid_order(
                order_id="rolled-back",
                payer_user_id="buyer-a",
                merchant_account_id="merchant-a",
                gross_cents=100,
                rule_lines=standard_merchant_rule("merchant-a"),
                occurred_at="2026-08-23T11:59:00.000Z",
                connection=connection,
            )
            connection.rollback()
        finally:
            connection.close()

        check = connect(self.db_path)
        try:
            count = check.execute(
                "SELECT COUNT(*) FROM revenue_orders WHERE order_id = 'rolled-back'"
            ).fetchone()[0]
        finally:
            check.close()
        self.assertEqual(count, 0)

    def test_allocation_rows_are_immutable_at_database_boundary(self):
        order = self.record_order()
        connection = connect(self.db_path)
        try:
            with self.assertRaises(sqlite3.IntegrityError):
                connection.execute(
                    "UPDATE revenue_allocations SET amount_cents = 1 WHERE id = ?",
                    (order["allocations"][0]["id"],),
                )
        finally:
            connection.close()

    def test_settlement_batch_is_idempotent_and_marks_earnings_settled(self):
        self.record_order()
        first = self.service.create_settlement_batch(
            account_id="merchant-a", idempotency_key="settle-merchant-20260823"
        )
        second = self.service.create_settlement_batch(
            account_id="merchant-a", idempotency_key="settle-merchant-20260823"
        )

        self.assertEqual(first["id"], second["id"])
        self.assertEqual(first["amount_cents"], 81)
        completed = self.service.execute_settlement_batch(first["id"])
        repeated = self.service.execute_settlement_batch(first["id"])

        self.assertEqual(completed["status"], "succeeded")
        self.assertEqual(repeated["status"], "succeeded")
        self.assertEqual(len(self.provider.requests), 1)
        earnings = self.service.list_earnings(account_id="merchant-a")
        self.assertEqual(earnings["items"][0]["status"], "settled")
        self.assertEqual(earnings["summary"]["CNY"]["settled_cents"], 81)

    def test_client_idempotency_keys_are_scoped_per_account(self):
        self.record_order()
        self.record_order(
            order_id="order-b",
            merchant="merchant-b",
            payer="buyer-b",
            rule=(ShareRuleLine("merchant-b", "merchant", 10000),),
        )

        first = self.service.create_settlement_batch(
            account_id="merchant-a", idempotency_key="same-client-key"
        )
        second = self.service.create_settlement_batch(
            account_id="merchant-b", idempotency_key="same-client-key"
        )

        self.assertNotEqual(first["id"], second["id"])
        self.assertNotEqual(first["idempotency_key"], second["idempotency_key"])

    def test_provider_exception_leaves_processing_batch_for_same_key_retry(self):
        self.record_order()
        self.provider.raises = True
        batch = self.service.create_settlement_batch(
            account_id="merchant-a", idempotency_key="uncertain-payout"
        )

        with self.assertRaises(PayoutSubmissionError):
            self.service.execute_settlement_batch(batch["id"])

        uncertain = self.service.get_settlement_batch(batch["id"])
        self.assertEqual(uncertain["status"], "processing")
        self.assertIn("ConnectionError", uncertain["failure_reason"])
        with self.assertRaises(NothingToSettle):
            self.service.create_settlement_batch(
                account_id="merchant-a", idempotency_key="unsafe-second-payout"
            )
        self.provider.raises = False
        retried = self.service.execute_settlement_batch(batch["id"])
        self.assertEqual(retried["status"], "succeeded")
        self.assertEqual(len(self.provider.requests), 2)
        self.assertEqual(
            self.provider.requests[0].idempotency_key,
            self.provider.requests[1].idempotency_key,
        )

    def test_automatic_cycle_recovers_lost_response_without_duplicate_amount(self):
        self.record_order()
        provider = LostResponseOnceProvider()
        service = SettlementService(
            self.db_path,
            payout_provider=provider,
            now=lambda: "2026-08-23T12:00:00.000Z",
        )

        uncertain = service.run_automatic_cycle(
            cycle_id="cycle-1", retry_stale_after_seconds=0
        )
        recovered = service.run_automatic_cycle(
            cycle_id="cycle-2", retry_stale_after_seconds=0
        )

        self.assertEqual({batch["status"] for batch in uncertain}, {"processing"})
        self.assertEqual({batch["status"] for batch in recovered}, {"succeeded"})
        self.assertEqual(sum(provider.debits_by_key.values()), 101)
        self.assertEqual(len(provider.debits_by_key), 2)
        self.assertEqual(len(provider.requests), 4)
        for idempotency_key in provider.debits_by_key:
            matching = [
                request
                for request in provider.requests
                if request.idempotency_key == idempotency_key
            ]
            self.assertEqual(len(matching), 2)
            self.assertEqual(matching[0].amount_cents, matching[1].amount_cents)

        merchant = service.list_earnings(account_id="merchant-a")
        platform = service.list_earnings(account_id="platform")
        self.assertEqual(merchant["summary"]["CNY"]["settled_cents"], 81)
        self.assertEqual(platform["summary"]["CNY"]["settled_cents"], 20)

    def test_admin_processing_retry_route_is_registered(self):
        from core.business_api import create_business_router

        router = create_business_router(object())
        matching = [
            route
            for route in router.routes
            if route.path == "/api/commerce/settlements/retry-processing"
        ]

        self.assertEqual(len(matching), 1)
        self.assertIn("POST", matching[0].methods)

    def test_explicit_failed_payout_releases_allocations_for_new_batch(self):
        self.record_order()
        self.provider.status = "failed"
        failed = self.service.create_settlement_batch(
            account_id="merchant-a", idempotency_key="failed-attempt"
        )
        self.assertEqual(
            self.service.execute_settlement_batch(failed["id"])["status"], "failed"
        )

        retry = self.service.create_settlement_batch(
            account_id="merchant-a", idempotency_key="retry-attempt"
        )
        self.assertNotEqual(retry["id"], failed["id"])

    def test_pending_provider_event_is_idempotent(self):
        self.record_order()
        self.provider.status = "pending"
        batch = self.service.create_settlement_batch(
            account_id="merchant-a", idempotency_key="async-payout"
        )
        processing = self.service.execute_settlement_batch(batch["id"])
        self.assertEqual(processing["status"], "processing")

        result = PayoutResult("succeeded", provider_reference="bank-transfer-1")
        first = self.service.apply_provider_event(
            provider="stub-pay",
            event_id="bank-event-1",
            batch_id=batch["id"],
            result=result,
        )
        second = self.service.apply_provider_event(
            provider="stub-pay",
            event_id="bank-event-1",
            batch_id=batch["id"],
            result=result,
        )

        self.assertEqual(first["status"], "succeeded")
        self.assertEqual(second["status"], "succeeded")
        with self.assertRaises(SettlementIdempotencyConflict):
            self.service.apply_provider_event(
                provider="stub-pay",
                event_id="bank-event-1",
                batch_id=batch["id"],
                result=PayoutResult("failed", failure_reason="different payload"),
            )

    def test_account_query_is_isolated_and_csv_matches_ledger(self):
        self.record_order()
        merchant = self.service.list_earnings(account_id="merchant-a")
        platform = self.service.list_earnings(account_id="platform")
        unknown = self.service.list_earnings(account_id="merchant-b")

        self.assertEqual(merchant["total"], 1)
        self.assertEqual(merchant["items"][0]["share_cents"], 81)
        self.assertEqual(platform["items"][0]["share_cents"], 20)
        self.assertEqual(unknown["items"], [])

        csv_bytes = self.service.export_earnings_csv(account_id="merchant-a")
        decoded = csv_bytes.decode("utf-8-sig")
        rows = list(csv.DictReader(io.StringIO(decoded)))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["order_id"], "order-1")
        self.assertEqual(rows[0]["share_cents"], "81")

    def test_automatic_cycle_settles_all_eligible_accounts(self):
        self.record_order()

        batches = self.service.run_automatic_cycle(
            cycle_id="2026-08-23", minimum_cents=1
        )

        self.assertEqual(len(batches), 2)
        self.assertEqual({batch["status"] for batch in batches}, {"succeeded"})
        self.assertEqual(self.service.list_unsettled_accounts(), [])

    def test_payment_paid_hook_allocates_in_the_payment_transaction(self):
        sandbox = SandboxPaymentProvider("signed-test-secret")

        def on_paid(connection, order):
            self.service.record_paid_order(
                order_id=order["id"],
                payer_user_id=order["user_id"],
                merchant_account_id=order["merchant_account_id"],
                gross_cents=order["amount_cents"],
                currency=order["currency"],
                occurred_at=order["paid_at"],
                rule_lines=standard_merchant_rule(order["merchant_account_id"]),
                connection=connection,
            )

        payment = PaymentService(
            {"sandbox": sandbox}, db_path=self.db_path, on_paid=on_paid
        )
        order = payment.create_order(
            user_id="buyer-a",
            device_id="AABBCCDDEEFF",
            merchant_account_id="merchant-a",
            amount_cents=101,
            idempotency_key="checkout-and-allocate",
            provider="sandbox",
        )

        paid = payment.sandbox_pay(
            order["id"], user_id="buyer-a", event_id="payment-event-1"
        )
        repeated = payment.sandbox_pay(
            order["id"], user_id="buyer-a", event_id="payment-event-1"
        )

        self.assertEqual(paid["order"]["status"], "paid")
        self.assertTrue(repeated["idempotent"])
        earnings = self.service.list_earnings(account_id="merchant-a")
        self.assertEqual(earnings["total"], 1)
        self.assertEqual(earnings["summary"]["CNY"]["available_cents"], 81)


if __name__ == "__main__":
    unittest.main()
