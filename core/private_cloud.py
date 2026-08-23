"""User-isolated private cloud storage for PixelDoodle canvas works.

The domain service deliberately separates mutable work metadata from immutable
canvas objects.  The default implementations use the shared business SQLite
database, while a production deployment can replace either protocol with a
database or object-storage adapter.
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Protocol, Sequence


DEFAULT_BUSINESS_DB_PATH = Path("data") / "pixeldoodle-business.db"
CANVAS_SCHEMA_VERSION = "pixeldoodle.canvas/v1"
MAX_CANVAS_DIMENSION = 104
MAX_CANVAS_JSON_BYTES = 2 * 1024 * 1024


class PrivateCloudError(Exception):
    """Base error for the private-cloud domain."""


class InvalidCloudWork(PrivateCloudError):
    """The submitted canvas document or metadata is invalid."""


class CloudWorkNotFound(PrivateCloudError):
    """The work does not exist for the current user."""


class CloudWorkConflict(PrivateCloudError):
    """The expected version no longer matches the stored work."""


class CloudObjectNotFound(PrivateCloudError):
    """The metadata points at a missing canvas object."""


class CloudObjectCorrupted(PrivateCloudError):
    """The stored canvas object no longer matches its recorded digest."""


@dataclass(frozen=True)
class CloudWorkRecord:
    id: str
    user_id: str
    title: str
    source_label: str
    board_width: int
    board_height: int
    palette_preset: str
    total_beads: int
    payload_key: str
    content_sha256: str
    version: int
    created_at: str
    updated_at: str
    deleted_at: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "source_label": self.source_label,
            "grid_size": {
                "width": self.board_width,
                "height": self.board_height,
            },
            "palette_preset": self.palette_preset,
            "total_beads": self.total_beads,
            "version": self.version,
            "content_sha256": self.content_sha256,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "deleted_at": self.deleted_at,
        }


@dataclass(frozen=True)
class CloudWork:
    record: CloudWorkRecord
    document: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {**self.record.to_dict(), "document": self.document}


@dataclass(frozen=True)
class CloudWorkPage:
    items: Sequence[CloudWorkRecord]
    total: int
    limit: int
    offset: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "items": [item.to_dict() for item in self.items],
            "total": self.total,
            "limit": self.limit,
            "offset": self.offset,
        }


class WorkRecordStore(Protocol):
    """Mutable metadata store; implementations must enforce compare-and-swap."""

    def create(self, record: CloudWorkRecord) -> CloudWorkRecord: ...

    def get_owned(
        self, user_id: str, work_id: str, *, include_deleted: bool = False
    ) -> CloudWorkRecord | None: ...

    def list_owned(
        self,
        user_id: str,
        *,
        include_deleted: bool,
        limit: int,
        offset: int,
    ) -> CloudWorkPage: ...

    def update_content(
        self,
        user_id: str,
        work_id: str,
        *,
        expected_version: int,
        title: str,
        source_label: str,
        board_width: int,
        board_height: int,
        palette_preset: str,
        total_beads: int,
        payload_key: str,
        content_sha256: str,
        updated_at: str,
    ) -> CloudWorkRecord: ...

    def set_deleted(
        self,
        user_id: str,
        work_id: str,
        *,
        expected_version: int,
        deleted: bool,
        updated_at: str,
    ) -> CloudWorkRecord: ...


class WorkObjectStore(Protocol):
    """Immutable JSON object store; keys are unique for every work version."""

    def put_json(self, key: str, value: Mapping[str, Any]) -> None: ...

    def get_json(self, key: str) -> dict[str, Any] | None: ...

    def delete(self, key: str) -> None: ...


def resolve_business_db_path(path: str | Path | None = None) -> Path:
    if path is not None:
        return Path(path)
    return Path(
        os.environ.get(
            "PIXELDOODLE_BUSINESS_DB_PATH", str(DEFAULT_BUSINESS_DB_PATH)
        )
    )


def _utc_iso() -> str:
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="microseconds")
        .replace("+00:00", "Z")
    )


def _canonical_json(value: Mapping[str, Any]) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


@contextmanager
def _connect(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=5.0)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA busy_timeout = 5000")
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def _record_from_row(row: sqlite3.Row) -> CloudWorkRecord:
    return CloudWorkRecord(
        id=row["id"],
        user_id=row["user_id"],
        title=row["title"],
        source_label=row["source_label"],
        board_width=row["board_width"],
        board_height=row["board_height"],
        palette_preset=row["palette_preset"],
        total_beads=row["total_beads"],
        payload_key=row["payload_key"],
        content_sha256=row["content_sha256"],
        version=row["version"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        deleted_at=row["deleted_at"],
    )


class SQLiteWorkRecordStore:
    """SQLite metadata adapter for private works."""

    def __init__(self, db_path: str | Path | None = None):
        self.db_path = resolve_business_db_path(db_path)
        self._initialize()

    def _initialize(self) -> None:
        with _connect(self.db_path) as connection:
            existing = connection.execute(
                "SELECT 1 FROM sqlite_master "
                "WHERE type = 'table' AND name = 'private_cloud_works'"
            ).fetchone()
            if existing is None:
                self._create_table(connection)
            else:
                primary_key = [
                    row["name"]
                    for row in sorted(
                        connection.execute(
                            "PRAGMA table_info(private_cloud_works)"
                        ).fetchall(),
                        key=lambda item: item["pk"] or 999,
                    )
                    if row["pk"]
                ]
                if primary_key != ["user_id", "id"]:
                    self._migrate_global_id_schema(connection)
            self._create_indexes(connection)

    @staticmethod
    def _create_table(connection: sqlite3.Connection) -> None:
        connection.execute(
            """
            CREATE TABLE private_cloud_works (
                id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                title TEXT NOT NULL,
                source_label TEXT NOT NULL,
                board_width INTEGER NOT NULL CHECK (board_width > 0),
                board_height INTEGER NOT NULL CHECK (board_height > 0),
                palette_preset TEXT NOT NULL,
                total_beads INTEGER NOT NULL CHECK (total_beads >= 0),
                payload_key TEXT NOT NULL UNIQUE,
                content_sha256 TEXT NOT NULL,
                version INTEGER NOT NULL CHECK (version > 0),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted_at TEXT,
                PRIMARY KEY (user_id, id)
            )
            """
        )

    @staticmethod
    def _create_indexes(connection: sqlite3.Connection) -> None:
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_private_cloud_works_user_updated "
            "ON private_cloud_works(user_id, updated_at DESC, id DESC)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_private_cloud_works_user_deleted "
            "ON private_cloud_works(user_id, deleted_at)"
        )

    @classmethod
    def _migrate_global_id_schema(cls, connection: sqlite3.Connection) -> None:
        legacy_table = "private_cloud_works_legacy_global_id"
        collision = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
            (legacy_table,),
        ).fetchone()
        if collision is not None:
            raise RuntimeError("private cloud schema migration is already in progress")

        connection.execute("BEGIN IMMEDIATE")
        connection.execute("DROP INDEX IF EXISTS idx_private_cloud_works_user_updated")
        connection.execute("DROP INDEX IF EXISTS idx_private_cloud_works_user_deleted")
        connection.execute(
            f"ALTER TABLE private_cloud_works RENAME TO {legacy_table}"
        )
        cls._create_table(connection)
        connection.execute(
            f"""
            INSERT INTO private_cloud_works (
                id, user_id, title, source_label, board_width, board_height,
                palette_preset, total_beads, payload_key, content_sha256,
                version, created_at, updated_at, deleted_at
            )
            SELECT
                id, user_id, title, source_label, board_width, board_height,
                palette_preset, total_beads, payload_key, content_sha256,
                version, created_at, updated_at, deleted_at
            FROM {legacy_table}
            """
        )
        connection.execute(f"DROP TABLE {legacy_table}")

    def create(self, record: CloudWorkRecord) -> CloudWorkRecord:
        try:
            with _connect(self.db_path) as connection:
                connection.execute(
                    """
                    INSERT INTO private_cloud_works (
                        id, user_id, title, source_label, board_width,
                        board_height, palette_preset, total_beads, payload_key,
                        content_sha256, version, created_at, updated_at, deleted_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        record.id,
                        record.user_id,
                        record.title,
                        record.source_label,
                        record.board_width,
                        record.board_height,
                        record.palette_preset,
                        record.total_beads,
                        record.payload_key,
                        record.content_sha256,
                        record.version,
                        record.created_at,
                        record.updated_at,
                        record.deleted_at,
                    ),
                )
        except sqlite3.IntegrityError as exc:
            raise CloudWorkConflict("work id already exists for this user") from exc
        return record

    def get_owned(
        self, user_id: str, work_id: str, *, include_deleted: bool = False
    ) -> CloudWorkRecord | None:
        deleted_clause = "" if include_deleted else " AND deleted_at IS NULL"
        with _connect(self.db_path) as connection:
            row = connection.execute(
                "SELECT * FROM private_cloud_works "
                f"WHERE id = ? AND user_id = ?{deleted_clause}",
                (work_id, user_id),
            ).fetchone()
        return _record_from_row(row) if row is not None else None

    def list_owned(
        self,
        user_id: str,
        *,
        include_deleted: bool,
        limit: int,
        offset: int,
    ) -> CloudWorkPage:
        deleted_clause = "" if include_deleted else " AND deleted_at IS NULL"
        with _connect(self.db_path) as connection:
            total = connection.execute(
                "SELECT COUNT(*) FROM private_cloud_works "
                f"WHERE user_id = ?{deleted_clause}",
                (user_id,),
            ).fetchone()[0]
            rows = connection.execute(
                "SELECT * FROM private_cloud_works "
                f"WHERE user_id = ?{deleted_clause} "
                "ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?",
                (user_id, limit, offset),
            ).fetchall()
        return CloudWorkPage(
            items=tuple(_record_from_row(row) for row in rows),
            total=total,
            limit=limit,
            offset=offset,
        )

    def update_content(
        self,
        user_id: str,
        work_id: str,
        *,
        expected_version: int,
        title: str,
        source_label: str,
        board_width: int,
        board_height: int,
        palette_preset: str,
        total_beads: int,
        payload_key: str,
        content_sha256: str,
        updated_at: str,
    ) -> CloudWorkRecord:
        with _connect(self.db_path) as connection:
            cursor = connection.execute(
                """
                UPDATE private_cloud_works
                SET title = ?, source_label = ?, board_width = ?,
                    board_height = ?, palette_preset = ?, total_beads = ?,
                    payload_key = ?, content_sha256 = ?,
                    version = version + 1, updated_at = ?
                WHERE id = ? AND user_id = ? AND version = ?
                    AND deleted_at IS NULL
                """,
                (
                    title,
                    source_label,
                    board_width,
                    board_height,
                    palette_preset,
                    total_beads,
                    payload_key,
                    content_sha256,
                    updated_at,
                    work_id,
                    user_id,
                    expected_version,
                ),
            )
            if cursor.rowcount != 1:
                self._raise_cas_failure(connection, user_id, work_id)
            row = connection.execute(
                "SELECT * FROM private_cloud_works WHERE id = ? AND user_id = ?",
                (work_id, user_id),
            ).fetchone()
        return _record_from_row(row)

    def set_deleted(
        self,
        user_id: str,
        work_id: str,
        *,
        expected_version: int,
        deleted: bool,
        updated_at: str,
    ) -> CloudWorkRecord:
        state_clause = "deleted_at IS NOT NULL" if not deleted else "deleted_at IS NULL"
        deleted_at = updated_at if deleted else None
        with _connect(self.db_path) as connection:
            cursor = connection.execute(
                f"""
                UPDATE private_cloud_works
                SET deleted_at = ?, version = version + 1, updated_at = ?
                WHERE id = ? AND user_id = ? AND version = ? AND {state_clause}
                """,
                (
                    deleted_at,
                    updated_at,
                    work_id,
                    user_id,
                    expected_version,
                ),
            )
            if cursor.rowcount != 1:
                self._raise_cas_failure(connection, user_id, work_id)
            row = connection.execute(
                "SELECT * FROM private_cloud_works WHERE id = ? AND user_id = ?",
                (work_id, user_id),
            ).fetchone()
        return _record_from_row(row)

    @staticmethod
    def _raise_cas_failure(
        connection: sqlite3.Connection, user_id: str, work_id: str
    ) -> None:
        row = connection.execute(
            "SELECT version FROM private_cloud_works WHERE id = ? AND user_id = ?",
            (work_id, user_id),
        ).fetchone()
        if row is None:
            raise CloudWorkNotFound("work not found")
        raise CloudWorkConflict(
            f"work version conflict; current version is {row['version']}"
        )


