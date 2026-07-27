import io
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from PIL import Image

from core.color_match import ArtkalPalette
from core.exporter import generate_preview_base64
from core.quantizer import process_image


palette = ArtkalPalette()


def load_palette_payload():
    return {"colors": palette.colors, "presets": palette.presets}


def load_generate_payload(request_path: str):
    request = json.loads(Path(request_path).read_text(encoding="utf-8"))
    image = Image.open(request["file_path"])
    result = process_image(
        image=image,
        palette=palette,
        mode=request.get("mode", "fixed_grid"),
        grid_width=int(request.get("grid_width", 48)),
        grid_height=int(request.get("grid_height", 48)),
        pixel_size=int(request.get("pixel_size", 8)),
        use_dithering=str(request.get("use_dithering", "false")).lower() in ("true", "1", "yes"),
        palette_preset=str(request.get("palette_preset", "221")),
        max_colors=int(request.get("max_colors", 0)),
        similarity_threshold=int(request.get("similarity_threshold", 0)),
        remove_bg=str(request.get("remove_bg", "false")).lower() in ("true", "1", "yes"),
        contrast=float(request.get("contrast", 0.0)),
        saturation=float(request.get("saturation", 0.0)),
        sharpness=float(request.get("sharpness", 0.0)),
    )
    return {
        "session_id": "python-baseline",
        "grid_size": result["grid_size"],
        "pixel_matrix": result["pixel_matrix"],
        "color_summary": result["color_summary"],
        "total_beads": result["total_beads"],
        "palette_preset": str(request.get("palette_preset", "221")),
        "preview_image": generate_preview_base64(result["pixel_matrix"], palette),
    }


def main():
    command = sys.argv[1] if len(sys.argv) > 1 else "palette"
    if command == "palette":
        payload = load_palette_payload()
    elif command == "generate":
        payload = load_generate_payload(sys.argv[2])
    else:
        raise SystemExit(f"unsupported command: {command}")

    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
