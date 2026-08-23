"""FastAPI integration for private cloud, paid device access, and settlement."""

from __future__ import annotations

import html
import os
import uuid
from dataclasses import dataclass
from typing import Any, Mapping

from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import HTMLResponse

from .auth import (
    IdentityError,
    is_production_environment,
    resolve_request_identity,
    verify_admin_key,
)
from .commerce.device_registry import (
    DeviceNotRegisteredError,
    DeviceRegistryError,
    SQLiteDeviceCatalog,
)
from .commerce.payment import (
    PaymentAccessDeniedError,
    PaymentConflictError,
    PaymentDomainError,
    PaymentNotFoundError,
    PaymentService,
)
from .commerce.payment_provider import SandboxPaymentProvider
from .commerce.settlement import (
    NothingToSettle,
    PayoutRequest,
    PayoutResult,
    PayoutSubmissionError,
    SettlementBatchNotFound,
    SettlementError,
    SettlementIdempotencyConflict,
    SettlementService,
    SettlementValidationError,
    standard_merchant_rule,
)
from .private_cloud import (
    CloudObjectCorrupted,
    CloudObjectNotFound,
    CloudWorkConflict,
    CloudWorkNotFound,
    InvalidCloudWork,
    PrivateCloudService,
)


def _is_production() -> bool:
    return is_production_environment(os.environ)


def _env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


class DisabledPayoutProvider:
    """Fail-closed placeholder until a real payout adapter is configured."""

    name = "unconfigured"

    def submit(self, request: PayoutRequest) -> PayoutResult:
        del request
        raise SettlementValidationError("production payout provider is not configured")


@dataclass
class BusinessServices:
    cloud: PrivateCloudService
    devices: SQLiteDeviceCatalog
    payments: PaymentService
    settlements: SettlementService
    payment_provider_name: str
    sandbox_payment: bool
    auto_settle: bool
    grant_duration_seconds: int


def build_default_business_services() -> BusinessServices:
    production = _is_production()
    payment_provider_name = os.environ.get(
        "PIXELDOODLE_PAYMENT_PROVIDER", "sandbox" if not production else ""
    ).strip()
    providers: dict[str, Any] = {}
    sandbox_payment = (
        payment_provider_name == "sandbox"
        and not production
        and _env_bool("PIXELDOODLE_SANDBOX_PAYMENT_ENABLED", False)
    )
    if sandbox_payment:
        providers["sandbox"] = SandboxPaymentProvider(
            os.environ.get(
                "PIXELDOODLE_SANDBOX_PAYMENT_SECRET",
                "local-development-payment-secret",
            ),
            os.environ.get("PIXELDOODLE_PUBLIC_BASE_URL", ""),
        )

    payout_name = os.environ.get(
        "PIXELDOODLE_PAYOUT_PROVIDER", "sandbox" if not production else ""
    ).strip()
    payout_provider = None if payout_name == "sandbox" and not production else DisabledPayoutProvider()
    settlements = SettlementService(payout_provider=payout_provider)

    merchant_basis_points = int(os.environ.get("PIXELDOODLE_MERCHANT_SHARE_BPS", "8000"))
    if not 1 <= merchant_basis_points <= 9999:
        raise RuntimeError("PIXELDOODLE_MERCHANT_SHARE_BPS must be between 1 and 9999")
    platform_account = os.environ.get("PIXELDOODLE_PLATFORM_ACCOUNT_ID", "platform")

    def record_revenue(connection, order: dict) -> None:
        merchant_account = str(order.get("merchant_account_id") or "").strip()
        if not merchant_account:
            raise SettlementValidationError("paid order has no merchant account")
        settlements.record_paid_order(
            order_id=order["id"],
            payer_user_id=order["user_id"],
            merchant_account_id=merchant_account,
            gross_cents=order["amount_cents"],
            currency=order["currency"],
            occurred_at=order.get("paid_at"),
            rule_name="device-session-v1",
            rule_lines=standard_merchant_rule(
                merchant_account,
                platform_account_id=platform_account,
                merchant_basis_points=merchant_basis_points,
            ),
            connection=connection,
        )

    configured_payment_provider = (
        payment_provider_name if payment_provider_name in providers else ""
    )
    payments = PaymentService(providers, on_paid=record_revenue)
    return BusinessServices(
        cloud=PrivateCloudService.sqlite(),
        devices=SQLiteDeviceCatalog(),
        payments=payments,
        settlements=settlements,
        payment_provider_name=configured_payment_provider,
        sandbox_payment=sandbox_payment,
        auto_settle=(
            not production
            and _env_bool("PIXELDOODLE_AUTO_SETTLE", True)
        ),
        grant_duration_seconds=int(
            os.environ.get("PIXELDOODLE_DEVICE_SESSION_SECONDS", "900")
        ),
    )


