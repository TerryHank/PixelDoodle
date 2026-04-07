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
        body = get_function_body(self.content, "loadPersistentState")
        self.assertNotIn("data.targetDeviceUuid", body)

    def test_connected_uuid_helpers_exist(self):
        self.assertIn("function getConnectedBleUuid()", self.content)
        self.assertIn("function rememberConnectedBleTarget()", self.content)
        self.assertIn("function clearRememberedBleTarget()", self.content)

    def test_wifi_target_resolves_only_from_active_ble_connection(self):
        body = get_function_body(self.content, "getCurrentWiFiTargetUuid")
        self.assertIn("getConnectedBleUuid()", body)
        self.assertNotIn("window.appState.targetDeviceUuid", body)

    def test_ble_disconnect_clears_remembered_target(self):
        body = get_function_body(self.content, "onBLEDisconnected")
        self.assertIn("clearRememberedBleTarget()", body)

    def test_successful_ble_characteristic_setup_remembers_connected_target(self):
        body = get_function_body(self.content, "ensureBLECharacteristic")
        self.assertIn("rememberConnectedBleTarget()", body)

    def test_refresh_wifi_devices_requires_live_ble_connection(self):
        body = get_function_body(self.content, "refreshWiFiDevices")
        self.assertIn("const connectedUuid = getConnectedBleUuid();", body)
        self.assertNotIn("window.appState.targetDeviceUuid || connectedUuid", body)


if __name__ == "__main__":
    unittest.main()
