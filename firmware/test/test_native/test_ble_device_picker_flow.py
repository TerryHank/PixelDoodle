import re
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
APP_JS = REPO_ROOT / "static" / "app.js"
INDEX_HTML = REPO_ROOT / "templates" / "index.html"


class BleDevicePickerFlowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app_js = APP_JS.read_text(encoding="utf-8")
        cls.index_html = INDEX_HTML.read_text(encoding="utf-8")

    def test_add_device_button_uses_dedicated_add_flow(self):
        self.assertIn('id="ble-add-device-btn"', self.index_html)
        self.assertIn('onclick="addBLEDevice()"', self.index_html)

    def test_request_ble_device_supports_forced_picker(self):
        signature = re.search(r"async function requestBLEDevice\((?P<args>[^)]*)\)", self.app_js)
        self.assertIsNotNone(signature)
        self.assertIn("forcePicker", signature.group("args"))
        self.assertIn("if (!forcePicker && hasMatchingConnectedBLEDevice(targetUuid))", self.app_js)

    def test_add_device_flow_forces_browser_picker(self):
        self.assertIn("async function addBLEDevice()", self.app_js)
        body = re.search(r"async function addBLEDevice\(\) \{(?P<body>.*?)\n\}", self.app_js, re.S)
        self.assertIsNotNone(body)
        self.assertIn("requestBLEDevice(true)", body.group("body"))
        self.assertIn("ensureBLECharacteristic(false)", body.group("body"))
        self.assertIn("completeBLEConnectionFlow()", body.group("body"))

    def test_quick_ble_button_uses_add_device_flow_when_no_authorized_devices(self):
        self.assertIn("async function handleQuickBleAction()", self.app_js)
        body = re.search(r"async function handleQuickBleAction\(\) \{(?P<body>.*?)\n\}", self.app_js, re.S)
        self.assertIsNotNone(body)
        self.assertIn("if ((window.appState.bleKnownDevices || []).length === 0)", body.group("body"))
        self.assertIn("await addBLEDevice();", body.group("body"))


if __name__ == "__main__":
    unittest.main()
