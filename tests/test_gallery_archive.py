import json
import tempfile
import unittest
from pathlib import Path

from core.gallery_archive import GalleryArchive


class GalleryArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        root = Path(self.temp_dir.name)
        (root / "works").mkdir()
        catalog = [
            {
                "id": 1,
                "title": "皮卡丘",
                "width": 29,
                "height": 29,
                "colorCount": 2,
                "createdAt": "2026-08-23T00:00:00Z",
                "access": "public",
                "source": "community",
                "category": "宝可梦",
                "tags": ["黄色", "Pikachu"],
                "workPath": "works/1.json",
            },
            {
                "id": 2,
                "title": "大型图纸",
                "width": 120,
                "height": 120,
                "colorCount": 1,
                "createdAt": "2026-08-23T00:00:00Z",
                "access": "public",
                "source": "community",
                "category": "其他",
                "tags": [],
                "workPath": "works/2.json",
            },
        ]
        (root / "catalog.json").write_text(
            json.dumps(catalog, ensure_ascii=False), encoding="utf-8"
        )
        for work_id, size in ((1, 29), (2, 120)):
            (root / "works" / f"{work_id}.json").write_text(
                json.dumps(
                    {
                        "v": 2,
                        "access": "public",
                        "title": catalog[work_id - 1]["title"],
                        "width": size,
                        "height": size,
                        "palette": ["#FFFF00"],
                        "keys": ["A1"],
                        "grid": "00",
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
        self.archive = GalleryArchive(root)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_searches_and_filters_without_loading_the_archive_into_the_client(self):
        result = self.archive.list_works(
            query="Pikachu 黄色", max_width=29, max_height=29
        )

        self.assertEqual(result["total"], 1)
        self.assertEqual(result["works"][0]["title"], "皮卡丘")
        self.assertEqual(result["works"][0]["source"], "community")

    def test_returns_a_single_normalized_work(self):
        work = self.archive.get_work(1)

        self.assertIsNotNone(work)
        self.assertEqual(work["id"], 1)
        self.assertEqual(work["category"], "宝可梦")

    def test_rejects_paths_outside_the_gallery_root(self):
        with self.assertRaises(ValueError):
            self.archive._resolve_work_path("../outside.json")


if __name__ == "__main__":
    unittest.main()
