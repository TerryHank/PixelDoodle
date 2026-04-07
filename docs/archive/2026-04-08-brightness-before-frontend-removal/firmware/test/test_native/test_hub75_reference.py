import re
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
FIRMWARE_DIR = REPO_ROOT / "firmware"
PLATFORMIO_INI = FIRMWARE_DIR / "platformio.ini"
MAIN_CPP = FIRMWARE_DIR / "src" / "main.cpp"
HUB75_HEADER = FIRMWARE_DIR / "include" / "Hub75ReferenceConfig.h"


class Hub75ReferenceTests(unittest.TestCase):
    def test_platformio_targets_esp32s3(self):
        content = PLATFORMIO_INI.read_text(encoding="utf-8")
        self.assertIn("default_envs = esp32s3", content)
        self.assertIn("[env:esp32s3]", content)
        self.assertIn("board = esp32-s3-devkitc-1", content)

    def test_reference_hub75_header_exists(self):
        self.assertTrue(HUB75_HEADER.exists(), f"Missing {HUB75_HEADER}")

    def test_reference_hub75_pins_match_reference_project(self):
        content = HUB75_HEADER.read_text(encoding="utf-8")
        expected_values = [5, 6, 7, 35, 16, 17, 18, 8, 9, 10, 11, 12, 13, 14]
        values = [int(value) for value in re.findall(r"\b\d+\b", content)]
        self.assertGreaterEqual(len(values), len(expected_values))
        self.assertEqual(values[: len(expected_values)], expected_values)

    def test_reference_hub75_header_defines_driver_candidate(self):
        content = HUB75_HEADER.read_text(encoding="utf-8")
        self.assertIn("constexpr HUB75_I2S_CFG::shift_driver kHub75Driver =", content)
        self.assertIn("HUB75_I2S_CFG::FM6126A", content)

    def test_main_cpp_uses_reference_hub75_header(self):
        content = MAIN_CPP.read_text(encoding="utf-8")
        self.assertIn('#include "Hub75ReferenceConfig.h"', content)
        self.assertIn(
            "HUB75_I2S_CFG mxconfig(kHub75PanelWidth, kHub75PanelHeight, kHub75ChainLength, kHub75Pins);",
            content,
        )
        self.assertIn("mxconfig.driver = kHub75Driver;", content)


if __name__ == "__main__":
    unittest.main()
