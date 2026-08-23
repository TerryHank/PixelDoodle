"""Request identity helpers for private PixelDoodle APIs.

The local sandbox accepts a user id header so the project remains runnable
without an OAuth provider. Production uses a short HMAC bearer token issued by
the future login service; the browser never receives the signing secret.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import time
from dataclasses import dataclass
from typing import Mapping


USER_ID_HEADER = "x-pixeldoodle-user-id"
ADMIN_KEY_HEADER = "x-pixeldoodle-admin-key"
_USER_ID_PATTERN = re.compile(r"^[A-Za-z0-9_.:@-]{1,64}$")


class IdentityError(ValueError):
    """Raised when a request cannot be mapped to an authenticated user."""


@dataclass(frozen=True)
class RequestIdentity:
    user_id: str
    auth_mode: str


def _environment(environ: Mapping[str, str] | None) -> Mapping[str, str]:
    return os.environ if environ is None else environ


def is_production_environment(environ: Mapping[str, str] | None = None) -> bool:
    """Return whether the configured runtime must enforce production controls."""

    environ = _environment(environ)
    return environ.get("PIXELDOODLE_ENV", "development").strip().lower() in {
        "production",
        "prod",
    }


def _auth_mode(environ: Mapping[str, str]) -> str:
    configured = environ.get("PIXELDOODLE_AUTH_MODE", "").strip().lower()
    if configured:
        return configured
    return "bearer_hmac" if is_production_environment(environ) else "sandbox"


def _validate_user_id(value: str) -> str:
    user_id = value.strip()
    if not _USER_ID_PATTERN.fullmatch(user_id):
        raise IdentityError("Invalid user identity")
    return user_id


def _b64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    try:
        return base64.urlsafe_b64decode(value + padding)
    except (ValueError, TypeError) as exc:
        raise IdentityError("Invalid access token") from exc


def issue_hmac_access_token(
    user_id: str,
    secret: str,
    *,
    ttl_seconds: int = 3600,
    now: int | None = None,
) -> str:
    """Issue the compact token expected by ``bearer_hmac`` mode.

    This helper is intended for an upstream login service or local tests, not a
    public unauthenticated HTTP endpoint.
    """

    normalized_user_id = _validate_user_id(user_id)
    if len(secret) < 32:
        raise IdentityError("PIXELDOODLE_AUTH_SECRET must contain at least 32 characters")
    if ttl_seconds <= 0:
        raise IdentityError("Token TTL must be positive")

    issued_at = int(time.time() if now is None else now)
    payload = json.dumps(
        {"sub": normalized_user_id, "iat": issued_at, "exp": issued_at + ttl_seconds},
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    encoded_payload = _b64url_encode(payload)
    signed_value = f"v1.{encoded_payload}".encode("ascii")
    signature = hmac.new(secret.encode("utf-8"), signed_value, hashlib.sha256).digest()
    return f"v1.{encoded_payload}.{_b64url_encode(signature)}"


def _resolve_hmac_bearer(
    authorization: str,
    secret: str,
    *,
    now: int | None = None,
) -> RequestIdentity:
    if len(secret) < 32:
        raise IdentityError("Production authentication is not configured")
    if not authorization.startswith("Bearer "):
        raise IdentityError("Bearer access token is required")

    token = authorization[7:].strip()
    parts = token.split(".")
    if len(parts) != 3 or parts[0] != "v1":
        raise IdentityError("Invalid access token")

    signed_value = f"{parts[0]}.{parts[1]}".encode("ascii")
    expected_signature = hmac.new(
        secret.encode("utf-8"), signed_value, hashlib.sha256
    ).digest()
    supplied_signature = _b64url_decode(parts[2])
    if not hmac.compare_digest(expected_signature, supplied_signature):
        raise IdentityError("Invalid access token")

    try:
        payload = json.loads(_b64url_decode(parts[1]).decode("utf-8"))
        user_id = _validate_user_id(str(payload["sub"]))
        expires_at = int(payload["exp"])
    except (KeyError, TypeError, ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise IdentityError("Invalid access token") from exc

    current_time = int(time.time() if now is None else now)
    if expires_at <= current_time:
        raise IdentityError("Access token has expired")
    return RequestIdentity(user_id=user_id, auth_mode="bearer_hmac")


def resolve_request_identity(
    headers: Mapping[str, str],
    *,
    environ: Mapping[str, str] | None = None,
    now: int | None = None,
) -> RequestIdentity:
    env = _environment(environ)
    mode = _auth_mode(env)
    normalized_headers = {key.lower(): value for key, value in headers.items()}

    if mode == "sandbox":
        if is_production_environment(env):
            raise IdentityError("Sandbox authentication is disabled in production")
        user_id = normalized_headers.get(USER_ID_HEADER, "")
        if not user_id:
            raise IdentityError(f"{USER_ID_HEADER} header is required")
        return RequestIdentity(user_id=_validate_user_id(user_id), auth_mode="sandbox")

    if mode == "bearer_hmac":
        return _resolve_hmac_bearer(
            normalized_headers.get("authorization", ""),
            env.get("PIXELDOODLE_AUTH_SECRET", ""),
            now=now,
        )

    raise IdentityError(f"Unsupported authentication mode: {mode}")


def verify_admin_key(
    headers: Mapping[str, str], *, environ: Mapping[str, str] | None = None
) -> bool:
    env = _environment(environ)
    expected = env.get("PIXELDOODLE_ADMIN_KEY", "")
    supplied = next(
        (value for key, value in headers.items() if key.lower() == ADMIN_KEY_HEADER),
        "",
    )
    return len(expected) >= 16 and hmac.compare_digest(expected, supplied)
