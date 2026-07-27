import re
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
APP_JS = REPO_ROOT / "static" / "app.js"


def get_function_body(content: str, name: str) -> str:
    match = re.search(rf"(?:async\s+)?function {re.escape(name)}\([^)]*\) \{{(?P<body>.*?)\n\}}", content, re.S)
    if not match:
        raise AssertionError(f"{name} function not found")
    return match.group("body")


class ConnectedTargetMemoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.content = APP_JS.read_text(encoding="utf-8")

    def test_persistent_state_no_longer_restores_target_device_uuid(self):
        self.assertNotIn("function loadPersistentState()", self.content)
        self.assertNotIn("localStorage.getItem('beadcraft_state')", self.content)
        dom_ready = re.search(r"document\.addEventListener\('DOMContentLoaded', \(\) => \{(?P<body>.*?)\n\}\);", self.content, re.S)
        self.assertIsNotNone(dom_ready)
        self.assertNotIn("targetDeviceUuid", dom_ready.group("body"))

    def test_connected_uuid_helpers_exist(self):
        self.assertIn("function getConnectedBleUuid()", self.content)
        self.assertIn("function rememberConnectedBleTarget()", self.content)
        self.assertIn("function clearRememberedBleTarget()", self.content)

    def test_ble_disconnect_clears_remembered_target(self):
        body = get_function_body(self.content, "onBLEDisconnected")
        self.assertIn("clearRememberedBleTarget()", body)

    def test_successful_ble_characteristic_setup_remembers_connected_target(self):
        body = get_function_body(self.content, "ensureBLECharacteristic")
        self.assertIn("rememberConnectedBleTarget()", body)

    def test_frontend_no_longer_exposes_wifi_target_helpers(self):
        self.assertNotIn("function getCurrentWiFiTargetUuid()", self.content)
        self.assertNotIn("async function refreshWiFiDevices()", self.content)


if __name__ == "__main__":
    unittest.main()
