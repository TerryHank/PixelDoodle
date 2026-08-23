from pathlib import Path
import unittest


FIRMWARE_ROOT = Path(__file__).resolve().parents[2]
BLE_RECEIVER = FIRMWARE_ROOT / "lib" / "ble-receiver" / "BLEImageReceiver.h"


class FirmwarePaymentLockTests(unittest.TestCase):
    def test_firmware_has_v2_crypto_expiry_and_sequence_guards(self):
        source = BLE_RECEIVER.read_text(encoding="utf-8")

        required_fragments = (
            "BEADCRAFT_DEVICE_LOCK_ENABLED 1",
            "BEADCRAFT_DEVICE_SECRET",
            "mbedtls_md_hmac",
            "DEVICE_GRANT_VERSION = 2",
            'getBytesLength("grantSeq")',
            'putBytes("grantSeq"',
            "grantSequence <= highWater",
            "static_cast<uint64_t>(nowEpoch) >= notAfterEpoch",
            "grantSequence == highWater && isUnlockedNow()",
            "never extend the original unlock deadline",
            "_unlockedUntilMs",
            "if (!requireUnlocked()) break;",
            "bool isUnlocked() { return isUnlockedNow(); }",
            "PKT_ACTIVATION_COMMIT",
            "NTF_ACTIVATION_STATUS",
        )
        for fragment in required_fragments:
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, source)


if __name__ == "__main__":
    unittest.main()
