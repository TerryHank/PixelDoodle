import uuid
import io
import time
import asyncio
import json
import os
import requests
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, Any
from collections import Counter

from fastapi import FastAPI, File, UploadFile, Form, HTTPException, Request, Query
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from PIL import Image

from core.color_match import ArtkalPalette
from core.quantizer import process_image
from core.exporter import export_png, export_pdf, generate_preview_base64
from core.serial_export import (
    background_fill_rgb565,
    list_available_ports,
    send_to_esp32,
    pixel_matrix_to_rgb565,
    send_highlight_serial,
)
from core.ble_export import (
    scan_ble_devices,
    send_to_esp32_ble_sync,
    send_highlight_ble_sync,
)


app = FastAPI(title="BeadCraft", description="Perler Bead Pattern Generator", version="1.0.0")

# Static files and templates
app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/examples", StaticFiles(directory="docs/examples"), name="examples")
templates = Jinja2Templates(directory="templates")

# Global palette instance
palette = ArtkalPalette()

# In-memory session storage
sessions: Dict[str, Dict[str, Any]] = {}
wifi_devices: Dict[str, Dict[str, Any]] = {}
DEVICE_BRIGHTNESS_MIN = 26
DEVICE_BRIGHTNESS_MAX = 255
DEVICE_BRIGHTNESS_DEFAULT = 64


def normalize_device_brightness(value: Any) -> int:
    try:
        brightness = int(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="brightness must be an integer")
    return max(DEVICE_BRIGHTNESS_MIN, min(DEVICE_BRIGHTNESS_MAX, brightness))


def get_registered_wifi_device(device_uuid: str) -> tuple[str, Dict[str, Any]]:
    normalized_uuid = (device_uuid or "").strip().upper()
    if not normalized_uuid:
        raise HTTPException(status_code=400, detail="device_uuid is required")

    entry = wifi_devices.get(normalized_uuid)
    if not entry:
        raise HTTPException(status_code=404, detail=f"WiFi device {normalized_uuid} is not registered")
    return normalized_uuid, entry


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    """Serve the main page."""
    return templates.TemplateResponse(request, "index.html")


@app.get("/api/palette")
async def get_palette():
    """Return the full Artkal palette data and presets."""
    return {
        'colors': palette.colors,
        'presets': palette.presets,
    }