class SQLiteWorkObjectStore:
    """SQLite JSON-object adapter; objects are immutable by key."""

    def __init__(self, db_path: str | Path | None = None):
        self.db_path = resolve_business_db_path(db_path)
        self._initialize()

    def _initialize(self) -> None:
        with _connect(self.db_path) as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS private_cloud_objects (
                    object_key TEXT PRIMARY KEY,
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )

    def put_json(self, key: str, value: Mapping[str, Any]) -> None:
        payload = _canonical_json(value)
        try:
            with _connect(self.db_path) as connection:
                connection.execute(
                    """
                    INSERT INTO private_cloud_objects (
                        object_key, payload_json, created_at
                    ) VALUES (?, ?, ?)
                    """,
                    (key, payload, _utc_iso()),
                )
        except sqlite3.IntegrityError as exc:
            raise CloudWorkConflict("cloud object key already exists") from exc

    def get_json(self, key: str) -> dict[str, Any] | None:
        with _connect(self.db_path) as connection:
            row = connection.execute(
                "SELECT payload_json FROM private_cloud_objects WHERE object_key = ?",
                (key,),
            ).fetchone()
        if row is None:
            return None
        value = json.loads(row["payload_json"])
        return value if isinstance(value, dict) else None

    def delete(self, key: str) -> None:
        with _connect(self.db_path) as connection:
            connection.execute(
                "DELETE FROM private_cloud_objects WHERE object_key = ?", (key,)
            )