def _identity(request: Request) -> str:
    try:
        return resolve_request_identity(request.headers).user_id
    except IdentityError as error:
        status = 503 if "not configured" in str(error).lower() else 401
        raise HTTPException(status_code=status, detail=str(error)) from error


def _require_admin(request: Request) -> None:
    if not verify_admin_key(request.headers):
        raise HTTPException(status_code=403, detail="admin key is required")


def _raise_domain_error(error: Exception) -> None:
    if isinstance(error, (CloudObjectNotFound, CloudObjectCorrupted)):
        status = 500
    elif isinstance(error, (CloudWorkNotFound, PaymentNotFoundError)):
        status = 404
    elif isinstance(
        error,
        (
            CloudWorkConflict,
            PaymentConflictError,
            SettlementIdempotencyConflict,
            NothingToSettle,
        ),
    ):
        status = 409
    elif isinstance(error, PaymentAccessDeniedError):
        status = 403
    elif isinstance(error, SettlementBatchNotFound):
        status = 404
    elif isinstance(error, PayoutSubmissionError):
        status = 502
    else:
        status = 400
    raise HTTPException(status_code=status, detail=str(error)) from error


def _maybe_run_auto_settlement(services: BusinessServices, order_id: str) -> list[dict]:
    if not services.auto_settle:
        return []
    return services.settlements.run_automatic_cycle(cycle_id=f"payment-{order_id}")


def _sandbox_checkout_html(order_id: str) -> str:
    safe_order_id = html.escape(order_id, quote=True)
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>PixelDoodle 本地支付确认</title>
</head>
<body>
  <main>
    <h1>本地沙盒订单</h1>
    <p>订单号：<code>{safe_order_id}</code></p>
    <p>此确认页不会完成支付。请返回 PixelDoodle，在设备与云端中心点击“模拟支付成功”。</p>
    <p><a href="/">返回 PixelDoodle</a></p>
  </main>
