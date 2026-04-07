import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.ble_export import scan_ble_devices, send_to_esp32_ble_sync
from core.color_match import ArtkalPalette
from core.serial_export import list_available_ports, send_highlight_serial, send_to_esp32


palette = ArtkalPalette()


def load_payload(request_path: str):
    if not request_path:
        return {}
    return json.loads(Path(request_path).read_text(encoding="utf-8"))


def main():
    command = sys.argv[1]
    payload = load_payload(sys.argv[2]) if len(sys.argv) > 2 else {}

    if command == "serial_ports":
        response = {"ports": list_available_ports()}
    elif command == "serial_send":
        led_size_str = payload.get("led_matrix_size", "64x64")
        try:
            led_w, led_h = [int(v) for v in led_size_str.split("x", 1)]
            led_matrix_size = (led_w, led_h)
        except Exception:
            led_matrix_size = (64, 64)
        response = send_to_esp32(
            pixel_matrix=payload["pixel_matrix"],
            palette=palette,
            port=payload["port"],
            baud_rate=int(payload.get("baud_rate", 460800)),
            background_color=tuple(payload.get("background_color", [0, 0, 0])),
            led_matrix_size=led_matrix_size,
        )
    elif command == "serial_highlight":
        response = send_highlight_serial(
            highlight_colors=[tuple(c) for c in payload.get("highlight_colors", [])],
            port=payload["port"],
        )
    elif command == "ble_devices":
        response = {"devices": asyncio.run(scan_ble_devices())}
    elif command == "ble_send":
        response = send_to_esp32_ble_sync(
            pixel_matrix=payload["pixel_matrix"],
            palette=palette,
            device_address=payload.get("device_address"),
            background_color=tuple(payload.get("background_color", [0, 0, 0])),
        )
    else:
        raise SystemExit(f"unsupported command: {command}")

    print(json.dumps(response, ensure_ascii=False))


if __name__ == "__main__":
    main()
