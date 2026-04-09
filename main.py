import uuid
import io
import time
import asyncio
import json
import os
import sqlite3
import requests
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, Any
from collections import Counter

from fastapi import FastAPI, File, UploadFile, Form, HTTPException, Request, Query
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from PIL import Image

from core.color_match import ArtkalPalette
from core.quantizer import process_image
from core.exporter import export_png, export_pdf, generate_preview_base64
from core.serial_export import (
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
TARO_H5_DIST_DIR = Path("frontend-taro") / "dist-h5"
TARO_H5_INDEX = TARO_H5_DIST_DIR / "index.html"
TARO_H5_JS_DIR = TARO_H5_DIST_DIR / "js"
TARO_H5_CSS_DIR = TARO_H5_DIST_DIR / "css"
TARO_H5_STATIC_DIR = TARO_H5_DIST_DIR / "static"

if TARO_H5_JS_DIR.exists():
    app.mount("/js", StaticFiles(directory=str(TARO_H5_JS_DIR)), name="taro_js")

if TARO_H5_CSS_DIR.exists():
    app.mount("/css", StaticFiles(directory=str(TARO_H5_CSS_DIR)), name="taro_css")

if TARO_H5_STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(TARO_H5_STATIC_DIR)), name="taro_static")
else:
    app.mount("/static", StaticFiles(directory="static"), name="static")

app.mount("/examples", StaticFiles(directory="docs/examples"), name="examples")
templates = Jinja2Templates(directory="templates")

# Global palette instance
palette = ArtkalPalette()

# In-memory session storage
sessions: Dict[str, Dict[str, Any]] = {}
wifi_devices: Dict[str, Dict[str, Any]] = {}
COMMUNITY_DB_PATH = Path("data") / "community.db"


def ensure_community_db():
    COMMUNITY_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(COMMUNITY_DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS community_posts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                author_id TEXT NOT NULL,
                author_nickname TEXT NOT NULL,
                author_avatar_seed TEXT NOT NULL,
                palette_preset TEXT NOT NULL,
                grid_width INTEGER NOT NULL,
                grid_height INTEGER NOT NULL,
                total_beads INTEGER NOT NULL,
                pixel_matrix TEXT NOT NULL,
                color_summary TEXT NOT NULL,
                downloads INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS community_comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                post_id INTEGER NOT NULL,
                author_id TEXT NOT NULL,
                author_nickname TEXT NOT NULL,
                author_avatar_seed TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(post_id) REFERENCES community_posts(id) ON DELETE CASCADE
            )
            """
        )
        conn.commit()


def community_db():
    ensure_community_db()
    conn = sqlite3.connect(COMMUNITY_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _serialize_community_post(row: sqlite3.Row):
    color_summary = json.loads(row["color_summary"])
    return {
        "id": row["id"],
        "title": row["title"],
        "description": row["description"],
        "author": {
            "id": row["author_id"],
            "nickname": row["author_nickname"],
            "avatar_seed": row["author_avatar_seed"],
        },
        "palette_preset": row["palette_preset"],
        "grid_size": {
            "width": row["grid_width"],
            "height": row["grid_height"],
        },
        "total_beads": row["total_beads"],
        "pixel_matrix": json.loads(row["pixel_matrix"]),
        "color_summary": color_summary,
        "created_at": row["created_at"],
        "downloads": row["downloads"],
        "comments_count": row["comments_count"],
    }


def _serialize_community_comment(row: sqlite3.Row):
    return {
        "id": row["id"],
        "post_id": row["post_id"],
        "author": {
            "id": row["author_id"],
            "nickname": row["author_nickname"],
            "avatar_seed": row["author_avatar_seed"],
        },
        "content": row["content"],
        "created_at": row["created_at"],
    }


def _community_post_row(conn: sqlite3.Connection, post_id: int):
    return conn.execute(
        """
        SELECT
            p.*,
            (
                SELECT COUNT(*)
                FROM community_comments c
                WHERE c.post_id = p.id
            ) AS comments_count
        FROM community_posts p
        WHERE p.id = ?
        """,
        (post_id,),
    ).fetchone()


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    """Serve the main page."""
    if TARO_H5_INDEX.exists():
        return FileResponse(TARO_H5_INDEX)
    return templates.TemplateResponse("index.html", {"request": request})


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

    device_uuid = (data.get('device_uuid') or '').strip().upper()
    if not device_uuid:
        raise HTTPException(status_code=400, detail="device_uuid is required")

    entry = wifi_devices.get(device_uuid)
    if not entry:
        raise HTTPException(status_code=404, detail=f"WiFi device {device_uuid} is not registered")

    bg_color = tuple(data.get('background_color', [0, 0, 0]))
    try:
        rgb565_data = pixel_matrix_to_rgb565(pixel_matrix, palette, bg_color)
        
        # ESP32 expects exactly 8192 bytes (64x64 * 2), pad if smaller
        EXPECTED_SIZE = 8192
        if len(rgb565_data) < EXPECTED_SIZE:
            rgb565_data = rgb565_data + b'\x00' * (EXPECTED_SIZE - len(rgb565_data))
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
    device_uuid = (data.get('device_uuid') or '').strip().upper()
    if not device_uuid:
        raise HTTPException(status_code=400, detail="device_uuid is required")

    entry = wifi_devices.get(device_uuid)
    if not entry:
        raise HTTPException(status_code=404, detail=f"WiFi device {device_uuid} is not registered")

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


@app.get("/api/community/posts")
async def list_community_posts(limit: int = Query(20, ge=1, le=60)):
    with community_db() as conn:
        rows = conn.execute(
            """
            SELECT
                p.*,
                (
                    SELECT COUNT(*)
                    FROM community_comments c
                    WHERE c.post_id = p.id
                ) AS comments_count
            FROM community_posts p
            ORDER BY p.id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()

    return {"posts": [_serialize_community_post(row) for row in rows]}