</body>
</html>"""


def create_business_router(services: BusinessServices) -> APIRouter:
    router = APIRouter()

    @router.post("/api/cloud/works")
    async def create_cloud_work(request: Request, data: dict):
        try:
            work = services.cloud.create_work(
                _identity(request),
                title=data.get("title", ""),
                source_label=data.get("source_label", ""),
                document=data.get("document"),
                work_id=data.get("work_id"),
            )
            return work.to_dict()
        except (InvalidCloudWork, CloudWorkConflict) as error:
            _raise_domain_error(error)

    @router.get("/api/cloud/works")
    async def list_cloud_works(
        request: Request,
        include_deleted: bool = False,
        limit: int = Query(50, ge=1, le=100),
        offset: int = Query(0, ge=0),
    ):
        try:
            return services.cloud.list_works(
                _identity(request),
                include_deleted=include_deleted,
                limit=limit,
                offset=offset,
            ).to_dict()
        except InvalidCloudWork as error:
            _raise_domain_error(error)

    @router.get("/api/cloud/works/{work_id}")
    async def get_cloud_work(
        work_id: str, request: Request, include_deleted: bool = False
    ):
        try:
            return services.cloud.get_work(
                _identity(request), work_id, include_deleted=include_deleted
            ).to_dict()
        except (
            InvalidCloudWork,
            CloudWorkNotFound,
            CloudObjectNotFound,
            CloudObjectCorrupted,
        ) as error:
            _raise_domain_error(error)

    @router.put("/api/cloud/works/{work_id}")
    async def update_cloud_work(work_id: str, request: Request, data: dict):
        try:
            return services.cloud.update_work(
                _identity(request),
                work_id,
                expected_version=data.get("expected_version"),
                title=data.get("title"),
                source_label=data.get("source_label"),
                document=data.get("document"),
            ).to_dict()
        except (InvalidCloudWork, CloudWorkNotFound, CloudWorkConflict) as error:
            _raise_domain_error(error)

    @router.delete("/api/cloud/works/{work_id}")
    async def delete_cloud_work(work_id: str, request: Request, expected_version: int):
        try:
            return services.cloud.delete_work(
                _identity(request), work_id, expected_version=expected_version
            ).to_dict()
        except (InvalidCloudWork, CloudWorkNotFound, CloudWorkConflict) as error:
            _raise_domain_error(error)

    @router.post("/api/cloud/works/{work_id}/restore")
    async def restore_cloud_work(work_id: str, request: Request, data: dict):
        try:
            return services.cloud.restore_work(
                _identity(request),
                work_id,
                expected_version=data.get("expected_version"),
            ).to_dict()
        except (InvalidCloudWork, CloudWorkNotFound, CloudWorkConflict) as error:
            _raise_domain_error(error)

    @router.get("/api/commerce/config")
    async def commerce_config():
        return {
            "payment_provider": services.payment_provider_name or None,
            "sandbox_payment": services.sandbox_payment,
            "auto_settle": services.auto_settle,
            "grant_duration_seconds": services.grant_duration_seconds,
        }

    @router.post("/api/commerce/devices")
    async def register_commerce_device(request: Request, data: dict):
        _require_admin(request)
        try:
            return services.devices.register(
                device_id=data.get("device_id", ""),
                merchant_account_id=data.get("merchant_account_id", ""),
                display_name=data.get("display_name", ""),
                session_price_cents=data.get("session_price_cents", 100),
                currency=data.get("currency", "CNY"),
                enabled=data.get("enabled", True),
            ).to_dict()
        except DeviceRegistryError as error:
            _raise_domain_error(error)

    @router.post("/api/commerce/devices/sandbox-register")
    async def sandbox_register_commerce_device(request: Request, data: dict):
        if _is_production() or not services.sandbox_payment:
            raise HTTPException(status_code=404, detail="sandbox registration is disabled")
        try:
            return services.devices.register(
                device_id=data.get("device_id", ""),
                merchant_account_id=_identity(request),
                display_name=data.get("display_name", ""),
                session_price_cents=data.get("session_price_cents", 100),
                currency="CNY",
            ).to_dict()
        except DeviceRegistryError as error:
            _raise_domain_error(error)

    @router.get("/api/commerce/devices")
    async def list_owned_commerce_devices(request: Request):
        try:
            return {
                "items": [
                    device.to_dict()
                    for device in services.devices.list_owned(_identity(request))
                ]
            }
        except DeviceRegistryError as error:
            _raise_domain_error(error)

    @router.post("/api/commerce/orders")
    async def create_payment_order(request: Request, data: dict):
        try:
            device = services.devices.get_enabled(data.get("device_id", ""))
            order = services.payments.create_order(
                user_id=_identity(request),
                device_id=device.device_id,
                merchant_account_id=device.merchant_account_id,
                amount_cents=device.session_price_cents,
                currency=device.currency,
                idempotency_key=data.get("idempotency_key", ""),
                provider=services.payment_provider_name,
                description=f"{device.display_name} device session",
                metadata={"device_display_name": device.display_name},
            )
            return order
        except (DeviceRegistryError, PaymentDomainError) as error:
            _raise_domain_error(error)

    @router.get("/api/commerce/orders")
    async def list_payment_orders(request: Request, limit: int = Query(20, ge=1, le=100)):
        try:
            return {"items": services.payments.list_orders(_identity(request), limit=limit)}
        except PaymentDomainError as error:
            _raise_domain_error(error)

    @router.get("/api/commerce/orders/{order_id}")
    async def get_payment_order(order_id: str, request: Request):
        try:
            return services.payments.get_order(order_id, user_id=_identity(request))
        except PaymentDomainError as error:
            _raise_domain_error(error)

    @router.post("/api/commerce/webhooks/{provider_name}")
    async def payment_webhook(provider_name: str, request: Request):
        try:
            result = services.payments.handle_webhook(
                provider_name, request.headers, await request.body()
            )
            result["settlements"] = _maybe_run_auto_settlement(
                services, result["order"]["id"]
            )
            return result
        except (PaymentDomainError, SettlementError) as error:
            _raise_domain_error(error)

    @router.post("/api/commerce/orders/{order_id}/sandbox-pay")
    async def sandbox_pay_order(order_id: str, request: Request):
        if not services.sandbox_payment:
            raise HTTPException(status_code=404, detail="sandbox payment is disabled")
        try:
            result = services.payments.sandbox_pay(
                order_id, user_id=_identity(request)
            )
            result["settlements"] = _maybe_run_auto_settlement(
                services, result["order"]["id"]
            )
            return result
        except (PaymentDomainError, SettlementError) as error:
            _raise_domain_error(error)

    @router.get(
        "/api/commerce/sandbox/orders/{order_id}/pay",
        response_class=HTMLResponse,
        include_in_schema=False,
    )
    async def sandbox_checkout_confirmation(order_id: str):
        if not services.sandbox_payment:
            raise HTTPException(status_code=404, detail="sandbox payment is disabled")
        return HTMLResponse(
            _sandbox_checkout_html(order_id),
            headers={
                "Cache-Control": "no-store",
                "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
            },
        )

    @router.post("/api/commerce/orders/{order_id}/device-grant")
    async def issue_device_grant(order_id: str, request: Request):
        try:
            return services.payments.issue_device_grant(
                order_id,
                user_id=_identity(request),
                duration_seconds=services.grant_duration_seconds,
            )
        except PaymentDomainError as error:
            _raise_domain_error(error)

    @router.post("/api/commerce/device-activations")
    async def record_device_activation(request: Request, data: dict):
        try:
            return services.payments.record_device_activation(
                user_id=_identity(request),
                device_id=data.get("device_id", ""),
                access_token=data.get("access_token", ""),
            )
        except PaymentDomainError as error:
            _raise_domain_error(error)

    @router.get("/api/commerce/earnings")
    async def list_earnings(
        request: Request,
        currency: str | None = None,
        status: str | None = None,
        limit: int = Query(100, ge=1, le=1000),
        offset: int = Query(0, ge=0),
    ):
        try:
            return services.settlements.list_earnings(
                account_id=_identity(request),
                currency=currency,
                status=status,
                limit=limit,
                offset=offset,
            )
        except SettlementError as error:
            _raise_domain_error(error)

    @router.get("/api/commerce/earnings/export.csv")
    async def export_earnings_csv(
        request: Request, currency: str | None = None, status: str | None = None
    ):
        try:
            content = services.settlements.export_earnings_csv(
                account_id=_identity(request), currency=currency, status=status
            )
            return Response(
                content=content,
                media_type="text/csv; charset=utf-8",
                headers={
                    "Content-Disposition": 'attachment; filename="pixeldoodle-earnings.csv"'
                },
            )
        except SettlementError as error:
            _raise_domain_error(error)

    @router.post("/api/commerce/settlements")
    async def create_and_execute_settlement(request: Request, data: dict):
        try:
            batch = services.settlements.create_settlement_batch(
                account_id=_identity(request),
                idempotency_key=data.get("idempotency_key", ""),
                currency=data.get("currency", "CNY"),
                minimum_cents=data.get("minimum_cents", 1),
            )
            return services.settlements.execute_settlement_batch(batch["id"])
        except SettlementError as error:
            _raise_domain_error(error)

    @router.get("/api/commerce/settlements/{batch_id}")
    async def get_settlement(batch_id: str, request: Request):
        try:
            batch = services.settlements.get_settlement_batch(batch_id)
            if batch["account_id"] != _identity(request):
                raise SettlementBatchNotFound("settlement batch does not exist")
            return batch
        except SettlementError as error:
            _raise_domain_error(error)

    @router.post("/api/commerce/settlements/run-cycle")
    async def run_settlement_cycle(request: Request, data: dict):
        _require_admin(request)
        try:
            return {
                "items": services.settlements.run_automatic_cycle(
                    cycle_id=data.get("cycle_id") or uuid.uuid4().hex,
                    minimum_cents=data.get("minimum_cents", 1),
                    max_accounts=data.get("max_accounts", 100),
                    max_items_per_batch=data.get("max_items_per_batch", 1000),
                    retry_stale_after_seconds=data.get(
                        "retry_stale_after_seconds", 300
                    ),
                )
            }
        except SettlementError as error:
            _raise_domain_error(error)

    @router.post("/api/commerce/settlements/retry-processing")
    async def retry_processing_settlements(request: Request, data: dict):
        _require_admin(request)
        try:
            return {
                "items": services.settlements.retry_processing_batches(
                    stale_after_seconds=data.get("stale_after_seconds", 300),
                    limit=data.get("limit", 100),
                )
            }
        except SettlementError as error:
            _raise_domain_error(error)

    return router


__all__ = [
    "BusinessServices",
    "DisabledPayoutProvider",
    "build_default_business_services",
    "create_business_router",
]
