import {
  checkPermissions,
  connect,
  disconnect,
  getAdapterState,
  getMtu,
  send,
  setAndroidMtu,
  setWriteBehavior,
  startScan,
  subscribe,
  type BleDevice as NativeBleDevice
} from '@mnlphlp/plugin-blec'
import {
  BLE_ACK_TIMEOUT_MS,
  BLE_ACTIVATION_NOTIFICATION,
  BLE_ACTIVATION_TIMEOUT_MS,
  BLE_ACTIVATION_UNLOCKED,
  BLE_CHARACTERISTIC_UUID,
  BLE_CHUNK_SIZE,
  BLE_GET_STATUS_PACKET,
  BLE_PACKET_GAP_MS,
  BLE_PREFERRED_MTU,
  BLE_SERVICE_UUID,
  BLE_STATUS_NOTIFICATION,
  BLE_STATUS_TIMEOUT_MS,
  BLE_WIFI_CONNECT_PACKET,
  BLE_WIFI_CONNECT_TIMEOUT_MS,
  BLE_WIFI_SCAN_BEGIN,
  BLE_WIFI_SCAN_CHARACTERISTIC_UUID,
  BLE_WIFI_SCAN_DATA,
  BLE_WIFI_SCAN_END,
  BLE_WIFI_SCAN_ERROR,
  BLE_WIFI_SCAN_PACKET,
  BLE_WIFI_SCAN_TIMEOUT_MS,
  resolveBleChunkSizeForMtu
} from '@/constants/ble'
import {
  buildDeviceActivationPackets,
  buildHighlightPacket,
  buildImagePackets,
  buildWifiConnectPacket,
  decodeUtf8,
  parseWifiScanResult
} from '@/utils/ble-packet'
import {
  BEAD_SCREEN_BLE_V1_4,
  BLE_V1_4_COMMAND,
  buildBleV14DiyImageFrames,
  buildBleV14HighlightFrames,
  buildBleV14SyncTimeFrame,
  decodeBleV14DeviceInfo,
  decodeBleV14Frame,
  isBleV14DeviceName,
  sendBleV14Frames,
  type BleV14DeviceInfo
} from '@/protocols/bead-screen-ble-v1_4'
import {
  getV14HighlightPoints,
  normalizeRgb565Color,
  rgb565PayloadToRgb888
} from './v14-image'
import type { BleAdapter, BleDeviceStatus, BleKnownDevice } from './types'

interface Waiter<T> {
  timer: ReturnType<typeof setTimeout>
  resolve: (value: T) => void
  reject: (error: Error) => void
}

interface WifiResponse {
  code: number
  status: string
  payload: string
}

interface V14Waiter extends Waiter<Uint8Array> {
  type: number
}

const NATIVE_SCAN_TIMEOUT_MS = 5000

let currentDevice: NativeBleDevice | null = null
let connectionReady = false
let currentChunkSize = BLE_CHUNK_SIZE
let currentV14ChunkSize = 244
let v14DeviceInfo: BleV14DeviceInfo | null = null
let v14LastImage: Uint8Array | null = null
const knownDevices = new Map<string, NativeBleDevice>()
const ackWaiters: Array<Waiter<number>> = []
const statusWaiters: Array<Waiter<BleDeviceStatus>> = []
const activationWaiters: Array<Waiter<number>> = []
const wifiWaiters: Array<Waiter<WifiResponse>> = []
const v14Waiters: V14Waiter[] = []
const wifiResponses: WifiResponse[] = []

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function normalizeDeviceUuid(name?: string | null) {
  const match = name?.match(/(?:BeadCraft-|PDD_)([0-9A-F]{6,12})/i)
  return match?.[1]?.toUpperCase() || ''
}

function isTargetDevice(device?: NativeBleDevice | null) {
  return !!device?.name && (
    device.name.startsWith('BeadCraft-') || isBleV14DeviceName(device.name)
  )
}

function isCurrentV14Device() {
  return isBleV14DeviceName(currentDevice?.name)
}

function serializeDevice(device: NativeBleDevice): BleKnownDevice {
  return {
    key: device.address,
    name: device.name,
    uuid: normalizeDeviceUuid(device.name)
  }
}

