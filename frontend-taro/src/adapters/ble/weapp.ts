import Taro from '@tarojs/taro'
import {
  BLE_CHARACTERISTIC_UUID,
  BLE_CHUNK_SIZE,
  BLE_SERVICE_UUID,
  BLE_WIFI_CONNECT_TIMEOUT_MS,
  BLE_WIFI_SCAN_CHARACTERISTIC_UUID,
  BLE_WIFI_CONNECT_PACKET,
  BLE_WIFI_SCAN_BEGIN,
  BLE_WIFI_SCAN_DATA,
  BLE_WIFI_SCAN_END,
  BLE_WIFI_SCAN_ERROR,
  BLE_WIFI_SCAN_PACKET
} from '@/constants/ble'
import {
  buildHighlightPacket,
  buildImagePackets,
  buildWifiConnectPacket,
  decodeUtf8,
  parseWifiScanResult
} from '@/utils/ble-packet'
import type { WifiScanResult } from '@/types/device'
import type { BleAdapter } from './types'

let currentDeviceId = ''
let notificationReady = false
let listenerReady = false
let wifiScanBuffer = ''
let wifiScanPendingResult: WifiScanResult[] | null = null
let wifiScanPendingError: Error | null = null
let wifiConnectPendingResult: string | null = null
let wifiConnectPendingError: Error | null = null

interface PendingWaiter<TValue> {
  timer: ReturnType<typeof setTimeout>
  resolve: (value: TValue) => void
  reject: (error: Error) => void
}

let wifiScanWaiters: PendingWaiter<WifiScanResult[]>[] = []
let wifiConnectWaiters: PendingWaiter<string>[] = []

function normalizeBleDeviceUuid(name?: string | null) {
  const match = name?.match(/BeadCraft-([0-9A-F]{12})/i)
  return match?.[1]?.toUpperCase() || ''
}

function toArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

function matchesTargetDevice(name: string, uuid?: string) {
  if (!uuid) {
    return name.startsWith('BeadCraft-')
  }

  return name.includes(uuid)
}

