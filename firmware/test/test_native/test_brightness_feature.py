import re
import unittest
from pathlib import Path

from fastapi.routing import APIRoute

from main import app


REPO_ROOT = Path(__file__).resolve().parents[3]
INDEX_HTML = REPO_ROOT / "templates" / "index.html"
APP_JS = REPO_ROOT / "static" / "app.js"
I18N_JS = REPO_ROOT / "static" / "i18n.js"
MAIN_PY = REPO_ROOT / "main.py"
FIRMWARE_MAIN = REPO_ROOT / "firmware" / "src" / "main.cpp"
BLE_RECEIVER = REPO_ROOT / "firmware" / "lib" / "ble-receiver" / "BLEImageReceiver.h"


class BrightnessFeatureTests(unittest.TestCase):
    def test_template_no_longer_has_brightness_slider_block(self):
        content = INDEX_HTML.read_text(encoding="utf-8")
        self.assertNotIn('id="brightness-slider"', content)
        self.assertNotIn('id="brightness-value"', content)
        self.assertNotIn('id="brightness-hint"', content)
        self.assertNotIn('home-brightness-panel', content)

    def test_frontend_no_longer_has_brightness_state_and_controls(self):
        content = APP_JS.read_text(encoding="utf-8")
        forbidden_snippets = [
            "brightnessPercent:",
            "deviceBrightnessLoaded:",
            "brightnessSyncTimer:",
            "isSyncingBrightness:",
            "const BLE_PKT_SET_BRIGHTNESS = 0x09;",
            "const BLE_PKT_GET_BRIGHTNESS = 0x0A;",
            "const BLE_NTF_BRIGHTNESS = 0x26;",
            "const DEVICE_BRIGHTNESS_MIN = 26;",
            "const DEVICE_BRIGHTNESS_MAX = 255;",
            "function percentToDeviceBrightness(",
            "function deviceBrightnessToPercent(",
            "function updateBrightnessControlState(",
            "function initBrightnessControls(",
            "async function sendBrightnessViaWebBluetooth(",
            "async function requestBrightnessViaWebBluetooth(",
            "async function sendBrightnessToESP32(",
            "function queueBrightnessSync(",
            "async function syncBrightnessFromCurrentDevice(",
        ]
        for snippet in forbidden_snippets:
            self.assertNotIn(snippet, content)

    def test_frontend_no_longer_handles_brightness_notifications(self):
        content = APP_JS.read_text(encoding="utf-8")
        self.assertNotIn("if (code === BLE_NTF_BRIGHTNESS)", content)
        self.assertNotIn("bleBrightnessWaiters", content)
        self.assertNotIn("bleBrightnessPendingValue", content)

    def test_i18n_no_longer_has_brightness_copy(self):
        content = I18N_JS.read_text(encoding="utf-8")
        self.assertNotIn("'brightness.label':", content)
        self.assertNotIn("'brightness.hint_connected':", content)
        self.assertNotIn("'brightness.hint_disconnected':", content)
        self.assertNotIn("'toast.brightness_sync_failed':", content)

    def test_backend_no_longer_exposes_wifi_brightness_routes(self):
        routes = {
            (route.path, method)
            for route in app.routes
            if isinstance(route, APIRoute)
            for method in route.methods
        }
        self.assertNotIn(("/api/wifi/brightness", "GET"), routes)
        self.assertNotIn(("/api/wifi/brightness", "POST"), routes)
        self.assertNotIn(("/wifi/brightness", "GET"), routes)
        self.assertNotIn(("/wifi/brightness", "POST"), routes)

    def test_backend_no_longer_relays_wifi_brightness_to_device(self):
        content = MAIN_PY.read_text(encoding="utf-8")
        self.assertNotIn("/api/wifi/brightness", content)
        self.assertNotIn('f"http://{entry[\'ip\']}:8766/brightness"', content)
        self.assertNotIn("requests.get(", content)
        self.assertNotIn("requests.post(", content)

    def test_firmware_main_owns_brightness_state(self):
        content = FIRMWARE_MAIN.read_text(encoding="utf-8")
        required_snippets = [
            "#include <Preferences.h>",
            "Preferences g_preferences;",
            "uint8_t g_brightness = 64;",
            "uint8_t clampBrightness(",
            "uint8_t loadBrightness()",
            "void applyBrightness(uint8_t value, bool persist)",
            "uint8_t getBrightness()",
            "g_preferences.begin(\"beadcraft\", false);",
            "dma_display->setBrightness8(loadBrightness());",
            "dma_display->clearScreen();",
            "bleReceiver = new BLEImageReceiver(dma_display, applyBrightness, getBrightness);",
        ]
        for snippet in required_snippets:
            self.assertIn(snippet, content)

    def test_firmware_repaints_matrix_after_brightness_change(self):
        content = FIRMWARE_MAIN.read_text(encoding="utf-8")
        self.assertIn("dma_display->clearScreen();", content)
        self.assertIn("if (bleReceiver && bleReceiver->hasImage()) {", content)
        self.assertIn("bleReceiver->displayStoredImage();", content)

    def test_ble_receiver_rebuilds_frame_from_clean_buffer(self):
        content = BLE_RECEIVER.read_text(encoding="utf-8")
        match = re.search(r"void displayStoredImage\(\) \{(?P<body>.*?)\n    \}", content, re.S)
        self.assertIsNotNone(match)
        body = match.group("body")
        self.assertIn("_display->clearScreen();", body)

    def test_firmware_main_no_longer_initializes_wifi_stack(self):
        content = FIRMWARE_MAIN.read_text(encoding="utf-8")
        self.assertNotIn("#include <WiFi.h>", content)
        self.assertNotIn("WiFi.mode(", content)
        self.assertNotIn("WiFi.disconnect(", content)

    def test_ble_receiver_supports_ble_brightness_protocol_only(self):
        content = BLE_RECEIVER.read_text(encoding="utf-8")
        required_patterns = [
            r"#define PKT_SET_BRIGHTNESS\s+0x09",
            r"#define PKT_GET_BRIGHTNESS\s+0x0A",
            r"#define NTF_BRIGHTNESS\s+0x26",
            r"std::function<void\(uint8_t,\s*bool\)>\s+setBrightness",
            r"std::function<uint8_t\(void\)>\s+getBrightness",
            r"void sendBrightnessNotification\(\)",
            r"case PKT_SET_BRIGHTNESS:",
            r"case PKT_GET_BRIGHTNESS:",
            r"_setBrightness\(.*true\)",
            r"sendBrightnessNotification\(\);",
        ]
        for pattern in required_patterns:
            self.assertRegex(content, pattern)
        forbidden_snippets = [
            "WIFI_SCAN_CHARACTERISTIC_UUID",
            "PKT_WIFI_SCAN",
            "PKT_WIFI_CONNECT",
            "WiFiServer",
            "handleWiFiImageServer",
            "GET /brightness",
            "POST /brightness",
        ]
        for snippet in forbidden_snippets:
            self.assertNotIn(snippet, content)


if __name__ == "__main__":
    unittest.main()
