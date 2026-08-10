"""Background removal using OpenCV GrabCut (no external model download needed).

For portrait photos, GrabCut with an auto-centered bounding box works well.
Returns RGBA PNG bytes with transparent background.
"""

import io
import cv2
import numpy as np
from PIL import Image


def remove_background(image_bytes: bytes) -> bytes:
    """Remove background from image using GrabCut.

    Returns PNG bytes with alpha channel (RGBA).
    """
    # Decode image
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Failed to decode image")

    h, w = img.shape[:2]

    # Auto rectangle: center 60% of image (portrait assumption)
    margin_x = int(w * 0.2)
    margin_y = int(h * 0.1)
    rect = (margin_x, margin_y, w - 2 * margin_x, h - 2 * margin_y)

    # GrabCut
    mask = np.zeros((h, w), np.uint8)
    bgd_model = np.zeros((1, 65), np.float64)
    fgd_model = np.zeros((1, 65), np.float64)

    cv2.grabCut(img, mask, rect, bgd_model, fgd_model, 5, cv2.GC_INIT_WITH_RECT)

    # Create binary mask: 0/2 = background, 1/3 = foreground
    fg_mask = np.where((mask == 1) | (mask == 3), 255, 0).astype(np.uint8)

    # Refine edges
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    fg_mask = cv2.morphologyEx(fg_mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    fg_mask = cv2.morphologyEx(fg_mask, cv2.MORPH_OPEN, kernel, iterations=1)

    # Apply mask: BGRA
    bgra = cv2.cvtColor(img, cv2.COLOR_BGR2BGRA)
    bgra[:, :, 3] = fg_mask

    # Encode as PNG
    success, png_bytes = cv2.imencode(".png", bgra)
    if not success:
        raise ValueError("Failed to encode output PNG")

    return png_bytes.tobytes()


def remove_background_pil(image: Image.Image) -> Image.Image:
    """Remove background using GrabCut, returns PIL RGBA Image."""
    buf = io.BytesIO()
    image.convert("RGB").save(buf, format="PNG")
    result_bytes = remove_background(buf.getvalue())
    return Image.open(io.BytesIO(result_bytes)).convert("RGBA")
