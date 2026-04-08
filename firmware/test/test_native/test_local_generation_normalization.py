import re
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
APP_JS = REPO_ROOT / "static" / "app.js"


def get_function_body(content: str, name: str) -> str:
    match = re.search(
        rf"(?:async\s+)?function {re.escape(name)}\([^)]*\) \{{(?P<body>.*?)\n\}}",
        content,
        re.S,
    )
    if not match:
        raise AssertionError(f"{name} function not found")
    return match.group("body")


class LocalGenerationNormalizationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app_js = APP_JS.read_text(encoding="utf-8")

    def test_grid_size_normalizer_exists(self):
        body = get_function_body(self.app_js, "normalizeGridSize")
        self.assertIn("height:", body)
        self.assertIn("width:", body)

    def test_color_summary_normalizer_exists(self):
        body = get_function_body(self.app_js, "normalizeColorSummary")
        self.assertIn("code:", body)
        self.assertIn("count:", body)
        self.assertIn("hex:", body)
        self.assertIn("name:", body)
        self.assertIn("name_zh:", body)
        self.assertIn("rgb:", body)

    def test_apply_generated_pattern_normalizes_local_shape(self):
        body = get_function_body(self.app_js, "applyGeneratedPattern")
        self.assertIn("normalizeGridSize(data.grid_size)", body)
        self.assertIn("normalizePixelMatrixNulls(data.pixel_matrix)", body)
        self.assertIn("normalizeColorSummary(data.color_summary)", body)


if __name__ == "__main__":
    unittest.main()
