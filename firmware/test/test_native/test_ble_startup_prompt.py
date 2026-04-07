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

    def test_toolbar_places_home_button_at_far_left(self):
        toolbar_match = re.search(r'<div class="canvas-toolbar">(?P<body>.*?)</div>\s*<!-- Canvas Container', self.index_html, re.S)
        self.assertIsNotNone(toolbar_match)
        body = toolbar_match.group('body')
        self.assertRegex(body, re.compile(r'<button id="home-btn".*?</button>\s*<button id="bg-toggle"', re.S))

    def test_template_places_version_badge_outside_toolbar(self):
        self.assertIn('class="site-version-badge site-version-corner">v9</div>', self.index_html)
        toolbar_match = re.search(r'<div class="canvas-toolbar">(?P<body>.*?)</div>\s*<!-- Canvas Container', self.index_html, re.S)
        self.assertIsNotNone(toolbar_match)
        self.assertNotIn('site-version-badge', toolbar_match.group('body'))

    def test_template_no_longer_uses_status_header_or_chip(self):
        self.assertNotIn('class="site-status-header"', self.index_html)
        self.assertNotIn('ble-target-chip', self.index_html)

    def test_css_has_quick_status_button_states(self):
        self.assertIn('.mode-quick-btn.connected {', self.style_css)
        self.assertIn('.mode-quick-btn.disconnected {', self.style_css)

    def test_dom_content_loaded_does_not_force_ble_popup(self):
        dom_ready = re.search(r"document\.addEventListener\('DOMContentLoaded', \(\) => \{(?P<body>.*?)\n\}\);", self.app_js, re.S)
        self.assertIsNotNone(dom_ready)
        self.assertNotIn('promptBleConnectionOnStartup();', dom_ready.group('body'))

    def test_quick_status_button_defaults_to_disconnected_text(self):
        self.assertIn('未连接', self.index_html)
        self.assertIn("function updateConnectionModeQuickButton()", self.app_js)

    def test_quick_status_button_uses_ble_prefix_when_connected(self):
        body = get_function_body(self.app_js, 'updateConnectionModeQuickButton')
        self.assertIn("connectedUuid.slice(0, 4)", body)
        self.assertIn("btn.classList.toggle('connected', !!connectedUuid)", body)
        self.assertIn("btn.classList.toggle('disconnected', !connectedUuid)", body)


if __name__ == '__main__':
    unittest.main()
