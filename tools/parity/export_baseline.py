import base64
import io
import json
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.color_match import ArtkalPalette
from core.exporter import export_pdf, export_png


palette = ArtkalPalette()


def load_payload(request_path: str):
    return json.loads(Path(request_path).read_text(encoding="utf-8"))


def emit_binary(content_type: str, extension: str, body: bytes):
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    return {
        "content_type": content_type,
        "filename": f"beadcraft_pattern_{timestamp}.{extension}",
        "body_base64": base64.b64encode(body).decode("ascii"),
    }


def export_json_payload(payload):
    pixel_matrix = payload.get("pixel_matrix")
    color_summary = payload.get("color_summary", [])
    export_data = {
        "version": "1.0",
        "exported_at": datetime.now().isoformat(),
        "dimensions": {
            "width": len(pixel_matrix[0]) if pixel_matrix else 0,
            "height": len(pixel_matrix) if pixel_matrix else 0,
        },
        "pixel_matrix": pixel_matrix,
        "color_summary": color_summary,
    }
    body = json.dumps(export_data, indent=2, ensure_ascii=False).encode("utf-8")
    return emit_binary("application/json", "json", body)


def main():
    command = sys.argv[1]
    payload = load_payload(sys.argv[2])

    if command == "png":
        body = export_png(
            payload["pixel_matrix"],
            payload.get("color_data", {}),
            payload.get("color_summary", []),
            payload.get("cell_size", 20),
            payload.get("show_grid", True),
            payload.get("show_codes_in_cells", True),
            payload.get("show_coordinates", True),
            payload.get("palette_preset", "221"),
        )
        response = emit_binary("image/png", "png", body)
    elif command == "pdf":
        body = export_pdf(
            payload["pixel_matrix"],
            payload.get("color_summary", []),
            palette,
            payload.get("show_codes_in_cells", True),
            payload.get("show_coordinates", True),
            payload.get("palette_preset", "221"),
        )
        response = emit_binary("application/pdf", "pdf", body)
    elif command == "json":
        response = export_json_payload(payload)
    else:
        raise SystemExit(f"unsupported command: {command}")

    print(json.dumps(response, ensure_ascii=False))


if __name__ == "__main__":
    main()
