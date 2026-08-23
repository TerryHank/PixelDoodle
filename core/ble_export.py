"""BLE export module for sending pixel matrix to ESP32 via Bluetooth Low Energy.

Protocol:
- Packet type 0x01: Start image
- Packet type 0x02: Data chunk (up to 20 bytes per BLE packet)
- Packet type 0x03: End image
"""

import asyncio
import struct
from typing import List, Optional, Tuple

from bleak import BleakClient, BleakScanner

from .color_match import ArtkalPalette
from .commerce.device_grant import token_to_wire_bytes


SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
CHARACTERISTIC_UUID = "beb5483e-36e1-4688-b7f5-ea0734b3e6c1"
IMAGE_SIZE = 8192  # 64x64 * 2 bytes
MTU_SIZE = 20  # BLE default MTU - 3 (header)
RGB565_BLACK = 0x0000
TRANSPARENT_RGB565 = 0x0001
PKT_ACTIVATION_START = 0x0B
PKT_ACTIVATION_DATA = 0x0C
PKT_ACTIVATION_COMMIT = 0x0D
NTF_ACTIVATION_STATUS = 0x27
ACTIVATION_UNLOCKED = 0x01


def build_device_activation_packets(access_token: str) -> List[bytes]:
    """Build BLE packets for the firmware's signed activation handshake."""

    grant = token_to_wire_bytes(access_token)
    packets = [
        bytes(
            [
                PKT_ACTIVATION_START,
                len(grant) & 0xFF,
                (len(grant) >> 8) & 0xFF,
            ]
        )
    ]
    packets.extend(
        bytes([PKT_ACTIVATION_DATA]) + grant[offset : offset + 19]
        for offset in range(0, len(grant), 19)
    )
    packets.append(bytes([PKT_ACTIVATION_COMMIT]))
    return packets


async def _activate_connected_device(
    client: BleakClient,
    access_token: str,
    *,
    timeout: float = 5.0,
) -> None:
    """Activate a connected device and require its cryptographic acknowledgement."""

    try:
        packets = build_device_activation_packets(access_token)
    except ValueError as error:
        raise PermissionError(f"invalid device activation grant: {error}") from error
    loop = asyncio.get_running_loop()
    activation_result: asyncio.Future[int] = loop.create_future()

    def on_notification(_sender, data: bytearray) -> None:
        if (
            len(data) >= 2
            and data[0] == NTF_ACTIVATION_STATUS
            and not activation_result.done()
        ):
            activation_result.set_result(int(data[1]))

    await client.start_notify(CHARACTERISTIC_UUID, on_notification)
    try:
        for packet in packets:
            await client.write_gatt_char(CHARACTERISTIC_UUID, packet)
            await asyncio.sleep(0.02)
        try:
            status = await asyncio.wait_for(activation_result, timeout=timeout)
        except asyncio.TimeoutError as error:
            raise PermissionError("device did not acknowledge the activation grant") from error
        if status != ACTIVATION_UNLOCKED:
            raise PermissionError(f"device rejected activation grant (status={status})")
    finally:
        await client.stop_notify(CHARACTERISTIC_UUID)


async def activate_device_ble(
    device_address: str,
    access_token: str,
    *,
    timeout: float = 10.0,
) -> dict:
    """Activate a BLE device without transferring an image."""

    import time

    started_at = time.time()
    async with BleakClient(device_address, timeout=timeout) as client:
        await _activate_connected_device(client, access_token, timeout=min(timeout, 5.0))
    return {
        "success": True,
        "device": device_address,
        "duration_ms": int((time.time() - started_at) * 1000),
    }


def rgb_to_rgb565(r: int, g: int, b: int) -> int:
    """Convert 8-bit RGB to RGB565 format."""
    r5 = (r >> 3) & 0x1F
    g6 = (g >> 2) & 0x3F
    b5 = (b >> 3) & 0x1F
    return (r5 << 11) | (g6 << 5) | b5