class PrivateCloudService:
    """Private-work use cases with strict ownership and optimistic locking."""

    def __init__(
        self,
        records: WorkRecordStore,
        objects: WorkObjectStore,
    ):
        self.records = records
        self.objects = objects

    @classmethod
    def sqlite(cls, db_path: str | Path | None = None) -> "PrivateCloudService":
        resolved = resolve_business_db_path(db_path)
        return cls(SQLiteWorkRecordStore(resolved), SQLiteWorkObjectStore(resolved))

    def create_work(
        self,
        user_id: str,
        *,
        title: str,
        document: Mapping[str, Any],
        source_label: str = "",
        work_id: str | None = None,
    ) -> CloudWork:
        owner = _validate_user_id(user_id)
        normalized_title = _validate_text(title, "title", maximum=120, required=True)
        normalized_source = _validate_text(
            source_label, "source_label", maximum=80, required=False
        )
        canvas, encoded, digest = _validate_canvas_document(document)
        identifier = _validate_work_id(work_id) if work_id else uuid.uuid4().hex
        payload_key = _payload_key(owner, identifier, 1)
        now = _utc_iso()
        grid_size = canvas["grid_size"]
        record = CloudWorkRecord(
            id=identifier,
            user_id=owner,
            title=normalized_title,
            source_label=normalized_source,
            board_width=grid_size["width"],
            board_height=grid_size["height"],
            palette_preset=canvas["palette_preset"],
            total_beads=canvas["total_beads"],
            payload_key=payload_key,
            content_sha256=digest,
            version=1,
            created_at=now,
            updated_at=now,
        )

        self.objects.put_json(payload_key, canvas)
        try:
            record = self.records.create(record)
        except Exception:
            self.objects.delete(payload_key)
            raise
        return CloudWork(record=record, document=json.loads(encoded))

    def get_work(
        self, user_id: str, work_id: str, *, include_deleted: bool = False
    ) -> CloudWork:
        owner = _validate_user_id(user_id)
        identifier = _validate_work_id(work_id)
        record = self.records.get_owned(
            owner, identifier, include_deleted=include_deleted
        )
        if record is None:
            raise CloudWorkNotFound("work not found")
        document = self.objects.get_json(record.payload_key)
        if document is None:
            raise CloudObjectNotFound("stored canvas object is missing")
        actual_digest = hashlib.sha256(
            _canonical_json(document).encode("utf-8")
        ).hexdigest()
        if actual_digest != record.content_sha256:
            raise CloudObjectCorrupted("stored canvas object failed integrity check")
        return CloudWork(record=record, document=document)

    def list_works(
        self,
        user_id: str,
        *,
        include_deleted: bool = False,
        limit: int = 50,
        offset: int = 0,
    ) -> CloudWorkPage:
        owner = _validate_user_id(user_id)
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 100:
            raise InvalidCloudWork("limit must be an integer from 1 to 100")
        if isinstance(offset, bool) or not isinstance(offset, int) or offset < 0:
            raise InvalidCloudWork("offset must be a non-negative integer")
        return self.records.list_owned(
            owner,
            include_deleted=include_deleted,
            limit=limit,
            offset=offset,
        )

    def update_work(
        self,
        user_id: str,
        work_id: str,
        *,
        expected_version: int,
        document: Mapping[str, Any],
        title: str | None = None,
        source_label: str | None = None,
    ) -> CloudWork:
        owner = _validate_user_id(user_id)
        identifier = _validate_work_id(work_id)
        expected = _validate_version(expected_version)
        current = self.records.get_owned(owner, identifier)
        if current is None:
            raise CloudWorkNotFound("work not found")
        if current.version != expected:
            raise CloudWorkConflict(
                f"work version conflict; current version is {current.version}"
            )

        normalized_title = (
            current.title
            if title is None
            else _validate_text(title, "title", maximum=120, required=True)
        )
        normalized_source = (
            current.source_label
            if source_label is None
            else _validate_text(
                source_label, "source_label", maximum=80, required=False
            )
        )
        canvas, encoded, digest = _validate_canvas_document(document)
        next_version = expected + 1
        payload_key = _payload_key(owner, identifier, next_version)
        self.objects.put_json(payload_key, canvas)
        grid_size = canvas["grid_size"]
        try:
            record = self.records.update_content(
                owner,
                identifier,
                expected_version=expected,
                title=normalized_title,
                source_label=normalized_source,
                board_width=grid_size["width"],
                board_height=grid_size["height"],
                palette_preset=canvas["palette_preset"],
                total_beads=canvas["total_beads"],
                payload_key=payload_key,
                content_sha256=digest,
                updated_at=_utc_iso(),
            )
        except Exception:
            self.objects.delete(payload_key)
            raise
        return CloudWork(record=record, document=json.loads(encoded))

    def delete_work(
        self, user_id: str, work_id: str, *, expected_version: int
    ) -> CloudWorkRecord:
        return self._set_deleted(
            user_id,
            work_id,
            expected_version=expected_version,
            deleted=True,
        )

    def restore_work(
        self, user_id: str, work_id: str, *, expected_version: int
    ) -> CloudWorkRecord:
        return self._set_deleted(
            user_id,
            work_id,
            expected_version=expected_version,
            deleted=False,
        )

    def _set_deleted(
        self,
        user_id: str,
        work_id: str,
        *,
        expected_version: int,
        deleted: bool,
    ) -> CloudWorkRecord:
        owner = _validate_user_id(user_id)
        identifier = _validate_work_id(work_id)
        return self.records.set_deleted(
            owner,
            identifier,
            expected_version=_validate_version(expected_version),
            deleted=deleted,
            updated_at=_utc_iso(),
        )


