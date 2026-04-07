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


class BleStartupPromptTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app_js = APP_JS.read_text(encoding="utf-8")
        cls.index_html = INDEX_HTML.read_text(encoding="utf-8")
        cls.style_css = STYLE_CSS.read_text(encoding="utf-8")

    def test_template_uses_dedicated_status_header_above_toolbar(self):
        self.assertIn('class="site-status-header"', self.index_html)
        self.assertRegex(
            self.index_html,
            re.compile(
                r'<div class="site-status-header">.*?'
                r'<div class="site-version-badge">v8</div>.*?'
                r'<div id="ble-target-chip" class="header-status-chip".*?</div>.*?'
                r'</div>\s*<!-- Canvas Toolbar -->\s*<div class="canvas-toolbar">',
                re.S,
            ),
        )

    def test_toolbar_no_longer_contains_ble_status_chip(self):
        toolbar_match = re.search(r'<div class="canvas-toolbar">(?P<body>.*?)</div>\s*<!-- Canvas Container', self.index_html, re.S)
        self.assertIsNotNone(toolbar_match)
        self.assertNotIn('ble-target-chip', toolbar_match.group('body'))

    def test_css_has_header_status_layout(self):
        self.assertIn('.site-status-header {', self.style_css)
        self.assertIn('.header-status-chip {', self.style_css)

    def test_startup_prompt_helper_exists(self):
        self.assertIn('function promptBleConnectionOnStartup()', self.app_js)

    def test_startup_prompt_switches_to_ble_and_opens_settings(self):
        body = get_function_body(self.app_js, 'promptBleConnectionOnStartup')
        self.assertIn("setConnectionMode('ble')", body)
        self.assertIn('showSerialSettings()', body)
        self.assertIn('window.appState.bleDevice?.gatt?.connected', body)

    def test_dom_content_loaded_triggers_startup_prompt(self):
        dom_ready = re.search(r"document\.addEventListener\('DOMContentLoaded', \(\) => \{(?P<body>.*?)\n\}\);", self.app_js, re.S)
        self.assertIsNotNone(dom_ready)
        self.assertIn('promptBleConnectionOnStartup();', dom_ready.group('body'))


if __name__ == '__main__':
    unittest.main()
