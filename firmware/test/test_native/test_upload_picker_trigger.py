import re
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
APP_JS = REPO_ROOT / "static" / "app.js"
INDEX_HTML = REPO_ROOT / "templates" / "index.html"
STYLE_CSS = REPO_ROOT / "static" / "style.css"


def get_function_body(content: str, name: str) -> str:
    match = re.search(rf"(?:async\s+)?function {re.escape(name)}\([^)]*\) \{{(?P<body>.*?)\n\}}", content, re.S)
    if not match:
        raise AssertionError(f"{name} function not found")
    return match.group("body")


class UploadPickerTriggerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app_js = APP_JS.read_text(encoding="utf-8")
        cls.index_html = INDEX_HTML.read_text(encoding="utf-8")
        cls.style_css = STYLE_CSS.read_text(encoding="utf-8")

    def test_toolbar_upload_trigger_uses_label_binding(self):
        self.assertRegex(
            self.index_html,
            re.compile(r'<label id="upload-btn" class="toolbar-btn" for="file-input" title="上传">', re.S),
        )
        self.assertNotIn('id="upload-btn" class="toolbar-btn" onclick="document.getElementById(\'file-input\').click()"', self.index_html)

    def test_upload_area_uses_label_binding(self):
        self.assertRegex(
            self.index_html,
            re.compile(r'<label id="upload-area" class="upload-area" for="file-input">', re.S),
        )
        self.assertNotIn('id="upload-area" class="upload-area" onclick="document.getElementById(\'file-input\').click()"', self.index_html)

    def test_render_ble_status_does_not_reintroduce_programmatic_click_bridge(self):
        body = get_function_body(self.app_js, 'renderBleStatus')
        self.assertNotIn("uploadArea.onclick = () => document.getElementById('file-input').click();", body)
        self.assertIn("uploadArea.className = 'upload-area';", body)

    def test_hidden_input_is_visually_hidden_not_display_none(self):
        hidden_input_block = re.search(r"\.hidden-input\s*\{(?P<body>.*?)\n\}", self.style_css, re.S)
        self.assertIsNotNone(hidden_input_block)
        body = hidden_input_block.group("body")
        self.assertNotIn("display: none;", body)
        self.assertIn("position: absolute;", body)
        self.assertIn("opacity: 0;", body)


if __name__ == "__main__":
    unittest.main()