function createWaiter<T>(
  waiters: Array<Waiter<T>>,
  timeoutMs: number,
  timeoutMessage: string
) {
  return new Promise<T>((resolve, reject) => {
    const waiter: Waiter<T> = {
      timer: setTimeout(() => {
        const index = waiters.indexOf(waiter)
        if (index >= 0) {
          waiters.splice(index, 1)
        }
        reject(new Error(timeoutMessage))
      }, timeoutMs),
      resolve,
      reject
    }
    waiters.push(waiter)
  })
}

function resolveNext<T>(waiters: Array<Waiter<T>>, value: T) {
  const waiter = waiters.shift()
  if (!waiter) {
    return false
  }
  clearTimeout(waiter.timer)
  waiter.resolve(value)
  return true
}

function rejectLatest<T>(waiters: Array<Waiter<T>>, error: Error) {
  const waiter = waiters.pop()
  if (!waiter) {
    return false
  }
  clearTimeout(waiter.timer)
  waiter.reject(error)
  return true
}

function rejectAll<T>(waiters: Array<Waiter<T>>, error: Error) {
  while (waiters.length) {
    const waiter = waiters.shift()
    if (waiter) {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
  }
}

function resetConnectionState() {
  connectionReady = false
  currentChunkSize = BLE_CHUNK_SIZE
  currentV14ChunkSize = 244
  v14DeviceInfo = null
  v14LastImage = null
  currentDevice = null
  wifiResponses.length = 0
  const error = new Error('Bluetooth disconnected')
  rejectAll(ackWaiters, error)
  rejectAll(statusWaiters, error)
  rejectAll(activationWaiters, error)
  rejectAll(wifiWaiters, error)
  rejectAll(v14Waiters, error)
}

function activationError(status: number) {
  return new Error(
    ({
      0x00: '设备仍处于锁定状态',
      0x02: '设备授权令牌格式错误',
      0x03: '授权令牌不属于当前设备',
      0x04: '设备授权签名校验失败',
      0x05: '设备授权序列已使用或已被更新令牌取代',
      0x06: '设备尚未烧录授权密钥',
      0x07: '设备授权令牌已超过绝对有效期'
    } as Record<number, string>)[status] || `设备解锁失败（状态 ${status}）`
  )
}

function handleImageNotification(data: number[]) {
  const bytes = Uint8Array.from(data)
  if (!bytes.length) {
    return
  }

  const code = bytes[0]
  if (code === BLE_ACTIVATION_NOTIFICATION && bytes.length >= 2) {
    resolveNext(activationWaiters, bytes[1])
    return
  }
  if (code === BLE_STATUS_NOTIFICATION && bytes.length >= 2) {
    resolveNext(statusWaiters, { brightness: bytes[1] })
    return
  }
  if (code === 0x06 || code === 0x15) {
    resolveNext(ackWaiters, code)
  }
}

function handleV14Notification(data: number[]) {
  const bytes = Uint8Array.from(data)
  let type: number
  try {
    type = decodeBleV14Frame(bytes).type
  } catch (error) {
    console.warn('忽略无法解析的 PDD V1.4 通知:', error)
    return
  }
  const index = v14Waiters.findIndex((waiter) => waiter.type === type)
  if (index < 0) {
    return
  }
  const [waiter] = v14Waiters.splice(index, 1)
  clearTimeout(waiter.timer)
  waiter.resolve(bytes)
}

function waitForV14Frame(type: number, timeoutMs = BLE_ACK_TIMEOUT_MS) {
  return new Promise<Uint8Array>((resolve, reject) => {
    const waiter: V14Waiter = {
      type,
      timer: setTimeout(() => {
        const index = v14Waiters.indexOf(waiter)
        if (index >= 0) {
          v14Waiters.splice(index, 1)
        }
        reject(
          new Error(
            `等待 PDD V1.4 响应 0x${type.toString(16).padStart(4, '0')} 超时`
          )
        )
      }, timeoutMs),
      resolve,
      reject
    }
    v14Waiters.push(waiter)
  })
}

function toWifiResponse(data: number[]): WifiResponse | null {
  const bytes = Uint8Array.from(data)
  if (!bytes.length) {
    return null
  }
  return {
    code: bytes[0],
    status: String.fromCharCode(bytes[0]),
    payload: decodeUtf8(bytes.slice(1))
  }
}

function handleWifiNotification(data: number[]) {
  const response = toWifiResponse(data)
  if (!response) {
    return
  }
  if (!resolveNext(wifiWaiters, response)) {
    wifiResponses.push(response)
  }
}

function waitForWifiResponse(timeoutMs: number) {
  const queued = wifiResponses.shift()
  if (queued) {
    return Promise.resolve(queued)
  }
  return createWaiter(wifiWaiters, timeoutMs, 'WiFi response timeout')
}

function knownDeviceList() {
  return Array.from(knownDevices.values())
    .filter(isTargetDevice)
    .sort((left, right) => (right.rssi ?? -999) - (left.rssi ?? -999))
}

async function scanDevices() {
  if (!(await checkPermissions(true))) {
    throw new Error('未获得附近设备权限，无法扫描蓝牙设备')
  }
  if ((await getAdapterState()) === 'Off') {
    throw new Error('系统蓝牙未开启')
  }

  await startScan((devices) => {
    devices.filter(isTargetDevice).forEach((device) => {
      knownDevices.set(device.address, device)
    })
  }, NATIVE_SCAN_TIMEOUT_MS)

  return knownDeviceList()
}

async function connectDevice(device: NativeBleDevice) {
  if (
    connectionReady &&
    currentDevice?.address === device.address
  ) {
    return currentDevice
  }

  if (currentDevice) {
    await disconnect().catch(() => undefined)
    resetConnectionState()
  }

  await setAndroidMtu(BLE_PREFERRED_MTU)
  await setWriteBehavior(BLE_ACK_TIMEOUT_MS, false)
  await connect(device.address, resetConnectionState)
  currentDevice = device

  try {
    const mtu = await getMtu()
    currentChunkSize = resolveBleChunkSizeForMtu(mtu)
    currentV14ChunkSize = Math.max(20, Math.min(mtu - 3, 509))
    if (isCurrentV14Device()) {
      await subscribe(
        BEAD_SCREEN_BLE_V1_4.notifyUuid,
        BEAD_SCREEN_BLE_V1_4.serviceUuid,
        handleV14Notification
      )
    } else {
      await subscribe(
        BLE_CHARACTERISTIC_UUID,
        BLE_SERVICE_UUID,
        handleImageNotification
      )
      await subscribe(
        BLE_WIFI_SCAN_CHARACTERISTIC_UUID,
        BLE_SERVICE_UUID,
        handleWifiNotification
      )
    }
    connectionReady = true
    knownDevices.set(device.address, device)
    return device
  } catch (error) {
    await disconnect().catch(() => undefined)
    resetConnectionState()
    throw error
  }
}

async function findDevice(uuid?: string, forceScan = false) {
  const normalizedUuid = uuid?.trim().toUpperCase()
  let devices = knownDeviceList()
  let matched = normalizedUuid
    ? devices.find((device) => normalizeDeviceUuid(device.name) === normalizedUuid)
    : devices[0]

  if (!matched || forceScan) {
    devices = await scanDevices()
    matched = normalizedUuid
      ? devices.find((device) => normalizeDeviceUuid(device.name) === normalizedUuid)
      : devices[0]
  }

  if (!matched) {
    throw new Error(
      normalizedUuid
        ? `未发现编号为 ${normalizedUuid} 的拼豆板设备`
        : '未发现拼豆板蓝牙设备'
    )
  }
  return matched
}

async function ensureConnection(uuid?: string) {
  const normalizedUuid = uuid?.trim().toUpperCase()
  if (
    connectionReady &&
    currentDevice &&
    (!normalizedUuid || normalizeDeviceUuid(currentDevice.name) === normalizedUuid)
  ) {
    return currentDevice
  }
  return await connectDevice(await findDevice(normalizedUuid))
}

async function writePacket(
  characteristic: string,
  bytes: Uint8Array,
  service = BLE_SERVICE_UUID
) {
  await send(
    characteristic,
    Array.from(bytes),
    'withoutResponse',
    service
  )
  if (BLE_PACKET_GAP_MS > 0) {
    await wait(BLE_PACKET_GAP_MS)
  }
}

async function writeV14Frame(frame: Uint8Array) {
  await sendBleV14Frames(
    [frame],
    (chunk) => writePacket(
      BEAD_SCREEN_BLE_V1_4.writeUuid,
      chunk,
      BEAD_SCREEN_BLE_V1_4.serviceUuid
    ),
    { maxWriteBytes: currentV14ChunkSize }
  )
}

async function requestV14Frame(frame: Uint8Array, expectedType: number) {
  const response = waitForV14Frame(expectedType)
  try {
    await writeV14Frame(frame)
  } catch (error) {
    rejectLatest(
      v14Waiters,
      error instanceof Error ? error : new Error('PDD V1.4 指令发送失败')
    )
  }
  return await response
}

async function readV14DeviceInfo() {
  const now = new Date()
  const response = await requestV14Frame(
    buildBleV14SyncTimeFrame({
      hour: now.getHours(),
      minute: now.getMinutes(),
      second: now.getSeconds()
    }),
    BLE_V1_4_COMMAND.DEVICE_INFO_AND_TIME
  )
  v14DeviceInfo = decodeBleV14DeviceInfo(response)
  return v14DeviceInfo
}

export const tauriBleAdapter: BleAdapter = {
  async scanNearbyDevices() {
    return (await scanDevices()).map(serializeDevice)
  },

  async getAuthorizedDevices() {
    const devices = knownDeviceList()
    return (devices.length ? devices : await scanDevices()).map(serializeDevice)
  },

  async connectTargetDevice(uuid) {
    const device = await ensureConnection(uuid)
    if (isCurrentV14Device()) {
      await readV14DeviceInfo()
    }
    return normalizeDeviceUuid(device.name) || null
  },

  async addTargetDevice() {
    const device = await connectDevice(await findDevice(undefined, true))
    if (isCurrentV14Device()) {
      await readV14DeviceInfo()
    }
    return normalizeDeviceUuid(device.name) || null
  },

  async connectKnownDevice(deviceKey) {
    if (!deviceKey) {
      throw new Error('缺少蓝牙设备标识')
    }
    let device = knownDevices.get(deviceKey)
    if (!device) {
      await scanDevices()
      device = knownDevices.get(deviceKey)
    }
    if (!device) {
      throw new Error('未找到已扫描的拼豆板设备')
    }
    const connected = await connectDevice(device)
    if (isCurrentV14Device()) {
      await readV14DeviceInfo()
    }
    return normalizeDeviceUuid(connected.name) || null
  },

  async readStatus() {
    await ensureConnection()
    if (isCurrentV14Device()) {
      const info = await readV14DeviceInfo()
      return {
        brightness: info.brightness,
        boardWidth: info.width,
        boardHeight: info.height,
        rotationDegrees: info.rotation * 90,
        passwordFlag: info.passwordFlag
      }
    }
    const statusPromise = createWaiter(
      statusWaiters,
      BLE_STATUS_TIMEOUT_MS,
      'BLE status timeout'
    )
    try {
      await writePacket(
        BLE_CHARACTERISTIC_UUID,
        Uint8Array.from([BLE_GET_STATUS_PACKET])
      )
    } catch (error) {
      rejectLatest(
        statusWaiters,
        error instanceof Error ? error : new Error('BLE status request failed')
      )
    }
    return await statusPromise
  },

  async activateDevice(accessToken) {
    await ensureConnection()
    if (isCurrentV14Device()) {
      const info = v14DeviceInfo ?? await readV14DeviceInfo()
      if (info.passwordFlag === 0) {
        return
      }
      throw new Error('PDD V1.4 协议未定义支付授权解锁指令，已阻止发送旧版解锁包')
    }
    const activationPromise = createWaiter(
      activationWaiters,
      BLE_ACTIVATION_TIMEOUT_MS,
      '设备解锁响应超时'
    )
    try {
      for (const packet of buildDeviceActivationPackets(accessToken)) {
        await writePacket(BLE_CHARACTERISTIC_UUID, packet)
      }
    } catch (error) {
      rejectLatest(
        activationWaiters,
        error instanceof Error ? error : new Error('设备授权包发送失败')
      )
    }
    const status = await activationPromise
    if (status !== BLE_ACTIVATION_UNLOCKED) {
      throw activationError(status)
    }
  },

  async sendImage(payload) {
    await ensureConnection()
    if (isCurrentV14Device()) {
      const info = v14DeviceInfo ?? await readV14DeviceInfo()
      const image = rgb565PayloadToRgb888(payload, info.width, info.height)
      const frames = buildBleV14DiyImageFrames(image)
      for (let index = 0; index < frames.length; index += 1) {
        const response = await requestV14Frame(frames[index], BLE_V1_4_COMMAND.DIY_IMAGE)
        const status = decodeBleV14Frame(response).payload[0]
        const expectedStatus = index === frames.length - 1 ? 1 : 3
        if (status !== expectedStatus) {
          throw new Error(
            `PDD 图案第 ${index + 1}/${frames.length} 帧被拒绝（状态 ${status ?? '空'}）`
          )
        }
      }
      v14LastImage = image
      return
    }
    const ackPromise = createWaiter(
      ackWaiters,
      BLE_ACK_TIMEOUT_MS,
      'BLE ack timeout'
    )
    try {
      for (const packet of buildImagePackets(payload, currentChunkSize)) {
        await writePacket(BLE_CHARACTERISTIC_UUID, packet)
      }
    } catch (error) {
      rejectLatest(
        ackWaiters,
        error instanceof Error ? error : new Error('BLE image send failed')
      )
    }
    if ((await ackPromise) !== 0x06) {
      throw new Error('BLE image send was rejected by the device')
    }
  },

  async sendHighlight(colors) {
    await ensureConnection()
    if (isCurrentV14Device()) {
      const info = v14DeviceInfo ?? await readV14DeviceInfo()
      if (!v14LastImage && colors.length > 0) {
        throw new Error('请先把当前图案发送到拼豆板，再使用颜色高亮')
      }
      const frames = colors.length === 0
        ? buildBleV14HighlightFrames({ rgb: [0, 0, 0], points: [] })
        : colors.flatMap((color) => {
            const normalizedColor = normalizeRgb565Color(color)
            return buildBleV14HighlightFrames({
              rgb: normalizedColor,
              points: getV14HighlightPoints(
                v14LastImage as Uint8Array,
                info.width,
                info.height,
                normalizedColor
              )
            })
          })
      await sendBleV14Frames(
        frames,
        (chunk) => writePacket(
          BEAD_SCREEN_BLE_V1_4.writeUuid,
          chunk,
          BEAD_SCREEN_BLE_V1_4.serviceUuid
        ),
        {
          maxWriteBytes: currentV14ChunkSize,
          frameGapMs: BEAD_SCREEN_BLE_V1_4.highlightFrameGapMs
        }
      )
      return
    }
    await writePacket(BLE_CHARACTERISTIC_UUID, buildHighlightPacket(colors))
  },

  async scanWifiNetworks() {
    await ensureConnection()
    if (isCurrentV14Device()) {
      throw new Error('PDD V1.4 协议未提供 WiFi 扫描与配网指令')
    }
    wifiResponses.length = 0
    await writePacket(
      BLE_CHARACTERISTIC_UUID,
      Uint8Array.from([BLE_WIFI_SCAN_PACKET])
    )

    const deadline = Date.now() + BLE_WIFI_SCAN_TIMEOUT_MS
    let buffer = ''
    while (Date.now() < deadline) {
      const response = await waitForWifiResponse(deadline - Date.now())
      if (response.code === BLE_WIFI_SCAN_BEGIN) {
        buffer = ''
      } else if (response.code === BLE_WIFI_SCAN_DATA) {
        buffer += response.payload
      } else if (response.code === BLE_WIFI_SCAN_END) {
        return parseWifiScanResult(buffer)
      } else if (response.status === 'D') {
        return parseWifiScanResult(response.payload)
      }
      if (response.code === BLE_WIFI_SCAN_ERROR || response.status === 'E') {
        throw new Error(response.payload || 'ESP32 WiFi scan failed')
      }
    }
    throw new Error('WiFi scan timeout')
  },

  async connectWifiNetwork({ ssid, password }) {
    await ensureConnection()
    if (isCurrentV14Device()) {
      throw new Error('PDD V1.4 协议未提供 WiFi 扫描与配网指令')
    }
    if (!ssid.trim()) {
      throw new Error('请选择要连接的 WiFi 热点')
    }

    const packet = buildWifiConnectPacket(ssid.trim(), password ?? '')
    if (packet[0] !== BLE_WIFI_CONNECT_PACKET) {
      throw new Error('WiFi 配网数据包构造失败')
    }
    wifiResponses.length = 0
    await writePacket(BLE_CHARACTERISTIC_UUID, packet)

    const deadline = Date.now() + BLE_WIFI_CONNECT_TIMEOUT_MS
    while (Date.now() < deadline) {
      const response = await waitForWifiResponse(deadline - Date.now())
      if (response.status === 'C') {
        return response.payload.trim()
      }
      if (response.status === 'F' || response.code === BLE_WIFI_SCAN_ERROR) {
        throw new Error(response.payload || 'ESP32 WiFi connect failed')
      }
    }
    throw new Error('WiFi connect timeout')
  }
}
