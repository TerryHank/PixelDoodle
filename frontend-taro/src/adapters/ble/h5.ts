import {
  BLE_ACK_TIMEOUT_MS,
  BLE_CHARACTERISTIC_UUID,
  BLE_CHUNK_SIZE,
  BLE_PACKET_GAP_MS,
  BLE_SERVICE_UUID,
  BLE_WIFI_SCAN_BEGIN,
  BLE_WIFI_SCAN_CHARACTERISTIC_UUID,
  BLE_WIFI_SCAN_DATA,
  BLE_WIFI_SCAN_END,
  BLE_WIFI_SCAN_ERROR,
  BLE_WIFI_SCAN_PACKET,
  BLE_WIFI_SCAN_TIMEOUT_MS
} from '@/constants/ble'
import {
  buildHighlightPacket,
  buildImagePackets,
  parseWifiScanResult
} from '@/utils/ble-packet'
import type { BleAdapter } from './types'

interface AckWaiter {
  timer: ReturnType<typeof setTimeout>
  resolve: (value: number) => void
  reject: (error: Error) => void
}

let bleDevice: BluetoothDevice | null = null
let imageCharacteristic: BluetoothRemoteGATTCharacteristic | null = null
let wifiCharacteristic: BluetoothRemoteGATTCharacteristic | null = null
let imageNotifyReady = false
let wifiNotifyReady = false
let ackWaiters: AckWaiter[] = []

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

function normalizeBleDeviceUuid(name?: string | null) {
  const match = name?.match(/BeadCraft-([0-9A-F]{12})/i)
  return match?.[1]?.toUpperCase() || ''
}

function isMatchingConnectedDevice(uuid?: string) {
  if (!bleDevice?.gatt?.connected) {
    return false
  }

  if (!uuid) {
    return true
  }

  return normalizeBleDeviceUuid(bleDevice.name) === uuid
}

function resetBluetoothState() {
  imageCharacteristic = null
  wifiCharacteristic = null
  imageNotifyReady = false
  wifiNotifyReady = false

  while (ackWaiters.length) {
    const waiter = ackWaiters.shift()
    if (waiter) {
      clearTimeout(waiter.timer)
      waiter.reject(new Error('Bluetooth disconnected'))
    }
  }
}

function handleBluetoothDisconnect() {
  resetBluetoothState()
}

function handleAckNotification(event: Event) {
  const target = event.target as BluetoothRemoteGATTCharacteristic | null
  const value = target?.value

  if (!value || value.byteLength < 1) {
    return
  }

  const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  const waiter = ackWaiters.shift()

  if (!waiter) {
    return
  }

  clearTimeout(waiter.timer)
  waiter.resolve(bytes[0])
}

function waitForAck(timeoutMs = BLE_ACK_TIMEOUT_MS) {
  return new Promise<number>((resolve, reject) => {
    const waiter: AckWaiter = {
      timer: setTimeout(() => {
        const index = ackWaiters.indexOf(waiter)
        if (index >= 0) {
          ackWaiters.splice(index, 1)
        }
        reject(new Error('BLE ack timeout'))
      }, timeoutMs),
      resolve,
      reject
    }

    ackWaiters.push(waiter)
  })
}

async function writePacket(
  characteristic: BluetoothRemoteGATTCharacteristic,
  bytes: Uint8Array
) {
  if (typeof characteristic.writeValueWithoutResponse === 'function') {
    await characteristic.writeValueWithoutResponse(bytes)
  } else {
    await characteristic.writeValue(bytes)
  }

  if (BLE_PACKET_GAP_MS > 0) {
    await wait(BLE_PACKET_GAP_MS)
  }
}