@app.post("/api/generate")
async def generate_pattern(
    file: UploadFile = File(...),
    mode: str = Form("fixed_grid"),
    grid_width: int = Form(48),
    grid_height: int = Form(48),
    led_size: int = Form(64),
    pixel_size: int = Form(8),
    use_dithering: str = Form("false"),
    palette_preset: str = Form("221"),
    max_colors: int = Form(0),
    similarity_threshold: int = Form(0),
    remove_bg: str = Form("false"),
    contrast: float = Form(0.0),
    saturation: float = Form(0.0),
    sharpness: float = Form(0.0),
):
    """Generate a bead pattern from an uploaded image.

    Args:
        file: Image file (JPG, PNG, GIF, WEBP)
        mode: "fixed_grid" or "pixel_size"
        grid_width: Grid width (for fixed_grid mode)
        grid_height: Grid height (for fixed_grid mode)
        led_size: LED matrix size (16, 32, 52, 64)
        pixel_size: Pixel block size (for pixel_size mode)
        use_dithering: Enable Floyd-Steinberg dithering
        palette_preset: Palette preset ("96", "120", "144", "168", "221")
        max_colors: Maximum number of colors (0 = unlimited)
        similarity_threshold: Color merge threshold in Lab distance (0 = disabled)
        remove_bg: Whether to auto-remove background via border flood fill
        contrast: Contrast adjustment (-50 to +50, 0 = auto)
        saturation: Saturation adjustment (-50 to +50, 0 = auto)
        sharpness: Sharpness adjustment (-50 to +50, 0 = auto)
    """
    # Parse booleans from string (FormData sends "true"/"false" as strings)
    dithering_enabled = use_dithering.lower() in ('true', '1', 'yes')
    remove_bg_enabled = remove_bg.lower() in ('true', '1', 'yes')

    # Validate file type
    if not file.content_type or not file.content_type.startswith('image/'):
        raise HTTPException(status_code=400, detail="Please upload an image file")

    # Read and validate file size (20MB limit)
    contents = await file.read()
    if len(contents) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File size exceeds 20MB limit")

    try:
        image = Image.open(io.BytesIO(contents))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to open image: {str(e)}")

    # Process the image
    try:
        result = process_image(
            image=image,
            palette=palette,
            mode=mode,
            grid_width=grid_width,
            grid_height=grid_height,
            pixel_size=pixel_size,
            use_dithering=dithering_enabled,
            palette_preset=palette_preset,
            max_colors=max_colors,
            similarity_threshold=similarity_threshold,
            remove_bg=remove_bg_enabled,
            contrast=contrast,
            saturation=saturation,
            sharpness=sharpness,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Processing failed: {str(e)}")

    # Generate preview image
    preview_image = generate_preview_base64(result['pixel_matrix'], palette)

    # Create session
    session_id = str(uuid.uuid4())
    sessions[session_id] = {
        'pixel_matrix': result['pixel_matrix'],
        'color_summary': result['color_summary'],
        'grid_size': result['grid_size'],
        'total_beads': result['total_beads'],
        'led_size': led_size,
        'created_at': time.time(),
    }

    # Clean up old sessions (keep last 50)
    if len(sessions) > 50:
        sorted_keys = sorted(sessions.keys(), key=lambda k: sessions[k].get('created_at', 0))
        for key in sorted_keys[:-50]:
            del sessions[key]

    return {
        'session_id': session_id,
        'grid_size': result['grid_size'],
        'pixel_matrix': result['pixel_matrix'],
        'color_summary': result['color_summary'],
        'total_beads': result['total_beads'],
        'palette_preset': palette_preset,
        'preview_image': preview_image,
    }


@app.post("/api/export/png")
async def export_pattern_png(data: dict):
    """Export the pattern as a PNG image.

    Expected JSON body:
        pixel_matrix: List[List[str|None]]
        color_data: Dict[str, str]  (code -> hex)
        color_summary: List[Dict]
        cell_size: int (default 20)
        show_grid: bool (default true)
        show_codes_in_cells: bool (default true)
        show_coordinates: bool (default true)
        palette_preset: str (default "221")
    """
    pixel_matrix = data.get('pixel_matrix')
    color_data = data.get('color_data', {})
    color_summary = data.get('color_summary', [])
    cell_size = data.get('cell_size', 20)
    show_grid = data.get('show_grid', True)
    show_codes_in_cells = data.get('show_codes_in_cells', True)
    show_coordinates = data.get('show_coordinates', True)
    palette_preset = data.get('palette_preset', '221')

    if not pixel_matrix:
        raise HTTPException(status_code=400, detail="pixel_matrix is required")

    try:
        png_bytes = export_png(
            pixel_matrix, color_data, color_summary,
            cell_size, show_grid, show_codes_in_cells,
            show_coordinates, palette_preset
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PNG export failed: {str(e)}")

    timestamp = time.strftime("%Y%m%d_%H%M%S")
    filename = f"beadcraft_pattern_{timestamp}.png"

    return StreamingResponse(
        io.BytesIO(png_bytes),
        media_type="image/png",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@app.post("/api/export/pdf")
async def export_pattern_pdf(data: dict):
    """Export the pattern as a PDF document.

    Expected JSON body:
        pixel_matrix: List[List[str|None]]
        color_summary: List[Dict]
        show_codes_in_cells: bool (default true)
        show_coordinates: bool (default true)
        palette_preset: str (default "221")
    """
    pixel_matrix = data.get('pixel_matrix')
    color_summary = data.get('color_summary', [])
    show_codes_in_cells = data.get('show_codes_in_cells', True)
    show_coordinates = data.get('show_coordinates', True)
    palette_preset = data.get('palette_preset', '221')

    if not pixel_matrix:
        raise HTTPException(status_code=400, detail="pixel_matrix is required")

    try:
        pdf_bytes = export_pdf(
            pixel_matrix, color_summary, palette,
            show_codes_in_cells, show_coordinates, palette_preset
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF export failed: {str(e)}")

    timestamp = time.strftime("%Y%m%d_%H%M%S")
    filename = f"beadcraft_pattern_{timestamp}.pdf"

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@app.post("/api/export/json")
async def export_pattern_json(data: dict):
    """Export the pixel_matrix as JSON file.

    Expected JSON body:
        pixel_matrix: List[List[str|None]]
        color_summary: List[Dict] (optional)
    """
    pixel_matrix = data.get('pixel_matrix')
    color_summary = data.get('color_summary', [])

    if not pixel_matrix:
        raise HTTPException(status_code=400, detail="pixel_matrix is required")

    # Build JSON structure
    export_data = {
        "version": "1.0",
        "exported_at": datetime.now().isoformat(),
        "dimensions": {
            "width": len(pixel_matrix[0]) if pixel_matrix else 0,
            "height": len(pixel_matrix),
        },
        "pixel_matrix": pixel_matrix,
        "color_summary": color_summary,
    }

    json_bytes = json.dumps(export_data, indent=2, ensure_ascii=False).encode('utf-8')

    timestamp = time.strftime("%Y%m%d_%H%M%S")
    filename = f"beadcraft_pattern_{timestamp}.json"

    return StreamingResponse(
        io.BytesIO(json_bytes),
        media_type="application/json",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@app.get("/api/serial/ports")
async def get_serial_ports():
    """List available serial ports."""
    try:
        ports = list_available_ports()
        return {'ports': ports}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list ports: {str(e)}")


@app.post("/api/serial/send")
async def send_to_serial(data: dict):
    """Send pixel matrix to ESP32 via serial.

    Expected JSON body:
        pixel_matrix: List[List[str|None]]
        port: str
        baud_rate: int (optional, default 460800)
        background_color: List[int] (optional, default [0,0,0])
        led_matrix_size: str (optional, default "64x64")
    """
    pixel_matrix = data.get('pixel_matrix')
    if not pixel_matrix:
        raise HTTPException(status_code=400, detail="pixel_matrix is required")

    port = data.get('port')
    if not port:
        raise HTTPException(status_code=400, detail="port is required")

    baud_rate = data.get('baud_rate', 460800)
    bg_color = data.get('background_color', [0, 0, 0])
    
    # Parse LED matrix size
    led_size_str = data.get('led_matrix_size', '64x64')
    try:
        led_w, led_h = map(int, led_size_str.split('x'))
        led_matrix_size = (led_w, led_h)
    except:
        led_matrix_size = (64, 64)

    try:
        result = send_to_esp32(
            pixel_matrix=pixel_matrix,
            palette=palette,
            port=port,
            baud_rate=baud_rate,
            background_color=tuple(bg_color),
            led_matrix_size=led_matrix_size,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Serial send failed: {str(e)}")


@app.post("/api/serial/highlight")
async def highlight_serial(data: dict):
    """Send highlight command to ESP32 via serial.

    Expected JSON body:
        highlight_colors: List[List[int]] (RGB colors to highlight)
        port: str
    """
    highlight_colors = data.get('highlight_colors', [])
    port = data.get('port')

    if not port:
        raise HTTPException(status_code=400, detail="port is required")

    # Convert to list of tuples
    color_tuples = [tuple(c) for c in highlight_colors if len(c) == 3]

    try:
        result = send_highlight_serial(
            highlight_colors=color_tuples,
            port=port,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Serial highlight failed: {str(e)}")


@app.get("/api/ble/devices")
async def get_ble_devices():
    """Scan for available BLE devices."""
    try:
        devices = await scan_ble_devices()
        return {'devices': devices}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"BLE scan failed: {str(e)}")


@app.post("/api/ble/send")
async def send_to_ble(data: dict):
    """Send pixel matrix to ESP32 via BLE.

    Expected JSON body:
        pixel_matrix: List[List[str|None]]
        device_address: str (optional, auto-detect if not provided)
        background_color: List[int] (optional, default [0,0,0])
    """
    pixel_matrix = data.get('pixel_matrix')
    if not pixel_matrix:
        raise HTTPException(status_code=400, detail="pixel_matrix is required")

    device_address = data.get('device_address')
    bg_color = data.get('background_color', [0, 0, 0])

    try:
        result = send_to_esp32_ble_sync(
            pixel_matrix=pixel_matrix,
            palette=palette,
            device_address=device_address,
            background_color=tuple(bg_color),
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"BLE send failed: {str(e)}")


async def _register_wifi_device_impl(data: dict):
    device_uuid = (data.get('device_uuid') or '').strip().upper()
    ip = (data.get('ip') or '').strip()
    if not device_uuid or not ip:
        raise HTTPException(status_code=400, detail="device_uuid and ip are required")

    wifi_devices[device_uuid] = {
        "ip": ip,
        "updated_at": time.time(),
    }
    return {"success": True, "device_uuid": device_uuid, "ip": ip}


@app.get("/api/wifi/devices")
async def list_wifi_devices():
    """List all registered WiFi devices."""
    return {"devices": wifi_devices, "count": len(wifi_devices)}


async def _send_to_wifi_impl(data: dict):
    pixel_matrix = data.get('pixel_matrix')
    if not pixel_matrix:
        raise HTTPException(status_code=400, detail="pixel_matrix is required")

    device_uuid, entry = get_registered_wifi_device(data.get('device_uuid'))

    bg_color = tuple(data.get('background_color', [0, 0, 0]))
    try:
        rgb565_data = pixel_matrix_to_rgb565(pixel_matrix, palette, bg_color)
        
        # ESP32 expects exactly 8192 bytes (64x64 * 2), pad if smaller
        EXPECTED_SIZE = 8192
        if len(rgb565_data) < EXPECTED_SIZE:
            fill_rgb565 = background_fill_rgb565(bg_color)
            fill_bytes = fill_rgb565.to_bytes(2, 'little')
            rgb565_data = rgb565_data + fill_bytes * ((EXPECTED_SIZE - len(rgb565_data)) // 2)
        elif len(rgb565_data) > EXPECTED_SIZE:
            rgb565_data = rgb565_data[:EXPECTED_SIZE]
        
        response = requests.post(
            f"http://{entry['ip']}:8766/image",
            data=rgb565_data,
            headers={"Content-Type": "application/octet-stream"},
            timeout=15,
        )
        response.raise_for_status()
        return {
            "success": True,
            "bytes_sent": len(rgb565_data),
            "duration_ms": 0,
            "device_uuid": device_uuid,
            "ip": entry["ip"],
        }
    except requests.exceptions.ConnectTimeout:
        raise HTTPException(status_code=504, detail=f"WiFi device {device_uuid} ({entry['ip']}) connection timeout - device may be offline")
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail=f"WiFi device {device_uuid} ({entry['ip']}) response timeout")
    except requests.exceptions.ConnectionError:
        raise HTTPException(status_code=503, detail=f"WiFi device {device_uuid} ({entry['ip']}) unreachable - check network connection")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"WiFi send failed: {str(e)}")


async def _highlight_wifi_impl(data: dict):
    device_uuid, entry = get_registered_wifi_device(data.get('device_uuid'))

    highlight_colors = data.get('highlight_colors', [])
    packet = bytearray()
    if not highlight_colors:
        packet.append(0x05)
    else:
        packet.extend([0x04, len(highlight_colors)])
        for color in highlight_colors:
            if len(color) != 3:
                continue
            rgb565 = (
                ((color[0] >> 3) & 0x1F) << 11 |
                ((color[1] >> 2) & 0x3F) << 5 |
                ((color[2] >> 3) & 0x1F)
            )
            packet.extend(rgb565.to_bytes(2, 'little'))

    try:
        response = requests.post(
            f"http://{entry['ip']}:8766/highlight",
            data=bytes(packet),
            headers={"Content-Type": "application/octet-stream"},
            timeout=5,
        )
        response.raise_for_status()
        return {"success": True, "device_uuid": device_uuid, "ip": entry["ip"]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"WiFi highlight failed: {str(e)}")


async def _get_wifi_brightness_impl(device_uuid: str):
    normalized_uuid, entry = get_registered_wifi_device(device_uuid)

    try:
        response = requests.get(
            f"http://{entry['ip']}:8766/brightness",
            timeout=5,
        )
        response.raise_for_status()
        payload = response.json()
        brightness = normalize_device_brightness(payload.get("brightness", DEVICE_BRIGHTNESS_DEFAULT))
        return {
            "success": True,
            "device_uuid": normalized_uuid,
            "ip": entry["ip"],
            "brightness": brightness,
        }
    except requests.exceptions.ConnectTimeout:
        raise HTTPException(status_code=504, detail=f"WiFi device {normalized_uuid} ({entry['ip']}) connection timeout - device may be offline")
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail=f"WiFi device {normalized_uuid} ({entry['ip']}) response timeout")
    except requests.exceptions.ConnectionError:
        raise HTTPException(status_code=503, detail=f"WiFi device {normalized_uuid} ({entry['ip']}) unreachable - check network connection")
    except (ValueError, json.JSONDecodeError):
        raise HTTPException(status_code=502, detail=f"WiFi device {normalized_uuid} returned invalid brightness payload")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"WiFi brightness read failed: {str(e)}")


async def _set_wifi_brightness_impl(data: dict):
    normalized_uuid, entry = get_registered_wifi_device(data.get('device_uuid'))
    brightness = normalize_device_brightness(data.get("brightness"))

    try:
        response = requests.post(
            f"http://{entry['ip']}:8766/brightness",
            data=bytes([brightness]),
            headers={"Content-Type": "application/octet-stream"},
            timeout=5,
        )
        response.raise_for_status()
        payload = response.json()
        actual_brightness = normalize_device_brightness(payload.get("brightness", brightness))
        return {
            "success": True,
            "device_uuid": normalized_uuid,
            "ip": entry["ip"],
            "brightness": actual_brightness,
        }
    except requests.exceptions.ConnectTimeout:
        raise HTTPException(status_code=504, detail=f"WiFi device {normalized_uuid} ({entry['ip']}) connection timeout - device may be offline")
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail=f"WiFi device {normalized_uuid} ({entry['ip']}) response timeout")
    except requests.exceptions.ConnectionError:
        raise HTTPException(status_code=503, detail=f"WiFi device {normalized_uuid} ({entry['ip']}) unreachable - check network connection")
    except (ValueError, json.JSONDecodeError):
        raise HTTPException(status_code=502, detail=f"WiFi device {normalized_uuid} returned invalid brightness payload")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"WiFi brightness sync failed: {str(e)}")


# Compatible WiFi API routes (keep old and new paths aligned)
@app.post("/api/wifi/register")
@app.post("/api/wifi/register/")
@app.post("/wifi/register")
@app.post("/wifi/register/")
async def register_wifi_device(data: dict):
    return await _register_wifi_device_impl(data)


@app.post("/api/wifi/send")
@app.post("/api/wifi/send/")
@app.post("/wifi/send")
@app.post("/wifi/send/")
async def send_to_wifi(data: dict):
    return await _send_to_wifi_impl(data)


@app.post("/api/wifi/highlight")
@app.post("/api/wifi/highlight/")
@app.post("/wifi/highlight")
@app.post("/wifi/highlight/")
async def highlight_wifi(data: dict):
    return await _highlight_wifi_impl(data)


@app.get("/api/wifi/brightness")
@app.get("/api/wifi/brightness/")
@app.get("/wifi/brightness")
@app.get("/wifi/brightness/")
async def get_wifi_brightness(device_uuid: str = Query(...)):
    return await _get_wifi_brightness_impl(device_uuid)


@app.post("/api/wifi/brightness")
@app.post("/api/wifi/brightness/")
@app.post("/wifi/brightness")
@app.post("/wifi/brightness/")
async def set_wifi_brightness(data: dict):
    return await _set_wifi_brightness_impl(data)


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8765"))
    host = os.getenv("HOST", "0.0.0.0")
    cert_file = Path(os.getenv("SSL_CERTFILE", "certs/localhost-cert.pem"))
    key_file = Path(os.getenv("SSL_KEYFILE", "certs/localhost-key.pem"))

    uvicorn_kwargs = {
        "app": "main:app",
        "host": host,
        "port": port,
        "reload": True,
    }

    # if cert_file.exists() and key_file.exists():
    #     uvicorn_kwargs["ssl_certfile"] = str(cert_file)
    #     uvicorn_kwargs["ssl_keyfile"] = str(key_file)

    uvicorn.run(**uvicorn_kwargs)
