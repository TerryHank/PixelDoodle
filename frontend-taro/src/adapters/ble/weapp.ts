import Taro from '@tarojs/taro'
import {
  BLE_CHARACTERISTIC_UUID,
  BLE_CHUNK_SIZE,
  BLE_PREFERRED_MTU,
  BLE_SERVICE_UUID,
  BLE_WIFI_CONNECT_TIMEOUT_MS,
  BLE_WIFI_SCAN_CHARACTERISTIC_UUID,
  BLE_WIFI_CONNECT_PACKET,
  resolveBleChunkSizeForMtu,
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

interface WeappBluetoothDeviceLike {
  deviceId?: string
  name?: string
  localName?: string
  RSSI?: number
  rssi?: number
}

interface NearbyBleDeviceRecord {
  key: string
  deviceId: string
  name: string
  uuid: string
  rssi: number
}

type BleWriteType = 'write' | 'writeNoResponse'

interface WeappBleCharacteristicProperties {
  write?: boolean
  writeDefault?: boolean
  writeNoResponse?: boolean
}

interface WeappBleCharacteristicLike {
  uuid?: string
  properties?: WeappBleCharacteristicProperties
}

let currentDeviceId = ''
let currentServiceId = ''
let currentImageCharacteristicId = ''
let currentWifiCharacteristicId = ''
let currentChunkPayloadSize = BLE_CHUNK_SIZE
let currentImageWriteType: BleWriteType = 'write'
let notificationReady = false
let listenerReady = false
let discoveryListenerReady = false
let wifiScanBuffer = ''
let wifiScanPendingResult: WifiScanResult[] | null = null
let wifiScanPendingError: Error | null = null
let wifiConnectPendingResult: string | null = null
let wifiConnectPendingError: Error | null = null
const nearbyBleDevices = new Map<string, NearbyBleDeviceRecord>()
let connectedDeviceRecord: NearbyBleDeviceRecord | null = null

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

function getBleDeviceName(device?: WeappBluetoothDeviceLike | null) {
  return String(device?.name || device?.localName || '').trim()
}

function isBeadCraftBleDevice(device?: WeappBluetoothDeviceLike | null) {
  return getBleDeviceName(device).startsWith('BeadCraft-')
}

function readDeviceRssi(device?: WeappBluetoothDeviceLike | null) {
  const value = device?.RSSI ?? device?.rssi
  return Number.isFinite(value) ? Number(value) : -999
}

function cacheNearbyBleDevice(device?: WeappBluetoothDeviceLike | null) {
  if (!device?.deviceId || !isBeadCraftBleDevice(device)) {
    return
  }

  const name = getBleDeviceName(device)
  const record: NearbyBleDeviceRecord = {
    key: device.deviceId,
    deviceId: device.deviceId,
    name,
    uuid: normalizeBleDeviceUuid(name),
    rssi: readDeviceRssi(device)
  }
  const previous = nearbyBleDevices.get(record.key)

  if (!previous || record.rssi >= previous.rssi) {
    nearbyBleDevices.set(record.key, record)
  }
}

function listNearbyBleDevices() {
  const merged = new Map<string, NearbyBleDeviceRecord>()

  if (connectedDeviceRecord) {
    merged.set(connectedDeviceRecord.key, connectedDeviceRecord)
  }

  nearbyBleDevices.forEach((record) => {
    merged.set(record.key, record)
  })

  return Array.from(merged.values()).sort((left, right) => right.rssi - left.rssi)
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
  currentChunkPayloadSize = BLE_CHUNK_SIZE
  currentImageWriteType = 'write'
  clearWaiters(wifiScanWaiters, '蓝牙连接已断开')
  clearWaiters(wifiConnectWaiters, '蓝牙连接已断开')
}

function normalizeCharacteristicId(value: string) {
  return value.toLowerCase()
}

function readWeappPlatform() {
  if (typeof Taro.getSystemInfoSync !== 'function') {
    return ''
  }

  try {
    return String(Taro.getSystemInfoSync()?.platform || '').toLowerCase()
  } catch {
    return ''
  }
}

function resolvePreferredImageWriteType(
  properties?: WeappBleCharacteristicProperties
): BleWriteType {
  const supportsWriteNoResponse = Boolean(properties?.writeNoResponse)
  const supportsWriteDefault =
    properties?.writeDefault !== false && properties?.write !== false

  if (!supportsWriteNoResponse) {
    return 'write'
  }

  if (!supportsWriteDefault) {
    return 'writeNoResponse'
  }

  return readWeappPlatform() === 'android' ? 'writeNoResponse' : 'write'
}

function getActiveServiceId() {
  if (!currentServiceId) {
    throw new Error('蓝牙服务尚未准备完成')
  }

  return currentServiceId
}

function getActiveImageCharacteristicId() {
  if (!currentImageCharacteristicId) {
    throw new Error('图像写入特征值尚未准备完成')
  }

  return currentImageCharacteristicId
}

function getActiveWifiCharacteristicId() {
  return currentWifiCharacteristicId
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
    const wifiCharacteristicId = normalizeCharacteristicId(
      currentWifiCharacteristicId || BLE_WIFI_SCAN_CHARACTERISTIC_UUID
    )
    if (characteristicId !== wifiCharacteristicId) {
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

function ensureBleDiscoveryListener() {
  if (discoveryListenerReady) {
    return
  }

  Taro.onBluetoothDeviceFound((result) => {
    const devices = Array.isArray(result.devices)
      ? result.devices
      : result.devices
        ? [result.devices]
        : []

    devices.forEach((device) => {
      cacheNearbyBleDevice(device)
    })
  })

  discoveryListenerReady = true
}

async function stopBleDiscovery() {
  try {
    await Taro.stopBluetoothDevicesDiscovery()
  } catch {
    // Ignore stop errors from stale or already-stopped scans.
  }
}

async function startBleDiscovery() {
  await Taro.openBluetoothAdapter()
  ensureBleListener()
  ensureBleDiscoveryListener()

  try {
    await Taro.startBluetoothDevicesDiscovery({
      allowDuplicatesKey: false
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/already/iu.test(message)) {
      throw error
    }
  }
}

async function scanNearbyBeadCraftDevices(timeoutMs = 5000) {
  nearbyBleDevices.clear()
  await startBleDiscovery()

  try {
    const initialDevices = await Taro.getBluetoothDevices()
    initialDevices.devices.forEach((device) => {
      cacheNearbyBleDevice(device)
    })

    await wait(timeoutMs)

    const discoveredDevices = await Taro.getBluetoothDevices()
    discoveredDevices.devices.forEach((device) => {
      cacheNearbyBleDevice(device)
    })

    return listNearbyBleDevices()
  } finally {
    await stopBleDiscovery()
  }
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

async function ensureBleCharacteristicConfig(deviceId: string) {
  const servicesResult = await Taro.getBLEDeviceServices({
    deviceId
  })
  const service =
    servicesResult.services.find(
      (item) =>
        normalizeCharacteristicId(item.uuid) ===
        normalizeCharacteristicId(BLE_SERVICE_UUID)
    ) || null

  if (!service?.uuid) {
    throw new Error('未找到 BeadCraft 蓝牙服务')
  }

  const characteristicsResult = await Taro.getBLEDeviceCharacteristics({
    deviceId,
    serviceId: service.uuid
  })
  const imageCharacteristic =
    characteristicsResult.characteristics.find(
      (item) =>
        normalizeCharacteristicId(item.uuid) ===
        normalizeCharacteristicId(BLE_CHARACTERISTIC_UUID)
    ) || null
  const wifiCharacteristic =
    characteristicsResult.characteristics.find(
      (item) =>
        normalizeCharacteristicId(item.uuid) ===
        normalizeCharacteristicId(BLE_WIFI_SCAN_CHARACTERISTIC_UUID)
    ) || null

  if (!imageCharacteristic?.uuid) {
    throw new Error('未找到图像传输特征值')
  }

  currentServiceId = service.uuid
  currentImageCharacteristicId = imageCharacteristic.uuid
  currentWifiCharacteristicId = wifiCharacteristic?.uuid || ''
  currentImageWriteType = resolvePreferredImageWriteType(
    (imageCharacteristic as WeappBleCharacteristicLike).properties
  )
}

async function negotiateBleMtu(deviceId: string) {
  currentChunkPayloadSize = BLE_CHUNK_SIZE

  if (typeof Taro.setBLEMTU !== 'function') {
    return
  }

  try {
    const result = await Taro.setBLEMTU({
      deviceId,
      mtu: BLE_PREFERRED_MTU
    })
    const negotiatedMtu =
      typeof result?.mtu === 'number' && Number.isFinite(result.mtu)
        ? result.mtu
        : BLE_PREFERRED_MTU

    currentChunkPayloadSize = resolveBleChunkSizeForMtu(negotiatedMtu)
  } catch {
    currentChunkPayloadSize = BLE_CHUNK_SIZE
  }

  if (typeof Taro.getBLEMTU !== 'function') {
    return
  }

  try {
    const result = await Taro.getBLEMTU({
      deviceId,
      writeType: currentImageWriteType
    })
    const mtu =
      typeof result?.mtu === 'number'
        ? result.mtu
        : Number.parseInt(String(result?.mtu ?? ''), 10)

    if (Number.isFinite(mtu) && mtu > 0) {
      currentChunkPayloadSize = resolveBleChunkSizeForMtu(mtu)
    }
  } catch {
    // Ignore unsupported getBLEMTU on this platform and keep negotiated/default chunk size.
  }
}

async function discoverTargetDevice(uuid?: string) {
  const devices = await scanNearbyBeadCraftDevices()
  const matchedDevice =
    devices.find((item) => matchesTargetDevice(item.name, uuid)) || null

  if (!matchedDevice) {
    throw new Error('未找到附近的 BeadCraft 蓝牙设备')
  }

  return matchedDevice
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

  const serviceId = getActiveServiceId()
  const imageCharacteristicId = getActiveImageCharacteristicId()
  await Taro.notifyBLECharacteristicValueChange({
    deviceId,
    serviceId,
    characteristicId: imageCharacteristicId,
    state: true
  })
  const wifiCharacteristicId = getActiveWifiCharacteristicId()
  if (wifiCharacteristicId) {
    await Taro.notifyBLECharacteristicValueChange({
      deviceId,
      serviceId,
      characteristicId: wifiCharacteristicId,
      state: true
    })
  }

  notificationReady = true
  await wait(200)
}

async function writeCommand(bytes: Uint8Array) {
  const deviceId = ensureConnectedDevice()
  const serviceId = getActiveServiceId()
  const characteristicId = getActiveImageCharacteristicId()
  await Taro.writeBLECharacteristicValue({
    deviceId,
    serviceId,
    characteristicId,
    value: toArrayBuffer(bytes),
    writeType: currentImageWriteType
  })
}

export const weappBleAdapter: BleAdapter = {
  async scanNearbyDevices() {
    const devices = await scanNearbyBeadCraftDevices()
    return devices.map((device) => ({
      key: device.key,
      name: device.name,
      uuid: device.uuid
    }))
  },

  async connectTargetDevice(uuid) {
    const targetDevice = await discoverTargetDevice(uuid)
    currentDeviceId = targetDevice.deviceId
    currentServiceId = ''
    currentImageCharacteristicId = ''
    currentWifiCharacteristicId = ''
    notificationReady = false
    resetWifiSyncState()

    await Taro.createBLEConnection({
      deviceId: currentDeviceId
    })
    await ensureBleCharacteristicConfig(currentDeviceId)
    await negotiateBleMtu(currentDeviceId)
    await enableNotifications(currentDeviceId)
    connectedDeviceRecord = targetDevice
    return targetDevice.uuid || null
  },

  async connectKnownDevice(deviceKey) {
    if (!deviceKey) {
      throw new Error('缺少蓝牙设备标识')
    }

    const targetDevice =
      listNearbyBleDevices().find((device) => device.key === deviceKey) ||
      (await scanNearbyBeadCraftDevices()).find((device) => device.key === deviceKey)

    if (!targetDevice) {
      throw new Error('未找到指定的 BeadCraft 蓝牙设备')
    }

    currentDeviceId = targetDevice.deviceId
    currentServiceId = ''
    currentImageCharacteristicId = ''
    currentWifiCharacteristicId = ''
    notificationReady = false
    resetWifiSyncState()

    await Taro.createBLEConnection({
      deviceId: currentDeviceId
    })
    await ensureBleCharacteristicConfig(currentDeviceId)
    await negotiateBleMtu(currentDeviceId)
    await enableNotifications(currentDeviceId)
    connectedDeviceRecord = targetDevice

    return targetDevice.uuid || null
  },

  async sendImage(payload) {
    const deviceId = ensureConnectedDevice()

    for (const packet of buildImagePackets(payload, currentChunkPayloadSize)) {
      await Taro.writeBLECharacteristicValue({
        deviceId,
        serviceId: getActiveServiceId(),
        characteristicId: getActiveImageCharacteristicId(),
        value: toArrayBuffer(packet),
        writeType: currentImageWriteType
      })
    }
  },

  async sendHighlight(colors) {
    const deviceId = ensureConnectedDevice()
    const packet = buildHighlightPacket(colors)

    await Taro.writeBLECharacteristicValue({
      deviceId,
      serviceId: getActiveServiceId(),
      characteristicId: getActiveImageCharacteristicId(),
      value: toArrayBuffer(packet),
      writeType: currentImageWriteType
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