async function requestBleDevice(uuid?: string) {
  if (!navigator.bluetooth) {
    throw new Error('当前浏览器不支持 Web Bluetooth')
  }

  if (isMatchingConnectedDevice(uuid)) {
    return bleDevice
  }

  const exactFilters = uuid
    ? [{ name: `BeadCraft-${uuid}` }]
    : [{ namePrefix: 'BeadCraft-' }]

  let nextDevice: BluetoothDevice

  try {
    nextDevice = await navigator.bluetooth.requestDevice({
      filters: exactFilters,
      optionalServices: [BLE_SERVICE_UUID]
    })
  } catch (error) {
    if (
      !uuid ||
      !(error instanceof Error) ||
      error.name !== 'NotFoundError'
    ) {
      throw error
    }

    nextDevice = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'BeadCraft-' }],
      optionalServices: [BLE_SERVICE_UUID]
    })
  }

  if (bleDevice) {
    bleDevice.removeEventListener('gattserverdisconnected', handleBluetoothDisconnect)
  }

  bleDevice = nextDevice
  bleDevice.addEventListener('gattserverdisconnected', handleBluetoothDisconnect)
  resetBluetoothState()

  return bleDevice
}

async function ensureCharacteristics(uuid?: string) {
  await requestBleDevice(uuid)

  if (!bleDevice?.gatt) {
    throw new Error('目标蓝牙设备未暴露 GATT 服务')
  }

  if (
    imageCharacteristic &&
    wifiCharacteristic &&
    bleDevice.gatt.connected &&
    (!uuid || normalizeBleDeviceUuid(bleDevice.name) === uuid)
  ) {
    return {
      imageCharacteristic,
      wifiCharacteristic
    }
  }

  const server = await bleDevice.gatt.connect()
  const service = await server.getPrimaryService(BLE_SERVICE_UUID)
  const nextImageCharacteristic = await service.getCharacteristic(BLE_CHARACTERISTIC_UUID)
  const nextWifiCharacteristic = await service.getCharacteristic(
    BLE_WIFI_SCAN_CHARACTERISTIC_UUID
  )

  if (!imageNotifyReady) {
    await nextImageCharacteristic.startNotifications()
    nextImageCharacteristic.addEventListener(
      'characteristicvaluechanged',
      handleAckNotification
    )
    imageNotifyReady = true
  }

  if (!wifiNotifyReady) {
    await nextWifiCharacteristic.startNotifications()
    wifiNotifyReady = true
  }

  imageCharacteristic = nextImageCharacteristic
  wifiCharacteristic = nextWifiCharacteristic

  return {
    imageCharacteristic,
    wifiCharacteristic
  }
}

export const h5BleAdapter: BleAdapter = {
  async connectTargetDevice(uuid) {
    await ensureCharacteristics(uuid)
  },

  async sendImage(payload) {
    const { imageCharacteristic } = await ensureCharacteristics()

    for (const packet of buildImagePackets(payload, BLE_CHUNK_SIZE)) {
      await writePacket(imageCharacteristic, packet)
    }

    const ack = await waitForAck()
    if (ack !== 0x06) {
      throw new Error('BLE image send was rejected by the device')
    }
  },

  async sendHighlight(colors) {
    const { imageCharacteristic } = await ensureCharacteristics()
    await writePacket(imageCharacteristic, buildHighlightPacket(colors))
  },

  async scanWifiNetworks() {
    const { imageCharacteristic, wifiCharacteristic } = await ensureCharacteristics()

    await writePacket(imageCharacteristic, Uint8Array.from([BLE_WIFI_SCAN_PACKET]))

    const deadline = Date.now() + BLE_WIFI_SCAN_TIMEOUT_MS
    let buffer = ''

    while (Date.now() < deadline) {
      const value = await wifiCharacteristic.readValue()
      const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)

      if (bytes.length > 0) {
        const code = bytes[0]
        const status = String.fromCharCode(code)
        const payload = new TextDecoder().decode(bytes.slice(1))

        if (code === BLE_WIFI_SCAN_BEGIN) {
          buffer = ''
        } else if (code === BLE_WIFI_SCAN_DATA) {
          buffer += payload
        } else if (code === BLE_WIFI_SCAN_END) {
          return parseWifiScanResult(buffer)
        } else if (status === 'D') {
          return parseWifiScanResult(payload)
        }

        if (code === BLE_WIFI_SCAN_ERROR || status === 'E') {
          throw new Error(payload || 'ESP32 WiFi scan failed')
        }
      }

      await wait(250)
    }

    throw new Error('WiFi scan timeout')
  }
}
