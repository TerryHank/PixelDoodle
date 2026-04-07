import re
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
APP_JS = REPO_ROOT / "static" / "app.js"


class LedSizeSingleSendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.content = APP_JS.read_text(encoding="utf-8")

    def test_startup_does_not_bind_extra_led_size_generate_listener(self):
        dom_ready = re.search(
            r"document\.addEventListener\('DOMContentLoaded', \(\) => \{(?P<body>.*?)\n\}\);",
            self.content,
            re.S,
        )
        self.assertIsNotNone(dom_ready)
        self.assertNotIn("ledSizeSelect.addEventListener('change'", dom_ready.group("body"))

    def test_led_size_change_is_still_handled_by_update_function(self):
        update_fn = re.search(
            r"function updateLedSizeDisplay\(\) \{(?P<body>.*?)\n\}",
            self.content,
            re.S,
        )
        self.assertIsNotNone(update_fn)
        self.assertIn("generatePattern();", update_fn.group("body"))


if __name__ == "__main__":
    unittest.main()