def _validate_user_id(value: str) -> str:
    return _validate_text(value, "user_id", maximum=128, required=True)


def _validate_work_id(value: str | None) -> str:
    return _validate_text(value or "", "work_id", maximum=128, required=True)


def _validate_version(value: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise InvalidCloudWork("expected_version must be a positive integer")
    return value


def _validate_text(
    value: str, field: str, *, maximum: int, required: bool
) -> str:
    if not isinstance(value, str):
        raise InvalidCloudWork(f"{field} must be a string")
    normalized = value.strip()
    if required and not normalized:
        raise InvalidCloudWork(f"{field} is required")
    if len(normalized) > maximum:
        raise InvalidCloudWork(f"{field} exceeds {maximum} characters")
    if any(ord(character) < 32 for character in normalized):
        raise InvalidCloudWork(f"{field} contains control characters")
    return normalized


def _validate_canvas_document(
    document: Mapping[str, Any],
) -> tuple[dict[str, Any], str, str]:
    if not isinstance(document, Mapping):
        raise InvalidCloudWork("document must be a JSON object")
    try:
        canvas = json.loads(_canonical_json(document))
    except (TypeError, ValueError, OverflowError) as exc:
        raise InvalidCloudWork("document must contain valid JSON values") from exc

    schema_version = canvas.get("schema_version", CANVAS_SCHEMA_VERSION)
    if schema_version != CANVAS_SCHEMA_VERSION:
        raise InvalidCloudWork(
            f"schema_version must be {CANVAS_SCHEMA_VERSION}"
        )
    canvas["schema_version"] = CANVAS_SCHEMA_VERSION

    grid_size = canvas.get("grid_size")
    if not isinstance(grid_size, dict):
        raise InvalidCloudWork("grid_size must be an object")
    width = _validate_dimension(grid_size.get("width"), "grid_size.width")
    height = _validate_dimension(grid_size.get("height"), "grid_size.height")
    canvas["grid_size"] = {"width": width, "height": height}

    matrix = canvas.get("pixel_matrix")
    if not isinstance(matrix, list) or len(matrix) != height:
        raise InvalidCloudWork("pixel_matrix height must match grid_size.height")
    bead_count = 0
    for row in matrix:
        if not isinstance(row, list) or len(row) != width:
            raise InvalidCloudWork(
                "every pixel_matrix row must match grid_size.width"
            )
        for cell in row:
            if cell is None:
                continue
            if not isinstance(cell, str) or not cell.strip() or len(cell) > 64:
                raise InvalidCloudWork(
                    "pixel_matrix cells must be null or non-empty color-code strings"
                )
            bead_count += 1

    palette_preset = canvas.get("palette_preset")
    canvas["palette_preset"] = _validate_text(
        palette_preset, "palette_preset", maximum=64, required=True
    )

    total_beads = canvas.get("total_beads", bead_count)
    if (
        isinstance(total_beads, bool)
        or not isinstance(total_beads, int)
        or total_beads != bead_count
    ):
        raise InvalidCloudWork(
            "total_beads must equal the number of non-empty pixel cells"
        )
    canvas["total_beads"] = bead_count

    color_summary = canvas.get("color_summary", [])
    if not isinstance(color_summary, list):
        raise InvalidCloudWork("color_summary must be an array")
    for item in color_summary:
        if not isinstance(item, dict):
            raise InvalidCloudWork("color_summary entries must be objects")
        _validate_text(item.get("code"), "color_summary.code", maximum=64, required=True)
        count = item.get("count")
        if isinstance(count, bool) or not isinstance(count, int) or count < 0:
            raise InvalidCloudWork("color_summary.count must be a non-negative integer")
    canvas["color_summary"] = color_summary

    encoded = _canonical_json(canvas)
    if len(encoded.encode("utf-8")) > MAX_CANVAS_JSON_BYTES:
        raise InvalidCloudWork(
            f"canvas document exceeds {MAX_CANVAS_JSON_BYTES} bytes"
        )
    digest = hashlib.sha256(encoded.encode("utf-8")).hexdigest()
    return canvas, encoded, digest


def _validate_dimension(value: Any, field: str) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or not 1 <= value <= MAX_CANVAS_DIMENSION
    ):
        raise InvalidCloudWork(
            f"{field} must be an integer from 1 to {MAX_CANVAS_DIMENSION}"
        )
    return value


def _payload_key(user_id: str, work_id: str, version: int) -> str:
    owner_hash = hashlib.sha256(user_id.encode("utf-8")).hexdigest()[:24]
    return f"private-cloud/{owner_hash}/{work_id}/v{version}.json"


__all__ = [
    "CANVAS_SCHEMA_VERSION",
    "CloudObjectCorrupted",
    "CloudObjectNotFound",
    "CloudWork",
    "CloudWorkConflict",
    "CloudWorkNotFound",
    "CloudWorkPage",
    "CloudWorkRecord",
    "InvalidCloudWork",
    "PrivateCloudError",
    "PrivateCloudService",
    "SQLiteWorkObjectStore",
    "SQLiteWorkRecordStore",
    "WorkObjectStore",
    "WorkRecordStore",
    "resolve_business_db_path",
]
