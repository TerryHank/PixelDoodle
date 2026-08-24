export const BEAD_SCREEN_BLE_V1_4 = {
  version: '1.4',
  deviceNamePrefix: 'PDD_',
  serviceUuid16: 0x00fa,
  serviceUuid: '000000fa-0000-1000-8000-00805f9b34fb',
  writeUuid16: 0xfa02,
  writeUuid: '0000fa02-0000-1000-8000-00805f9b34fb',
  notifyUuid16: 0xfa03,
  notifyUuid: '0000fa03-0000-1000-8000-00805f9b34fb',
  maxDataBytesPerFrame: 4096,
  documentedWriteChunkBytes: 512,
  highlightFrameGapMs: 50
} as const

export const BLE_V1_4_COMMAND = {
  DIY_IMAGE: 0x0000,
  SAVE_IMAGE: 0x0002,
  BOARD_MODE: 0x0104,
  REALTIME_BOARD: 0x0105,
  SCREEN_POWER: 0x0107,
  HIGHLIGHT_BOARD: 0x0109,
  DEVICE_INFO_AND_TIME: 0x8001,
  CLEAR_ALL: 0x8003,
  SET_BRIGHTNESS: 0x8004,
  GET_VERSION: 0x8005,
  SET_ROTATION: 0x8006
} as const

export type BleV14Command =
  (typeof BLE_V1_4_COMMAND)[keyof typeof BLE_V1_4_COMMAND]

export type BleV14DeviceType = 0 | 1 | 2 | 3
export type BleV14Rotation = 0 | 1 | 2 | 3
export type BleV14BoardMode = 0 | 1 | 2 | 3
export type BleV14RealtimeEffect = 0 | 1 | 2 | 3 | 4
export type BleV14TransferPacketKind = 0 | 2
export type Rgb888 = readonly [number, number, number]

export interface BleV14Frame {
  length: number
  type: number
  payload: Uint8Array
}

export interface BleV14Advertisement {
  cid1: number
  cid2: number
  pid: number
  deviceType: BleV14DeviceType
  width: number
  height: number
}

export interface BleV14Point {
  column: number
  row: number
}

export interface BleV14DeviceInfo {
  deviceType: BleV14DeviceType
  width: number
  height: number
  rotation: BleV14Rotation
  passwordFlag: number
  brightness: number
}

export interface BleV14VersionInfo {
  major: number
  minor: number
  cid: number
  pid: number
  version: string
}

const DEVICE_DIMENSIONS: Record<
  BleV14DeviceType,
  { width: number; height: number }
> = {
  0: { width: 32, height: 32 },
  1: { width: 52, height: 52 },
  2: { width: 78, height: 78 },
  3: { width: 104, height: 104 }
}

