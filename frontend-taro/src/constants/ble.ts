export const BLE_SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b'
export const BLE_CHARACTERISTIC_UUID = 'beb5483e-36e1-4688-b7f5-ea0734b3e6c1'
export const BLE_WIFI_SCAN_CHARACTERISTIC_UUID = '9f6b2a1d-6a52-4f4e-93c7-8d9c6d41e7a1'
export const BLE_IMAGE_CANVAS_SIZE = 64
export const BLE_IMAGE_PAYLOAD_BYTES = BLE_IMAGE_CANVAS_SIZE * BLE_IMAGE_CANVAS_SIZE * 2
export const BLE_CHUNK_SIZE = 19
export const BLE_PREFERRED_MTU = 247
export const BLE_PACKET_OVERHEAD_BYTES = 4
export const BLE_ACK_TIMEOUT_MS = 5000
export const BLE_STATUS_TIMEOUT_MS = 5000
export const BLE_ACTIVATION_TIMEOUT_MS = 5000
export const BLE_PACKET_GAP_MS = 8
export const BLE_WIFI_SCAN_TIMEOUT_MS = 15000
export const BLE_WIFI_CONNECT_TIMEOUT_MS = 20000
export const BLE_WIFI_SCAN_PACKET = 0x07
export const BLE_WIFI_CONNECT_PACKET = 0x08
export const BLE_WIFI_SCAN_BEGIN = 0x21
export const BLE_WIFI_SCAN_DATA = 0x22
export const BLE_WIFI_SCAN_END = 0x23
export const BLE_WIFI_SCAN_ERROR = 0x24
export const BLE_GET_STATUS_PACKET = 0x0A
export const BLE_STATUS_NOTIFICATION = 0x26
export const BLE_ACTIVATION_START_PACKET = 0x0B
export const BLE_ACTIVATION_DATA_PACKET = 0x0C
export const BLE_ACTIVATION_COMMIT_PACKET = 0x0D
export const BLE_ACTIVATION_NOTIFICATION = 0x27
export const BLE_ACTIVATION_UNLOCKED = 0x01

export function resolveBleChunkSizeForMtu(mtu?: number) {
  const negotiatedMtu = Number.isFinite(mtu) ? Number(mtu) : 0
  if (negotiatedMtu <= BLE_PACKET_OVERHEAD_BYTES) {
    return BLE_CHUNK_SIZE
  }

  return Math.max(
    BLE_CHUNK_SIZE,
    negotiatedMtu - BLE_PACKET_OVERHEAD_BYTES
  )
}
