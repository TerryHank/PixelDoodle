"""Signed, device-bound activation grants shared by API and ESP32 protocol."""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import secrets
import struct
from dataclasses import dataclass
from typing import Protocol

GRANT_VERSION = 2
# version, device id, duration, absolute not-after epoch, monotonic sequence, nonce
GRANT_BODY = struct.Struct("<B6sIQQ8s")
GRANT_SIGNATURE_BYTES = 16
GRANT_BYTES = GRANT_BODY.size + GRANT_SIGNATURE_BYTES
DEVICE_ID_PATTERN = re.compile(r"^[0-9A-F]{12}$")
MIN_GRANT_SECONDS = 30
MAX_GRANT_SECONDS = 3600
MAX_GRANT_SEQUENCE = (1 << 63) - 1


class DeviceGrantError(ValueError):
    """Raised when a grant is malformed, forged, or bound to another device."""


class DeviceSecretProvider(Protocol):
    """Production implementations may load a per-device secret from a KMS."""

    def secret_for(self, device_id: str) -> bytes:
        """Return the provisioned HMAC secret for the normalized device id."""


class StaticDeviceSecretProvider:
    """Single secret implementation for local development and small fleets."""

    def __init__(self, secret: str | bytes) -> None:
        encoded = secret.encode("utf-8") if isinstance(secret, str) else secret
        if len(encoded) < 16:
            raise DeviceGrantError("device activation secret must be at least 16 bytes")
        self._secret = encoded

    @classmethod
    def from_env(cls) -> StaticDeviceSecretProvider:
        secret = os.environ.get("PIXELDOODLE_DEVICE_ACTIVATION_SECRET", "")
        if not secret:
            environment = os.environ.get("PIXELDOODLE_ENV", "development").strip().lower()
            if environment in {"prod", "production"}:
                raise DeviceGrantError(
                    "PIXELDOODLE_DEVICE_ACTIVATION_SECRET is required in production"
                )
            secret = "local-device-activation-secret-change-me"
        return cls(secret)

    def secret_for(self, device_id: str) -> bytes:
        normalize_device_id(device_id)
        return self._secret


@dataclass(frozen=True)
class DecodedDeviceGrant:
    device_id: str
    duration_seconds: int
    not_after_epoch: int
    grant_sequence: int
    nonce_hex: str
    token_hash: str


def normalize_device_id(device_id: str) -> str:
    normalized = (device_id or "").strip().upper()
    if not DEVICE_ID_PATTERN.fullmatch(normalized):
        raise DeviceGrantError(
            "device_id must be the 12-character hexadecimal device code"
        )
    return normalized


def _urlsafe_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _urlsafe_decode(value: str) -> bytes:
    try:
        padding = "=" * ((4 - len(value) % 4) % 4)
        decoded = base64.b64decode(value + padding, altchars=b"-_", validate=True)
    except (ValueError, UnicodeEncodeError) as error:
        raise DeviceGrantError("invalid activation token encoding") from error
    if _urlsafe_encode(decoded) != value:
        raise DeviceGrantError("non-canonical activation token encoding")
    return decoded


def create_device_grant(
    device_id: str,
    duration_seconds: int,
    not_after_epoch: int,
    grant_sequence: int,
    secret_provider: DeviceSecretProvider,
    *,
    nonce: bytes | None = None,
) -> str:
    normalized = normalize_device_id(device_id)
    if not MIN_GRANT_SECONDS <= duration_seconds <= MAX_GRANT_SECONDS:
        raise DeviceGrantError(
            f"duration_seconds must be between {MIN_GRANT_SECONDS} and {MAX_GRANT_SECONDS}"
        )
    if not isinstance(not_after_epoch, int) or not 1 <= not_after_epoch < (1 << 63):
        raise DeviceGrantError("not_after_epoch must be a positive signed 64-bit integer")
    if not isinstance(grant_sequence, int) or not 1 <= grant_sequence <= MAX_GRANT_SEQUENCE:
        raise DeviceGrantError("grant_sequence must be a positive signed 64-bit integer")
    raw_nonce = nonce if nonce is not None else secrets.token_bytes(8)
    if len(raw_nonce) != 8:
        raise DeviceGrantError("grant nonce must be exactly 8 bytes")

    body = GRANT_BODY.pack(
        GRANT_VERSION,
        bytes.fromhex(normalized),
        duration_seconds,
        not_after_epoch,
        grant_sequence,
        raw_nonce,
    )
    signature = hmac.new(
        secret_provider.secret_for(normalized), body, hashlib.sha256
    ).digest()[:GRANT_SIGNATURE_BYTES]
    return _urlsafe_encode(body + signature)


def decode_and_verify_device_grant(
    token: str,
    secret_provider: DeviceSecretProvider,
    *,
    expected_device_id: str | None = None,
    now_epoch: int | None = None,
) -> DecodedDeviceGrant:
    raw = _urlsafe_decode(token)
    if len(raw) != GRANT_BYTES:
        raise DeviceGrantError("invalid activation token length")
    body = raw[: GRANT_BODY.size]
    supplied_signature = raw[GRANT_BODY.size :]
    (
        version,
        raw_device_id,
        duration_seconds,
        not_after_epoch,
        grant_sequence,
        nonce,
    ) = GRANT_BODY.unpack(body)
    if version != GRANT_VERSION:
        raise DeviceGrantError("unsupported activation token version")
    device_id = raw_device_id.hex().upper()
    normalize_device_id(device_id)
    if expected_device_id is not None and device_id != normalize_device_id(
        expected_device_id
    ):
        raise DeviceGrantError("activation token belongs to another device")
    expected_signature = hmac.new(
        secret_provider.secret_for(device_id), body, hashlib.sha256
    ).digest()[:GRANT_SIGNATURE_BYTES]
    if not hmac.compare_digest(supplied_signature, expected_signature):
        raise DeviceGrantError("invalid activation token signature")
    if not MIN_GRANT_SECONDS <= duration_seconds <= MAX_GRANT_SECONDS:
        raise DeviceGrantError("invalid activation duration")
    if not 1 <= not_after_epoch < (1 << 63):
        raise DeviceGrantError("invalid activation not-after time")
    if not 1 <= grant_sequence <= MAX_GRANT_SEQUENCE:
        raise DeviceGrantError("invalid activation grant sequence")
    if now_epoch is not None and now_epoch >= not_after_epoch:
        raise DeviceGrantError("device activation grant expired")
    return DecodedDeviceGrant(
        device_id=device_id,
        duration_seconds=duration_seconds,
        not_after_epoch=not_after_epoch,
        grant_sequence=grant_sequence,
        nonce_hex=nonce.hex(),
        token_hash=hashlib.sha256(raw).hexdigest(),
    )


def token_to_wire_bytes(token: str) -> bytes:
    """Decode an API token into the exact 51-byte BLE activation payload."""

    raw = _urlsafe_decode(token)
    if len(raw) != GRANT_BYTES:
        raise DeviceGrantError("invalid activation token length")
    return raw
