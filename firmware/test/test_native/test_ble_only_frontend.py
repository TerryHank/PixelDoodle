import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
APP_JS = REPO_ROOT / "static" / "app.js"
INDEX_HTML = REPO_ROOT / "templates" / "index.html"
I18N_JS = REPO_ROOT / "static" / "i18n.js"
STYLE_CSS = REPO_ROOT / "static" / "style.css"
MAIN_PY = REPO_ROOT / "main.py"


class BleOnlyFrontendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app_js = APP_JS.read_text(encoding="utf-8")
        cls.index_html = INDEX_HTML.read_text(encoding="utf-8")
        cls.i18n_js = I18N_JS.read_text(encoding="utf-8")
        cls.style_css = STYLE_CSS.read_text(encoding="utf-8")
        cls.main_py = MAIN_PY.read_text(encoding="utf-8")

    def test_template_removes_wifi_mode_and_panel(self):
        forbidden = [
            'data-mode="wifi"',
            'id="wifi-settings"',
            'id="wifi-device-select"',
            'id="qr-wifi-panel"',
            'id="qr-wifi-list"',
            'id="qr-wifi-connect-btn"',
        ]
        for snippet in forbidden:
            self.assertNotIn(snippet, self.index_html)

    def test_frontend_removes_wifi_runtime_helpers(self):
        forbidden = [
            "function getCurrentWiFiTargetUuid()",
            "async function refreshWiFiDevices()",
            "async function connectAndScanWiFiForTarget(",
            "async function requestWiFiScanViaWebBluetooth(",
            "async function connectSelectedQrWifi()",
            "async function scanNearbyWifiFromSettings()",
            "async function handleToolbarWifiModeSwitch()",
        ]
        for snippet in forbidden:
            self.assertNotIn(snippet, self.app_js)

    def test_frontend_no_longer_uses_wifi_api_routes(self):
        forbidden = [
            "/api/wifi/send",
            "/api/wifi/highlight",
            "/api/wifi/brightness",
            "/api/wifi/register",
        ]
        for snippet in forbidden:
            self.assertNotIn(snippet, self.app_js)

    def test_style_no_longer_contains_wifi_panels(self):
        self.assertNotIn(".qr-wifi-panel", self.style_css)
        self.assertNotIn(".qr-wifi-item", self.style_css)

    def test_i18n_no_longer_contains_wifi_copy(self):
        self.assertNotIn("'wifi.scan_hotspots':", self.i18n_js)
        self.assertNotIn("'wifi.connected':", self.i18n_js)

    def test_backend_no_longer_contains_wifi_routes(self):
        self.assertNotIn("/api/wifi/", self.main_py)
        self.assertNotIn("async def register_wifi_device", self.main_py)


if __name__ == "__main__":
    unittest.main()
