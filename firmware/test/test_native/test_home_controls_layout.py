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


class HomeControlsLayoutTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app_js = APP_JS.read_text(encoding="utf-8")
        cls.index_html = INDEX_HTML.read_text(encoding="utf-8")
        cls.style_css = STYLE_CSS.read_text(encoding="utf-8")

    def test_toolbar_uses_home_button(self):
        self.assertIn('id="home-btn"', self.index_html)
        self.assertIn('onclick="goHome()"', self.index_html)
        self.assertIn('title="回到主页"', self.index_html)
        toolbar_match = re.search(r'<div class="canvas-toolbar">(?P<body>.*?)</div>\s*<!-- Canvas Container', self.index_html, re.S)
        self.assertIsNotNone(toolbar_match)
        self.assertRegex(toolbar_match.group('body'), re.compile(r'<button id="home-btn".*?</button>\s*<button id="bg-toggle"', re.S))

    def test_toolbar_uses_export_button_instead_of_settings_button(self):
        self.assertIn('title="导出"', self.index_html)
        self.assertIn('onclick="showExportDialog()"', self.index_html)
        self.assertNotIn('title="设置"', self.index_html)

    def test_home_no_longer_renders_brightness_panel(self):
        self.assertNotIn('home-brightness-panel', self.index_html)
        self.assertNotIn('brightness-slider', self.index_html)
        self.assertRegex(
            self.index_html,
            re.compile(
                r'<!-- Color Panel -->.*?</div>\s*'
                r'</div>\s*</div>\s*<script src="/static/i18n\.js\?v=v10">',
                re.S,
            ),
        )

    def test_ble_dialog_only_contains_connection_controls(self):
        modal_match = re.search(r'<div id="serial-settings-dialog".*?</div>\s*</div>\s*</div>', self.index_html, re.S)
        self.assertIsNotNone(modal_match)
        modal_html = modal_match.group(0)
        self.assertIn('id="ble-device-list"', modal_html)
        self.assertIn('id="ble-add-device-btn"', modal_html)
        self.assertNotIn('brightness-slider', modal_html)
        self.assertNotIn('serial-bg-color', modal_html)
        self.assertNotIn('exportPNG()', modal_html)
        self.assertNotIn('exportPDF()', modal_html)
        self.assertNotIn('exportJSON()', modal_html)

    def test_export_dialog_contains_format_choices(self):
        modal_match = re.search(r'<div id="export-dialog".*?</div>\s*</div>\s*</div>', self.index_html, re.S)
        self.assertIsNotNone(modal_match)
        modal_html = modal_match.group(0)
        self.assertIn('onclick="exportPNG(); hideExportDialog()"', modal_html)
        self.assertIn('onclick="exportPDF(); hideExportDialog()"', modal_html)
        self.assertIn('onclick="exportJSON(); hideExportDialog()"', modal_html)

    def test_home_brightness_panel_styles_removed(self):
        self.assertNotIn('.home-brightness-panel {', self.style_css)
        self.assertNotIn('.home-brightness-meta {', self.style_css)
        self.assertIn('.site-version-corner {', self.style_css)

    def test_go_home_helper_reuses_home_reset_flow(self):
        body = get_function_body(self.app_js, 'goHome')
        self.assertIn('clearCanvas();', body)

    def test_export_dialog_helpers_exist(self):
        self.assertIn('function showExportDialog()', self.app_js)
        self.assertIn('function hideExportDialog()', self.app_js)


if __name__ == "__main__":
    unittest.main()