function assertIntegerInRange(
  value: number,
  minimum: number,
  maximum: number,
  label: string
) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} 必须是 ${minimum} 到 ${maximum} 的整数`)
  }
}

function concatBytes(parts: readonly Uint8Array[]) {
  const output = new Uint8Array(
    parts.reduce((total, part) => total + part.length, 0)
  )
  let offset = 0
  parts.forEach((part) => {
    output.set(part, offset)
    offset += part.length
  })
  return output
}

function uint32Le(value: number) {
  assertIntegerInRange(value, 0, 0xffffffff, '32 位字段')
  return Uint8Array.from([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff
  ])
}

function readUint32Le(bytes: Uint8Array, offset: number) {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0
}

function assertRgb(rgb: Rgb888) {
  rgb.forEach((value, index) => {
    assertIntegerInRange(value, 0, 255, `RGB[${index}]`)
  })
}

function encodePoints(points: readonly BleV14Point[]) {
  const bytes = new Uint8Array(points.length * 2)
  points.forEach((point, index) => {
    assertIntegerInRange(point.column, 0, 255, '列序号')
    assertIntegerInRange(point.row, 0, 255, '行序号')
    bytes[index * 2] = point.column
    bytes[index * 2 + 1] = point.row
  })
  return bytes
}

function splitData(payload: Uint8Array, maxDataBytes: number) {
  assertIntegerInRange(maxDataBytes, 1, 0xffff, '单帧数据上限')
  if (payload.length === 0) {
    return [new Uint8Array()]
  }

  const chunks: Uint8Array[] = []
  for (let offset = 0; offset < payload.length; offset += maxDataBytes) {
    chunks.push(payload.slice(offset, offset + maxDataBytes))
  }
  return chunks
}

function assertProtocolDataLimit(value: number, label: string) {
  assertIntegerInRange(
    value,
    1,
    BEAD_SCREEN_BLE_V1_4.maxDataBytesPerFrame,
    label
  )
}

function expectFrameType(frame: BleV14Frame, expectedType: number) {
  if (frame.type !== expectedType) {
    throw new Error(
      `响应类型不匹配：期望 0x${expectedType.toString(16).padStart(4, '0')}，收到 0x${frame.type.toString(16).padStart(4, '0')}`
    )
  }
}

export function getBleV14DeviceDimensions(deviceType: number) {
  assertIntegerInRange(deviceType, 0, 3, '设备类型')
  return DEVICE_DIMENSIONS[deviceType as BleV14DeviceType]
}

export function isBleV14DeviceName(name?: string | null) {
  return /^PDD_[0-9A-F]{6,12}$/i.test(name?.trim() ?? '')
}

export function parseBleV14Advertisement(
  manufacturerData: Uint8Array
): BleV14Advertisement | null {
  if (
    manufacturerData.length < 9 ||
    manufacturerData[0] !== 0x54 ||
    manufacturerData[1] !== 0x52 ||
    manufacturerData[2] !== 0x00 ||
    manufacturerData[3] !== 0x83 ||
    manufacturerData[7] !== 0x00
  ) {
    return null
  }

  const rawDeviceType = manufacturerData[8]
  if (rawDeviceType > 3) {
    return null
  }
  const deviceType = rawDeviceType as BleV14DeviceType
  const dimensions = DEVICE_DIMENSIONS[deviceType]
  return {
    cid1: manufacturerData[4],
    cid2: manufacturerData[5],
    pid: manufacturerData[6],
    deviceType,
    ...dimensions
  }
}

export function encodeBleV14Frame(type: number, payload = new Uint8Array()) {
  assertIntegerInRange(type, 0, 0xffff, '指令类型')
  const length = 4 + payload.length
  assertIntegerInRange(length, 4, 0xffff, '帧长度')

  const frame = new Uint8Array(length)
  frame[0] = length & 0xff
  frame[1] = (length >> 8) & 0xff
  frame[2] = type & 0xff
  frame[3] = (type >> 8) & 0xff
  frame.set(payload, 4)
  return frame
}

export function decodeBleV14Frame(bytes: Uint8Array): BleV14Frame {
  if (bytes.length < 4) {
    throw new Error('BLE V1.4 数据帧至少需要 4 字节')
  }
  const length = bytes[0] | (bytes[1] << 8)
  if (length !== bytes.length) {
    throw new Error(`BLE V1.4 帧长度不匹配：声明 ${length}，实际 ${bytes.length}`)
  }
  return {
    length,
    type: bytes[2] | (bytes[3] << 8),
    payload: bytes.slice(4)
  }
}

export function buildBleV14SyncTimeFrame(input: {
  hour: number
  minute: number
  second: number
}) {
  assertIntegerInRange(input.hour, 0, 23, '小时')
  assertIntegerInRange(input.minute, 0, 59, '分钟')
  assertIntegerInRange(input.second, 0, 59, '秒')
  return encodeBleV14Frame(
    BLE_V1_4_COMMAND.DEVICE_INFO_AND_TIME,
    Uint8Array.from([input.hour, input.minute, input.second])
  )
}

export function buildBleV14ClearAllFrame() {
  return encodeBleV14Frame(BLE_V1_4_COMMAND.CLEAR_ALL)
}

export function buildBleV14BrightnessFrame(brightness: number) {
  assertIntegerInRange(brightness, 10, 100, '亮度')
  return encodeBleV14Frame(
    BLE_V1_4_COMMAND.SET_BRIGHTNESS,
    Uint8Array.from([brightness])
  )
}

export function buildBleV14GetVersionFrame() {
  return encodeBleV14Frame(BLE_V1_4_COMMAND.GET_VERSION)
}

export function buildBleV14RotationFrame(rotation: BleV14Rotation) {
  assertIntegerInRange(rotation, 0, 3, '旋转角度')
  return encodeBleV14Frame(
    BLE_V1_4_COMMAND.SET_ROTATION,
    Uint8Array.from([rotation])
  )
}

export function buildBleV14BoardModeFrame(mode: BleV14BoardMode) {
  assertIntegerInRange(mode, 0, 3, '画板模式')
  return encodeBleV14Frame(
    BLE_V1_4_COMMAND.BOARD_MODE,
    Uint8Array.from([mode])
  )
}

export function buildBleV14ScreenPowerFrame(enabled: boolean) {
  return encodeBleV14Frame(
    BLE_V1_4_COMMAND.SCREEN_POWER,
    Uint8Array.from([enabled ? 1 : 0])
  )
}

export function buildBleV14RealtimeBoardFrame(input: {
  effect: BleV14RealtimeEffect
  rgb?: Rgb888
  points?: readonly BleV14Point[]
  movement?: { up: number; down: number; left: number; right: number }
}) {
  assertIntegerInRange(input.effect, 0, 4, '实时画板效果')
  if (input.effect === 3) {
    if (!input.movement) {
      throw new Error('整体移动指令必须提供上、下、左、右四个移动量')
    }
    const movement = [
      input.movement.up,
      input.movement.down,
      input.movement.left,
      input.movement.right
    ]
    movement.forEach((value) => assertIntegerInRange(value, 0, 255, '移动量'))
    return encodeBleV14Frame(
      BLE_V1_4_COMMAND.REALTIME_BOARD,
      Uint8Array.from([input.effect, ...movement])
    )
  }

  if (!input.rgb) {
    throw new Error('非整体移动指令必须提供 RGB 颜色')
  }
  assertRgb(input.rgb)
  const pointBytes = encodePoints(input.points ?? [])
  if (pointBytes.length > BEAD_SCREEN_BLE_V1_4.maxDataBytesPerFrame) {
    throw new Error('实时画板坐标数据超过单帧 4096 字节限制')
  }
  return encodeBleV14Frame(
    BLE_V1_4_COMMAND.REALTIME_BOARD,
    concatBytes([Uint8Array.from([input.effect, ...input.rgb]), pointBytes])
  )
}

export function buildBleV14DiyImageFrames(
  imageData: Uint8Array,
  maxDataBytes = BEAD_SCREEN_BLE_V1_4.maxDataBytesPerFrame
) {
  assertProtocolDataLimit(maxDataBytes, '图片单帧数据上限')
  const totalBytes = uint32Le(imageData.length)
  return splitData(imageData, maxDataBytes).map((chunk, index) =>
    encodeBleV14Frame(
      BLE_V1_4_COMMAND.DIY_IMAGE,
      concatBytes([
        Uint8Array.from([index === 0 ? 0 : 2]),
        totalBytes,
        chunk
      ])
    )
  )
}

export function crc32Ieee(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

export function buildBleV14SavedImageFrames(input: {
  imageData: Uint8Array
  slot: number
  crc32?: number
  reserved?: number
  maxDataBytes?: number
}) {
  assertIntegerInRange(input.slot, 1, 10, '图片列表序号')
  const reserved = input.reserved ?? 0
  assertIntegerInRange(reserved, 0, 255, 'D 预留字段')
  const checksum = input.crc32 ?? crc32Ieee(input.imageData)
  assertIntegerInRange(checksum, 0, 0xffffffff, 'CRC32')
  const maxDataBytes =
    input.maxDataBytes ?? BEAD_SCREEN_BLE_V1_4.maxDataBytesPerFrame
  assertProtocolDataLimit(maxDataBytes, '保存图片单帧数据上限')
  const totalBytes = uint32Le(input.imageData.length)
  const crcBytes = uint32Le(checksum)

  return splitData(input.imageData, maxDataBytes).map((chunk, index) =>
    encodeBleV14Frame(
      BLE_V1_4_COMMAND.SAVE_IMAGE,
      concatBytes([
        Uint8Array.from([index === 0 ? 0 : 2]),
        totalBytes,
        crcBytes,
        Uint8Array.from([reserved, input.slot]),
        chunk
      ])
    )
  )
}

export function buildBleV14HighlightFrames(input: {
  rgb: Rgb888
  points: readonly BleV14Point[]
  maxCoordinateBytes?: number
}) {
  assertRgb(input.rgb)
  const maxCoordinateBytes =
    input.maxCoordinateBytes ?? BEAD_SCREEN_BLE_V1_4.maxDataBytesPerFrame
  if (
    maxCoordinateBytes < 2 ||
    maxCoordinateBytes > BEAD_SCREEN_BLE_V1_4.maxDataBytesPerFrame ||
    maxCoordinateBytes % 2 !== 0
  ) {
    throw new Error('高亮坐标分包大小必须是 2 到 4096 的偶数')
  }
  const maxPoints = maxCoordinateBytes / 2
  const groups = input.points.length
    ? Array.from(
        { length: Math.ceil(input.points.length / maxPoints) },
        (_, index) => input.points.slice(index * maxPoints, (index + 1) * maxPoints)
      )
    : [[]]

  return groups.map((points, index) =>
    encodeBleV14Frame(
      BLE_V1_4_COMMAND.HIGHLIGHT_BOARD,
      concatBytes([
        Uint8Array.from([index === 0 ? 0 : 2, ...input.rgb]),
        encodePoints(points)
      ])
    )
  )
}

export function splitBleV14WriteChunks(
  frame: Uint8Array,
  maxWriteBytes: number = BEAD_SCREEN_BLE_V1_4.documentedWriteChunkBytes
) {
  return splitData(frame, maxWriteBytes)
}

export async function sendBleV14Frames(
  frames: readonly Uint8Array[],
  write: (chunk: Uint8Array) => Promise<void>,
  options: {
    maxWriteBytes?: number
    frameGapMs?: number
    wait?: (milliseconds: number) => Promise<void>
  } = {}
) {
  const frameGapMs = options.frameGapMs ?? 0
  assertIntegerInRange(frameGapMs, 0, 60_000, '帧间隔')
  const wait =
    options.wait ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, milliseconds)
      }))

  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    const chunks = splitBleV14WriteChunks(
      frames[frameIndex],
      options.maxWriteBytes
    )
    for (const chunk of chunks) {
      await write(chunk)
    }
    if (frameGapMs > 0 && frameIndex < frames.length - 1) {
      await wait(frameGapMs)
    }
  }
}

export function decodeBleV14Ack(
  bytes: Uint8Array,
  expectedType: number
) {
  const frame = decodeBleV14Frame(bytes)
  expectFrameType(frame, expectedType)
  if (frame.payload.length < 1) {
    throw new Error('BLE V1.4 响应缺少状态字节')
  }
  return frame.payload[0]
}

export function decodeBleV14DeviceInfo(bytes: Uint8Array): BleV14DeviceInfo {
  const frame = decodeBleV14Frame(bytes)
  expectFrameType(frame, BLE_V1_4_COMMAND.DEVICE_INFO_AND_TIME)
  if (frame.payload.length < 4) {
    throw new Error('硬件信息响应至少需要 4 字节负载')
  }
  const rawDeviceType = frame.payload[0]
  const rawRotation = frame.payload[1]
  assertIntegerInRange(rawDeviceType, 0, 3, '设备类型')
  assertIntegerInRange(rawRotation, 0, 3, '显示角度')
  return {
    deviceType: rawDeviceType as BleV14DeviceType,
    ...DEVICE_DIMENSIONS[rawDeviceType as BleV14DeviceType],
    rotation: rawRotation as BleV14Rotation,
    passwordFlag: frame.payload[2],
    brightness: frame.payload[3]
  }
}

export function decodeBleV14Version(bytes: Uint8Array): BleV14VersionInfo {
  const frame = decodeBleV14Frame(bytes)
  expectFrameType(frame, BLE_V1_4_COMMAND.GET_VERSION)
  if (frame.payload.length < 4) {
    throw new Error('版本响应至少需要 4 字节负载')
  }
  return {
    major: frame.payload[0],
    minor: frame.payload[1],
    cid: frame.payload[2],
    pid: frame.payload[3],
    version: `${frame.payload[0]}.${frame.payload[1]}`
  }
}

export function readBleV14ImageMetadata(frameBytes: Uint8Array) {
  const frame = decodeBleV14Frame(frameBytes)
  if (
    frame.type !== BLE_V1_4_COMMAND.DIY_IMAGE &&
    frame.type !== BLE_V1_4_COMMAND.SAVE_IMAGE
  ) {
    throw new Error('当前帧不是图片传输帧')
  }
  if (frame.payload.length < 5) {
    throw new Error('图片传输帧缺少分包标志或总长度')
  }
  return {
    type: frame.type,
    packetKind: frame.payload[0] as BleV14TransferPacketKind,
    totalImageBytes: readUint32Le(frame.payload, 1)
  }
}
