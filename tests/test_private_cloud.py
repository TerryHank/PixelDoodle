from __future__ import annotations

import os
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from core.private_cloud import (
    CANVAS_SCHEMA_VERSION,
    CloudObjectCorrupted,
    CloudObjectNotFound,
    CloudWorkConflict,
    CloudWorkNotFound,
    InvalidCloudWork,
    PrivateCloudService,
    SQLiteWorkObjectStore,
    SQLiteWorkRecordStore,
)


def canvas(*, second_color: str | None = "C02"):
    matrix = [["C01", second_color], [None, None]]
    counts = {"C01": 1}
    if second_color is not None:
        counts[second_color] = counts.get(second_color, 0) + 1
    return {
        "schema_version": CANVAS_SCHEMA_VERSION,
        "grid_size": {"width": 2, "height": 2},
        "pixel_matrix": matrix,
        "color_summary": [
            {"code": code, "count": count, "hex": "#112233"}
            for code, count in counts.items()
        ],
        "total_beads": sum(counts.values()),
        "palette_preset": "221",
        "editor_state": {"zoom": 2},
    }


class PrivateCloudTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "business.db"
        self.service = PrivateCloudService.sqlite(self.db_path)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_create_list_and_read_preserve_current_canvas_contract(self):
        created = self.service.create_work(
            "user-a",
            work_id="work-1",
            title="  我的作品  ",
            source_label="自由创作",
            document=canvas(),
        )

        self.assertEqual(created.record.title, "我的作品")
        self.assertEqual(created.record.version, 1)
        self.assertEqual((created.record.board_width, created.record.board_height), (2, 2))
        self.assertEqual(created.document["pixel_matrix"], canvas()["pixel_matrix"])
        self.assertTrue(created.record.content_sha256)

        page = self.service.list_works("user-a")
        self.assertEqual(page.total, 1)
        self.assertEqual([item.id for item in page.items], ["work-1"])
        self.assertEqual(
            page.to_dict()["items"][0]["grid_size"],
            {"width": 2, "height": 2},
        )
        loaded = self.service.get_work("user-a", "work-1")
        self.assertEqual(loaded.to_dict()["document"]["editor_state"], {"zoom": 2})

    def test_all_operations_are_strictly_scoped_to_the_owner(self):
        self.service.create_work(
            "user-a", work_id="private", title="私有", document=canvas()
        )

        self.assertEqual(self.service.list_works("user-b").total, 0)
        with self.assertRaises(CloudWorkNotFound):
            self.service.get_work("user-b", "private", include_deleted=True)
        with self.assertRaises(CloudWorkNotFound):
            self.service.update_work(
                "user-b",
                "private",
                expected_version=1,
                title="越权修改",
                document=canvas(second_color=None),
            )
        with self.assertRaises(CloudWorkNotFound):
            self.service.delete_work("user-b", "private", expected_version=1)
        self.assertEqual(self.service.get_work("user-a", "private").record.title, "私有")

    def test_same_work_id_is_independent_in_each_user_namespace(self):
        first = self.service.create_work(
            "user-a", work_id="shared-name", title="用户 A", document=canvas()
        )
        second = self.service.create_work(
            "user-b",
            work_id="shared-name",
            title="用户 B",
            document=canvas(second_color=None),
        )

        self.assertEqual(first.record.id, second.record.id)
        self.assertNotEqual(first.record.payload_key, second.record.payload_key)
        self.assertEqual(
            self.service.get_work("user-a", "shared-name").record.title, "用户 A"
        )
        self.assertEqual(
            self.service.get_work("user-b", "shared-name").record.title, "用户 B"
        )

        self.service.delete_work("user-a", "shared-name", expected_version=1)
        self.assertEqual(
            self.service.get_work("user-b", "shared-name").record.version, 1
        )

    def test_global_work_id_schema_is_migrated_without_data_loss(self):
        legacy_path = Path(self.temp_dir.name) / "legacy.db"
        with closing(sqlite3.connect(legacy_path)) as connection:
            connection.executescript(
                """
                CREATE TABLE private_cloud_works (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    source_label TEXT NOT NULL,
                    board_width INTEGER NOT NULL,
                    board_height INTEGER NOT NULL,
                    palette_preset TEXT NOT NULL,
                    total_beads INTEGER NOT NULL,
                    payload_key TEXT NOT NULL UNIQUE,
                    content_sha256 TEXT NOT NULL,
                    version INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    deleted_at TEXT
                );
                INSERT INTO private_cloud_works VALUES (
                    'same-id', 'user-a', '旧作品', '', 2, 2, '221', 2,
                    'legacy/object.json', 'digest', 1,
                    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL
                );
                """
            )

        migrated = SQLiteWorkRecordStore(legacy_path)
        self.assertEqual(
            migrated.get_owned("user-a", "same-id", include_deleted=True).title,
            "旧作品",
        )
        service = PrivateCloudService.sqlite(legacy_path)
        service.create_work(
            "user-b", work_id="same-id", title="新作品", document=canvas()
        )
        with closing(sqlite3.connect(legacy_path)) as connection:
            primary_key = [
                row[1]
                for row in sorted(
                    connection.execute(
                        "PRAGMA table_info(private_cloud_works)"
                    ).fetchall(),
                    key=lambda row: row[5] or 999,
                )
                if row[5]
            ]
            count = connection.execute(
                "SELECT COUNT(*) FROM private_cloud_works WHERE id = 'same-id'"
            ).fetchone()[0]
        self.assertEqual(primary_key, ["user_id", "id"])
        self.assertEqual(count, 2)

    def test_update_uses_optimistic_version_and_keeps_committed_content(self):
        self.service.create_work(
            "user-a", work_id="versioned", title="版本一", document=canvas()
        )
        updated = self.service.update_work(
            "user-a",
            "versioned",
            expected_version=1,
            title="版本二",
            document=canvas(second_color=None),
        )
        self.assertEqual(updated.record.version, 2)
        self.assertEqual(updated.record.total_beads, 1)

        with self.assertRaisesRegex(CloudWorkConflict, "current version is 2"):
            self.service.update_work(
                "user-a",
                "versioned",
                expected_version=1,
                title="过期覆盖",
                document=canvas(),
            )
        loaded = self.service.get_work("user-a", "versioned")
        self.assertEqual(loaded.record.title, "版本二")
        self.assertEqual(loaded.document["total_beads"], 1)

    def test_soft_delete_is_hidden_and_restore_advances_version(self):
        self.service.create_work(
            "user-a", work_id="recoverable", title="可恢复", document=canvas()
        )
        deleted = self.service.delete_work("user-a", "recoverable", expected_version=1)
        self.assertEqual(deleted.version, 2)
        self.assertIsNotNone(deleted.deleted_at)
        self.assertEqual(self.service.list_works("user-a").total, 0)
        self.assertEqual(
            self.service.list_works("user-a", include_deleted=True).total, 1
        )
        with self.assertRaises(CloudWorkNotFound):
            self.service.get_work("user-a", "recoverable")

        deleted_work = self.service.get_work(
            "user-a", "recoverable", include_deleted=True
        )
        self.assertEqual(deleted_work.document["pixel_matrix"], canvas()["pixel_matrix"])
        with self.assertRaises(CloudWorkConflict):
            self.service.restore_work("user-a", "recoverable", expected_version=1)
        restored = self.service.restore_work(
            "user-a", "recoverable", expected_version=2
        )
        self.assertEqual(restored.version, 3)
        self.assertIsNone(restored.deleted_at)

    def test_sqlite_data_survives_service_restart(self):
        self.service.create_work(
            "user-a", work_id="persistent", title="持久化", document=canvas()
        )
        restarted = PrivateCloudService.sqlite(self.db_path)
        self.assertEqual(
            restarted.get_work("user-a", "persistent").record.title, "持久化"
        )

    def test_object_storage_is_replaceable(self):
        class MemoryObjectStore:
            def __init__(self):
                self.values = {}

            def put_json(self, key, value):
                if key in self.values:
                    raise CloudWorkConflict("duplicate")
                self.values[key] = dict(value)

            def get_json(self, key):
                value = self.values.get(key)
                return dict(value) if value is not None else None

            def delete(self, key):
                self.values.pop(key, None)

        objects = MemoryObjectStore()
        service = PrivateCloudService(
            SQLiteWorkRecordStore(Path(self.temp_dir.name) / "metadata.db"), objects
        )
        created = service.create_work(
            "user-a", work_id="external-object", title="对象存储", document=canvas()
        )
        self.assertIn(created.record.payload_key, objects.values)
        self.assertEqual(
            service.get_work("user-a", "external-object").document["total_beads"],
            2,
        )

    def test_missing_object_is_reported_as_storage_corruption(self):
        created = self.service.create_work(
            "user-a", work_id="missing-object", title="损坏", document=canvas()
        )
        SQLiteWorkObjectStore(self.db_path).delete(created.record.payload_key)
        with self.assertRaises(CloudObjectNotFound):
            self.service.get_work("user-a", "missing-object")

    def test_digest_detects_tampered_object_content(self):
        created = self.service.create_work(
            "user-a", work_id="tampered", title="校验", document=canvas()
        )
        with closing(sqlite3.connect(self.db_path)) as connection:
            connection.execute(
                "UPDATE private_cloud_objects SET payload_json = ? WHERE object_key = ?",
                ('{"changed":true}', created.record.payload_key),
            )
            connection.commit()
        with self.assertRaises(CloudObjectCorrupted):
            self.service.get_work("user-a", "tampered")

    def test_rectangular_104_by_74_board_round_trips(self):
        rectangular = {
            "grid_size": {"width": 104, "height": 74},
            "pixel_matrix": [[None] * 104 for _ in range(74)],
            "color_summary": [],
            "total_beads": 0,
            "palette_preset": "221",
        }
        created = self.service.create_work(
            "user-a", work_id="rectangular", title="104x74", document=rectangular
        )
        self.assertEqual(
            self.service.get_work("user-a", created.record.id).document["grid_size"],
            {"width": 104, "height": 74},
        )

    def test_canvas_validation_rejects_incompatible_data(self):
        cases = [
            ({**canvas(), "grid_size": {"width": 3, "height": 2}}, "pixel_matrix row"),
            ({**canvas(), "total_beads": 99}, "total_beads"),
            ({**canvas(), "palette_preset": ""}, "palette_preset"),
            ({**canvas(), "schema_version": "unknown/v9"}, "schema_version"),
        ]
        for document, message in cases:
            with self.subTest(message=message):
                with self.assertRaisesRegex(InvalidCloudWork, message):
                    self.service.create_work("user-a", title="无效", document=document)

    def test_default_path_comes_from_shared_business_database_environment(self):
        configured = Path(self.temp_dir.name) / "configured.db"
        with patch.dict(
            os.environ, {"PIXELDOODLE_BUSINESS_DB_PATH": str(configured)}
        ):
            service = PrivateCloudService.sqlite()
            service.create_work("user-a", title="环境配置", document=canvas())

        with closing(sqlite3.connect(configured)) as connection:
            count = connection.execute(
                "SELECT COUNT(*) FROM private_cloud_works"
            ).fetchone()[0]
        self.assertEqual(count, 1)


if __name__ == "__main__":
    unittest.main()
