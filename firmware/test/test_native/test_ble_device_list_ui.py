import re
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
APP_JS = REPO_ROOT / "static" / "app.js"
INDEX_HTML = REPO_ROOT / "templates" / "index.html"
STYLE_CSS = REPO_ROOT / "static" / "style.css"
I18N_JS = REPO_ROOT / "static" / "i18n.js"


class BleDeviceListUiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app_js = APP_JS.read_text(encoding="utf-8")
        cls.index_html = INDEX_HTML.read_text(encoding="utf-8")
        cls.style_css = STYLE_CSS.read_text(encoding="utf-8")
        cls.i18n_js = I18N_JS.read_text(encoding="utf-8")

    def test_template_uses_ble_device_list_instead_of_select_and_connect_button(self):
        self.assertIn('id="ble-device-list"', self.index_html)
        self.assertIn('id="ble-add-device-btn"', self.index_html)
        self.assertNotIn('id="ble-device-select"', self.index_html)
        self.assertNotIn('id="ble-connect-btn"', self.index_html)

    def test_frontend_has_authorized_device_list_helpers(self):
        required = [
            "bleKnownDevices:",
            "async function getAuthorizedBLEDevices()",
            "function renderBleDeviceList()",
            "async function connectKnownBLEDevice(",
            "navigator.bluetooth.getDevices()",
        ]
        for snippet in required:
            self.assertIn(snippet, self.app_js)

    def test_refresh_ble_devices_populates_authorized_devices(self):
        body = re.search(r"async function refreshBLEDevices\(\) \{(?P<body>.*?)\n\}", self.app_js, re.S)
        self.assertIsNotNone(body)
        content = body.group("body")
        self.assertIn("getAuthorizedBLEDevices()", content)
        self.assertIn("window.appState.bleKnownDevices", content)
        self.assertIn("renderBleDeviceList()", content)

    def test_render_ble_status_no_longer_depends_on_connect_button(self):
        body = re.search(r"function renderBleStatus\(\) \{(?P<body>.*?)\n\}", self.app_js, re.S)
        self.assertIsNotNone(body)
        self.assertNotIn("ble-connect-btn", body.group("body"))

    def test_styles_exist_for_radio_device_rows(self):
        for snippet in [
            ".ble-device-list {",
            ".ble-device-option {",
            ".ble-device-radio {",
            ".ble-device-option.connected {",
        ]:
            self.assertIn(snippet, self.style_css)

    def test_i18n_has_device_list_copy(self):
        for snippet in [
            "'ble.add_device':",
            "'ble.authorized_device':",
            "'ble.remembered_device_needs_pair':",
        ]:
            self.assertIn(snippet, self.i18n_js)


if __name__ == "__main__":
    unittest.main()