async function wait(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

function clearWaiters<TValue>(
  waiters: PendingWaiter<TValue>[],
  errorMessage: string
) {
  while (waiters.length) {
    const waiter = waiters.shift()
    if (waiter) {
      clearTimeout(waiter.timer)
      waiter.reject(new Error(errorMessage))
    }
  }
}

function resetWifiSyncState() {
  wifiScanBuffer = ''
  wifiScanPendingResult = null
  wifiScanPendingError = null
  wifiConnectPendingResult = null
  wifiConnectPendingError = null
  clearWaiters(wifiScanWaiters, '蓝牙连接已断开')
  clearWaiters(wifiConnectWaiters, '蓝牙连接已断开')
}

function normalizeCharacteristicId(value: string) {
  return value.toLowerCase()
}

function ensureBleListener() {
  if (listenerReady) {
    return
  }

  Taro.onBLECharacteristicValueChange((result) => {
    if (result.deviceId !== currentDeviceId) {
      return
    }

    const bytes = new Uint8Array(result.value)
    if (!bytes.length) {
      return
    }

    const characteristicId = normalizeCharacteristicId(result.characteristicId)
    if (
      characteristicId !==
      normalizeCharacteristicId(BLE_WIFI_SCAN_CHARACTERISTIC_UUID)
    ) {
      return
    }

    const code = bytes[0]
    const status = String.fromCharCode(code)
    const payload = decodeUtf8(bytes.slice(1))

    if (code === BLE_WIFI_SCAN_BEGIN) {
      wifiScanBuffer = ''
      return
    }

    if (code === BLE_WIFI_SCAN_DATA) {
      wifiScanBuffer += payload
      return
    }

    if (code === BLE_WIFI_SCAN_END) {
      const results = parseWifiScanResult(wifiScanBuffer)
      const waiter = wifiScanWaiters.shift()

      if (waiter) {
        clearTimeout(waiter.timer)
        waiter.resolve(results)
      } else {
        wifiScanPendingResult = results
      }

      wifiScanBuffer = ''
      return
    }

    if (status === 'D') {
      const results = parseWifiScanResult(payload)
      const waiter = wifiScanWaiters.shift()

      if (waiter) {
        clearTimeout(waiter.timer)
        waiter.resolve(results)
      } else {
        wifiScanPendingResult = results
      }

      wifiScanBuffer = ''
      return
    }

    if (code === BLE_WIFI_SCAN_ERROR || status === 'E') {
      const error = new Error(payload || 'ESP32 WiFi scan failed')
      const waiter = wifiScanWaiters.shift()

      if (waiter) {
        clearTimeout(waiter.timer)
        waiter.reject(error)
      } else {
        wifiScanPendingError = error
      }

      wifiScanBuffer = ''
      return
    }

    if (status === 'C') {
      const waiter = wifiConnectWaiters.shift()

      if (waiter) {
        clearTimeout(waiter.timer)
        waiter.resolve(payload.trim())
      } else {
        wifiConnectPendingResult = payload.trim()
      }

      return
    }

    if (status === 'F') {
      const error = new Error(payload || 'ESP32 WiFi connect failed')
      const waiter = wifiConnectWaiters.shift()

      if (waiter) {
        clearTimeout(waiter.timer)
        waiter.reject(error)
      } else {
        wifiConnectPendingError = error
      }
    }
  })

  listenerReady = true
}

function waitForWifiScan(timeoutMs: number) {
  return new Promise<WifiScanResult[]>((resolve, reject) => {
    if (wifiScanPendingError) {
      const error = wifiScanPendingError
      wifiScanPendingError = null
      reject(error)
      return
    }

    if (wifiScanPendingResult) {
      const results = wifiScanPendingResult
      wifiScanPendingResult = null
      resolve(results)
      return
    }

    const waiter: PendingWaiter<WifiScanResult[]> = {
      timer: setTimeout(() => {
        const index = wifiScanWaiters.indexOf(waiter)
        if (index >= 0) {
          wifiScanWaiters.splice(index, 1)
        }
        reject(new Error('WiFi scan timeout'))
      }, timeoutMs),
      resolve,
      reject
    }

    wifiScanWaiters.push(waiter)
  })
}

function waitForWifiConnect(timeoutMs: number) {
  return new Promise<string>((resolve, reject) => {
    if (wifiConnectPendingError) {
      const error = wifiConnectPendingError
      wifiConnectPendingError = null
      reject(error)
      return
    }

    if (wifiConnectPendingResult) {
      const result = wifiConnectPendingResult
      wifiConnectPendingResult = null
      resolve(result)
      return
    }

    const waiter: PendingWaiter<string> = {
      timer: setTimeout(() => {
        const index = wifiConnectWaiters.indexOf(waiter)
        if (index >= 0) {
          wifiConnectWaiters.splice(index, 1)
        }
        reject(new Error('WiFi connect timeout'))
      }, timeoutMs),
      resolve,
      reject
    }

    wifiConnectWaiters.push(waiter)
  })
}

async function discoverTargetDevice(uuid?: string) {
  await Taro.openBluetoothAdapter()
  ensureBleListener()
  await Taro.startBluetoothDevicesDiscovery({
    allowDuplicatesKey: false,
    services: [BLE_SERVICE_UUID]
  })

  const deadline = Date.now() + 10000

  while (Date.now() < deadline) {
    const devices = await Taro.getBluetoothDevices()
    const match = devices.devices.find((item) =>
      matchesTargetDevice(item.name || item.localName || '', uuid)
    )

    if (match?.deviceId) {
      await Taro.stopBluetoothDevicesDiscovery()
      return match
    }

    await wait(400)
  }

  await Taro.stopBluetoothDevicesDiscovery()
  throw new Error('未找到目标蓝牙设备')
}

function ensureConnectedDevice() {
  if (!currentDeviceId) {
    throw new Error('蓝牙设备尚未连接')
  }

  return currentDeviceId
}

async function enableNotifications(deviceId: string) {
  if (notificationReady) {
    return
  }

  await Taro.notifyBLECharacteristicValueChange({
    deviceId,
    serviceId: BLE_SERVICE_UUID,
    characteristicId: BLE_CHARACTERISTIC_UUID,
    state: true
  })
  await Taro.notifyBLECharacteristicValueChange({
    deviceId,
    serviceId: BLE_SERVICE_UUID,
    characteristicId: BLE_WIFI_SCAN_CHARACTERISTIC_UUID,
    state: true
  })

  notificationReady = true
  await wait(200)
}

async function writeCommand(bytes: Uint8Array) {
  const deviceId = ensureConnectedDevice()
  await Taro.writeBLECharacteristicValue({
    deviceId,
    serviceId: BLE_SERVICE_UUID,
    characteristicId: BLE_CHARACTERISTIC_UUID,
    value: toArrayBuffer(bytes)
  })
}

export const weappBleAdapter: BleAdapter = {
  async connectTargetDevice(uuid) {
    const targetDevice = await discoverTargetDevice(uuid)
    currentDeviceId = targetDevice.deviceId
    notificationReady = false
    resetWifiSyncState()

    await Taro.createBLEConnection({
      deviceId: currentDeviceId
    })
    await Taro.getBLEDeviceServices({
      deviceId: currentDeviceId
    })
    await enableNotifications(currentDeviceId)
    return (
      normalizeBleDeviceUuid(targetDevice.name || targetDevice.localName || '') ||
      null
    )
  },

  async sendImage(payload) {
    const deviceId = ensureConnectedDevice()

    for (const packet of buildImagePackets(payload, BLE_CHUNK_SIZE)) {
      await Taro.writeBLECharacteristicValue({
        deviceId,
        serviceId: BLE_SERVICE_UUID,
        characteristicId: BLE_CHARACTERISTIC_UUID,
        value: toArrayBuffer(packet)
      })
    }
  },

  async sendHighlight(colors) {
    const deviceId = ensureConnectedDevice()
    const packet = buildHighlightPacket(colors)

    await Taro.writeBLECharacteristicValue({
      deviceId,
      serviceId: BLE_SERVICE_UUID,
      characteristicId: BLE_CHARACTERISTIC_UUID,
      value: toArrayBuffer(packet)
    })
  },

  async scanWifiNetworks() {
    ensureConnectedDevice()
    wifiScanBuffer = ''
    wifiScanPendingError = null
    wifiScanPendingResult = null

    const waitTask = waitForWifiScan(15000)
    await writeCommand(Uint8Array.from([BLE_WIFI_SCAN_PACKET]))
    return waitTask
  },

  async connectWifiNetwork({ ssid, password }) {
    ensureConnectedDevice()

    if (!ssid.trim()) {
      throw new Error('请选择要连接的 WiFi 热点')
    }

    wifiConnectPendingError = null
    wifiConnectPendingResult = null

    const packet = buildWifiConnectPacket(ssid.trim(), password ?? '')
    if (packet[0] !== BLE_WIFI_CONNECT_PACKET) {
      throw new Error('WiFi 配网数据包构造失败')
    }

    const waitTask = waitForWifiConnect(BLE_WIFI_CONNECT_TIMEOUT_MS)
    await writeCommand(packet)
    return waitTask
  }
}
