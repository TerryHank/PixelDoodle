import re
import struct
import unittest
from pathlib import Path

from core.color_match import ArtkalPalette
from core.serial_export import pixel_matrix_to_rgb565, rgb_to_rgb565


REPO_ROOT = Path(__file__).resolve().parents[3]
APP_JS = REPO_ROOT / "static" / "app.js"
BLE_RECEIVER = REPO_ROOT / "firmware" / "lib" / "ble-receiver" / "BLEImageReceiver.h"
SERIAL_RECEIVER = REPO_ROOT / "firmware" / "lib" / "beadcraft-receiver" / "BeadCraftReceiver.h"

TRANSPARENT_RGB565 = 0x0001


class HighlightRegressionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.palette = ArtkalPalette()

    def test_black_background_uses_reserved_transparent_marker(self):
        payload = pixel_matrix_to_rgb565([[None, "H7"]], self.palette, (0, 0, 0))
        transparent_pixel, black_pixel = struct.unpack("<HH", payload[:4])

        self.assertEqual(transparent_pixel, TRANSPARENT_RGB565)
        self.assertEqual(black_pixel, rgb_to_rgb565(0, 0, 0))

    def test_non_black_background_still_uses_selected_background_color(self):
        payload = pixel_matrix_to_rgb565([[None]], self.palette, (255, 0, 0))
        (background_pixel,) = struct.unpack("<H", payload[:2])
        self.assertEqual(background_pixel, rgb_to_rgb565(255, 0, 0))

    def test_reserved_transparent_marker_is_not_a_palette_color(self):
        palette_values = {
            rgb_to_rgb565(*color["rgb"])
            for color in self.palette.colors
        }
        self.assertNotIn(TRANSPARENT_RGB565, palette_values)

    def test_frontend_black_background_uses_transparent_marker(self):
        content = APP_JS.read_text(encoding="utf-8")
        self.assertIn("const RGB565_TRANSPARENT_MARKER = 0x0001;", content)
        self.assertRegex(
            content,
            r"const backgroundFillRgb565 = backgroundColorRgb565 === RGB565_BLACK \? RGB565_TRANSPARENT_MARKER : backgroundColorRgb565;",
        )
        self.assertRegex(
            content,
            r"if \(code === null\) \{\s*rgb565 = backgroundFillRgb565;",
        )

    def test_auto_send_does_not_request_ble_device_picker(self):
        content = APP_JS.read_text(encoding="utf-8")
        match = re.search(r"async function autoSendToESP32\(\) \{(?P<body>.*?)\n\}", content, re.S)
        self.assertIsNotNone(match, "autoSendToESP32 function not found")
        body = match.group("body")
        self.assertIn("sendMatrixViaCurrentMode(pixelMatrix, bgRgb, false);", body)

    def test_firmware_receivers_treat_transparent_marker_as_background(self):
        for path in (BLE_RECEIVER, SERIAL_RECEIVER):
            content = path.read_text(encoding="utf-8")
            self.assertIn("const uint16_t TRANSPARENT_RGB565 = 0x0001;", content)
            self.assertIn("bool transparentPixel = storedPixel == TRANSPARENT_RGB565;", content)
            self.assertIn("displayColor = match ? highlightColor : bgColor;", content)


if __name__ == "__main__":
    unittest.main()
