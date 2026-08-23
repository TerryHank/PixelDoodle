import json
from pathlib import Path
from typing import Any


class GalleryArchive:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self._catalog: list[dict[str, Any]] | None = None
        self._catalog_by_id: dict[int, dict[str, Any]] | None = None

    def _load_catalog(self) -> list[dict[str, Any]]:
        if self._catalog is None:
            catalog_path = self.root / "catalog.json"
            parsed = json.loads(catalog_path.read_text(encoding="utf-8"))
            if not isinstance(parsed, list):
                raise ValueError("gallery catalog is not an array")
            self._catalog = parsed
        return self._catalog

    def _by_id(self) -> dict[int, dict[str, Any]]:
        if self._catalog_by_id is None:
            self._catalog_by_id = {
                int(item["id"]): item for item in self._load_catalog()
            }
        return self._catalog_by_id

    def _resolve_work_path(self, relative_path: str) -> Path:
        resolved = (self.root / relative_path).resolve()
        if resolved != self.root and self.root not in resolved.parents:
            raise ValueError("gallery work path escapes the data root")
        return resolved

    def _read_work(self, item: dict[str, Any]) -> dict[str, Any]:
        work = json.loads(
            self._resolve_work_path(str(item["workPath"])).read_text(encoding="utf-8")
        )
        return {
            **work,
            "id": int(item["id"]),
            "createdAt": item["createdAt"],
            "access": "public",
            "source": item["source"],
            "category": item["category"],
            "tags": item.get("tags", []),
        }

    def get_work(self, work_id: int) -> dict[str, Any] | None:
        item = self._by_id().get(work_id)
        return self._read_work(item) if item else None

    def list_works(
        self,
        *,
        page: int = 1,
        per_page: int = 20,
        query: str = "",
        source: str = "",
        category: str = "",
        max_width: int | None = None,
        max_height: int | None = None,
    ) -> dict[str, Any]:
        page = max(1, int(page))
        per_page = min(100, max(1, int(per_page)))
        terms = query.strip().casefold().split()
        source = source.strip()
        category = category.strip()

        def matches(item: dict[str, Any]) -> bool:
            if item.get("access") != "public":
                return False
            if source and item.get("source") != source:
                return False
            if category and item.get("category") != category:
                return False
            if max_width and int(item.get("width", 0)) > max_width:
                return False
            if max_height and int(item.get("height", 0)) > max_height:
                return False
            if terms:
                search_text = " ".join(
                    [
                        str(item.get("title", "")),
                        str(item.get("category", "")),
                        *[str(tag) for tag in item.get("tags", [])],
                    ]
                ).casefold()
                return all(term in search_text for term in terms)
            return True

        filtered = [item for item in self._load_catalog() if matches(item)]
        offset = (page - 1) * per_page
        page_items = filtered[offset : offset + per_page]
        return {
            "works": [self._read_work(item) for item in page_items],
            "hasMore": offset + len(page_items) < len(filtered),
            "total": len(filtered),
            "page": page,
            "perPage": per_page,
        }
