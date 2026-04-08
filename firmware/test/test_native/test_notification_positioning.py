import re
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
STYLE_CSS = REPO_ROOT / "static" / "style.css"


def get_block(content: str, selector: str) -> str:
    pattern = rf"{re.escape(selector)}\s*\{{(?P<body>.*?)\n\}}"
    match = re.search(pattern, content, re.S)
    if not match:
        raise AssertionError(f"{selector} block not found")
    return match.group("body")


class NotificationPositioningTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.style_css = STYLE_CSS.read_text(encoding="utf-8")

    def test_toast_container_is_left_top_aligned(self):
        body = get_block(self.style_css, ".toast-container")
        self.assertIn("top: 24px;", body)
        self.assertIn("left: 24px;", body)
        self.assertNotIn("left: 50%;", body)
        self.assertNotIn("transform: translateX(-50%);", body)
        self.assertIn("align-items: flex-start;", body)

    def test_serial_toast_is_left_top_aligned(self):
        body = get_block(self.style_css, ".serial-toast")
        self.assertIn("top: 24px;", body)
        self.assertIn("left: 24px;", body)
        self.assertNotIn("bottom: 20px;", body)
        self.assertNotIn("left: 50%;", body)
        self.assertNotIn("transform: translateX(-50%);", body)

    def test_ble_quick_connect_is_left_top_aligned(self):
        body = get_block(self.style_css, ".ble-quick-connect")
        self.assertIn("top: 24px;", body)
        self.assertIn("left: 24px;", body)
        self.assertNotIn("bottom: 24px;", body)
        self.assertNotIn("left: 50%;", body)
        self.assertNotIn("transform: translateX(-50%);", body)


if __name__ == "__main__":
    unittest.main()