@app.post("/api/community/posts")
async def create_community_post(data: dict):
    required_fields = [
        "title",
        "author_id",
        "author_nickname",
        "author_avatar_seed",
        "palette_preset",
        "grid_size",
        "total_beads",
        "pixel_matrix",
        "color_summary",
    ]
    for field in required_fields:
        if field not in data:
            raise HTTPException(status_code=400, detail=f"{field} is required")

    grid_size = data.get("grid_size") or {}
    created_at = datetime.now().isoformat()

    with community_db() as conn:
        cursor = conn.execute(
            """
            INSERT INTO community_posts (
                title,
                description,
                author_id,
                author_nickname,
                author_avatar_seed,
                palette_preset,
                grid_width,
                grid_height,
                total_beads,
                pixel_matrix,
                color_summary,
                downloads,
                created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
            """,
            (
                str(data.get("title") or "").strip() or "未命名图案",
                str(data.get("description") or "").strip(),
                str(data.get("author_id") or "").strip(),
                str(data.get("author_nickname") or "").strip() or "像素玩家",
                str(data.get("author_avatar_seed") or "").strip() or "像素玩家",
                str(data.get("palette_preset") or "221"),
                int(grid_size.get("width") or 0),
                int(grid_size.get("height") or 0),
                int(data.get("total_beads") or 0),
                json.dumps(data.get("pixel_matrix"), ensure_ascii=False),
                json.dumps(data.get("color_summary"), ensure_ascii=False),
                created_at,
            ),
        )
        post_id = int(cursor.lastrowid)
        conn.commit()
        row = _community_post_row(conn, post_id)

    if row is None:
        raise HTTPException(status_code=500, detail="Failed to load created community post")

    return _serialize_community_post(row)


@app.get("/api/community/posts/{post_id}")
async def get_community_post(post_id: int):
    with community_db() as conn:
        row = _community_post_row(conn, post_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Community post not found")
        comments = conn.execute(
            """
            SELECT *
            FROM community_comments
            WHERE post_id = ?
            ORDER BY id ASC
            """,
            (post_id,),
        ).fetchall()

    post = _serialize_community_post(row)
    post["comments"] = [_serialize_community_comment(comment) for comment in comments]
    return post


@app.post("/api/community/posts/{post_id}/comments")
async def create_community_comment(post_id: int, data: dict):
    content = str(data.get("content") or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="content is required")

    with community_db() as conn:
        row = _community_post_row(conn, post_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Community post not found")
        conn.execute(
            """
            INSERT INTO community_comments (
                post_id,
                author_id,
                author_nickname,
                author_avatar_seed,
                content,
                created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                post_id,
                str(data.get("author_id") or "").strip(),
                str(data.get("author_nickname") or "").strip() or "像素玩家",
                str(data.get("author_avatar_seed") or "").strip() or "像素玩家",
                content,
                datetime.now().isoformat(),
            ),
        )
        conn.commit()
        comments = conn.execute(
            """
            SELECT *
            FROM community_comments
            WHERE post_id = ?
            ORDER BY id ASC
            """,
            (post_id,),
        ).fetchall()
        row = _community_post_row(conn, post_id)

    post = _serialize_community_post(row)
    post["comments"] = [_serialize_community_comment(comment) for comment in comments]
    return post


@app.get("/api/community/posts/{post_id}/download/json")
async def download_community_post_json(post_id: int):
    with community_db() as conn:
        row = _community_post_row(conn, post_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Community post not found")
        conn.execute(
            "UPDATE community_posts SET downloads = downloads + 1 WHERE id = ?",
            (post_id,),
        )
        conn.commit()

    payload = {
        "version": "1.0",
        "exported_at": datetime.now().isoformat(),
        "dimensions": {
            "width": row["grid_width"],
            "height": row["grid_height"],
        },
        "pixel_matrix": json.loads(row["pixel_matrix"]),
        "color_summary": json.loads(row["color_summary"]),
    }
    body = json.dumps(payload, indent=2, ensure_ascii=False).encode("utf-8")
    filename = f"community_pattern_{post_id}.json"
    return StreamingResponse(
        io.BytesIO(body),
        media_type="application/json",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@app.get("/api/community/posts/{post_id}/download/png")
async def download_community_post_png(post_id: int):
    with community_db() as conn:
        row = _community_post_row(conn, post_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Community post not found")
        conn.execute(
            "UPDATE community_posts SET downloads = downloads + 1 WHERE id = ?",
            (post_id,),
        )
        conn.commit()

    pixel_matrix = json.loads(row["pixel_matrix"])
    color_summary = json.loads(row["color_summary"])
    color_data = {entry["code"]: entry["hex"] for entry in color_summary}
    png_bytes = export_png(
        pixel_matrix,
        color_data,
        color_summary,
        16,
        True,
        True,
        True,
        row["palette_preset"],
    )
    filename = f"community_pattern_{post_id}.png"
    return StreamingResponse(
        io.BytesIO(png_bytes),
        media_type="image/png",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


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