def background_fill_rgb565(background_color: Tuple[int, int, int]) -> int:
    """Encode transparent pixels without colliding with real black beads."""
    rgb565 = rgb_to_rgb565(*background_color)
    return TRANSPARENT_RGB565 if rgb565 == RGB565_BLACK else rgb565


def pixel_matrix_to_rgb565(
    pixel_matrix: List[List[Optional[str]]],
    palette: ArtkalPalette,
    background_color: Tuple[int, int, int] = (0, 0, 0),
) -> bytes:
    """Convert pixel matrix to RGB565 binary data."""
    if not pixel_matrix or not pixel_matrix[0]:
        return b''
    
    data = bytearray()
    background_rgb565 = background_fill_rgb565(background_color)
    
    for row in pixel_matrix:
        for code in row:
            if code is None:
                rgb565 = background_rgb565
            else:
                color_info = palette.get_by_code(code)
                if color_info:
                    rgb565 = rgb_to_rgb565(*color_info['rgb'])
                else:
                    rgb565 = rgb_to_rgb565(255, 255, 255)
            data.extend(struct.pack('<H', rgb565))
    
    # Pad to IMAGE_SIZE
    if len(data) < IMAGE_SIZE:
        fill_bytes = struct.pack('<H', background_rgb565)
        data += fill_bytes * ((IMAGE_SIZE - len(data)) // 2)
    elif len(data) > IMAGE_SIZE:
        data = data[:IMAGE_SIZE]
    
    return bytes(data)


async def scan_ble_devices() -> List[dict]:
    """Scan for available BLE devices."""
    devices = await BleakScanner.discover()
    result = []
    for d in devices:
        if d.name and d.name.startswith("BeadCraft-"):
            device_uuid = d.name.split("BeadCraft-", 1)[1].strip().upper()
            result.append({
                'address': d.address,
                'name': d.name,
                'device_uuid': device_uuid,
            })
    return result


async def send_to_esp32_ble(
    pixel_matrix: List[List[Optional[str]]],
    palette: ArtkalPalette,
    device_address: str = None,
    device_uuid: str = None,
    access_token: str = None,
    background_color: Tuple[int, int, int] = (0, 0, 0),
    timeout: float = 30.0,
) -> dict:
    """Send pixel matrix to ESP32 via BLE.
    
    Args:
        pixel_matrix: 2D list of color codes
        palette: ArtkalPalette instance
        device_address: BLE device address (auto-detect if None)
        background_color: RGB for transparent cells
        timeout: Connection timeout in seconds
    
    Returns:
        Dict with 'success', 'message', 'bytes_sent', 'duration_ms'
    """
    import time
    start_time = time.time()
    
    try:
        # Convert to RGB565
        rgb565_data = pixel_matrix_to_rgb565(pixel_matrix, palette, background_color)
        
        # Auto-detect device if not specified
        if not device_address:
            devices = await scan_ble_devices()
            if not devices:
                return {
                    'success': False,
                    'message': 'No BeadCraft BLE device found',
                    'bytes_sent': 0,
                    'duration_ms': int((time.time() - start_time) * 1000),
                }
            if device_uuid:
                normalized_uuid = device_uuid.strip().upper()
                matched = next((d for d in devices if d.get('device_uuid', '').upper() == normalized_uuid), None)
                if not matched:
                    return {
                        'success': False,
                        'message': f'Device UUID not found: {normalized_uuid}',
                        'bytes_sent': 0,
                        'duration_ms': int((time.time() - start_time) * 1000),
                    }
                device_address = matched['address']
            else:
                device_address = devices[0]['address']
        
        # Connect and send
        async with BleakClient(device_address, timeout=timeout) as client:
            print(f"[BLE] Connected to {device_address}")

            if access_token:
                await _activate_connected_device(client, access_token)
            
            # Send start packet
            await client.write_gatt_char(CHARACTERISTIC_UUID, bytes([0x01]))
            
            # Send data in chunks (19 bytes per chunk, 1 byte for packet type)
            chunk_size = 19
            bytes_sent = 0
            
            for i in range(0, len(rgb565_data), chunk_size):
                chunk = rgb565_data[i:i+chunk_size]
                packet = bytes([0x02]) + chunk
                await client.write_gatt_char(CHARACTERISTIC_UUID, packet)
                bytes_sent += len(chunk)
                await asyncio.sleep(0.01)  # Small delay to avoid overwhelming
            
            # Send end packet with checksum (same protocol as web BLE)
            checksum = sum(rgb565_data) & 0xFFFF
            end_packet = bytes([0x03, checksum & 0xFF, (checksum >> 8) & 0xFF])
            await client.write_gatt_char(CHARACTERISTIC_UUID, end_packet)
            
            print(f"[BLE] Sent {bytes_sent} bytes")
        
        duration_ms = int((time.time() - start_time) * 1000)
        
        return {
            'success': True,
            'message': 'Image sent successfully',
            'bytes_sent': bytes_sent,
            'duration_ms': duration_ms,
            'device': device_address,
        }
        
    except PermissionError:
        raise
    except Exception as e:
        return {
            'success': False,
            'message': f'BLE error: {str(e)}',
            'bytes_sent': 0,
            'duration_ms': int((time.time() - start_time) * 1000),
        }


def send_to_esp32_ble_sync(
    pixel_matrix: List[List[Optional[str]]],
    palette: ArtkalPalette,
    device_address: str = None,
    device_uuid: str = None,
    access_token: str = None,
    background_color: Tuple[int, int, int] = (0, 0, 0),
    timeout: float = 30.0,
) -> dict:
    """Synchronous wrapper for BLE send."""
    return asyncio.run(send_to_esp32_ble(
        pixel_matrix,
        palette,
        device_address,
        device_uuid,
        access_token,
        background_color,
        timeout,
    ))


async def send_highlight_ble(
    highlight_colors: List[Tuple[int, int, int]],
    device_address: str = None,
    timeout: float = 10.0,
) -> dict:
    """Send highlight command to ESP32 via BLE.
    
    Args:
        highlight_colors: List of RGB tuples to highlight
        device_address: BLE device address (auto-detect if None)
        timeout: Connection timeout
    
    Returns:
        Dict with 'success', 'message'
    """
    import time
    start_time = time.time()
    
    try:
        # Auto-detect device if not specified
        if not device_address:
            devices = await scan_ble_devices()
            if not devices:
                return {
                    'success': False,
                    'message': 'No BeadCraft BLE device found',
                }
            device_address = devices[0]['address']
        
        # Convert RGB to RGB565
        rgb565_colors = []
        for r, g, b in highlight_colors:
            rgb565 = rgb_to_rgb565(r, g, b)
            rgb565_colors.append(rgb565)
        
        # Build packet: [0x04][count][RGB565...]
        packet = bytearray([0x04, len(rgb565_colors)])
        for color in rgb565_colors:
            packet.extend(struct.pack('<H', color))
        
        # Connect and send
        async with BleakClient(device_address, timeout=timeout) as client:
            await client.write_gatt_char(CHARACTERISTIC_UUID, bytes(packet))
        
        return {
            'success': True,
            'message': f'Highlight {len(highlight_colors)} colors',
            'duration_ms': int((time.time() - start_time) * 1000),
        }
        
    except Exception as e:
        return {
            'success': False,
            'message': f'BLE error: {str(e)}',
        }


def send_highlight_ble_sync(
    highlight_colors: List[Tuple[int, int, int]],
    device_address: str = None,
    timeout: float = 10.0,
) -> dict:
    """Synchronous wrapper for BLE highlight."""
    return asyncio.run(send_highlight_ble(highlight_colors, device_address, timeout))
