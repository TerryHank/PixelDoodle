import { describe, expect, it, vi } from 'vitest'

import {
  BEAD_SCREEN_BLE_V1_4,
  BLE_V1_4_COMMAND,
  buildBleV14BoardModeFrame,
  buildBleV14BrightnessFrame,
  buildBleV14ClearAllFrame,
  buildBleV14DiyImageFrames,
  buildBleV14GetVersionFrame,
  buildBleV14HighlightFrames,
  buildBleV14RealtimeBoardFrame,
  buildBleV14RotationFrame,
  buildBleV14SavedImageFrames,
  buildBleV14ScreenPowerFrame,
  buildBleV14SyncTimeFrame,
  crc32Ieee,
  decodeBleV14Ack,
  decodeBleV14DeviceInfo,
  decodeBleV14Frame,
  decodeBleV14Version,
  encodeBleV14Frame,
  isBleV14DeviceName,
  parseBleV14Advertisement,
  readBleV14ImageMetadata,
  sendBleV14Frames,
  splitBleV14WriteChunks
} from './bead-screen-ble-v1_4'

describe('拼豆屏 BLE V1.4 上位机协议', () => {
  it('声明 PDF 中的 GATT UUID 和设备名前缀', () => {
    expect(BEAD_SCREEN_BLE_V1_4).toMatchObject({
      deviceNamePrefix: 'PDD_',
      serviceUuid16: 0x00fa,
      writeUuid16: 0xfa02,
      notifyUuid16: 0xfa03
    })
    expect(isBleV14DeviceName('PDD_A1B2C3')).toBe(true)
    expect(isBleV14DeviceName('BeadCraft-A1B2C3')).toBe(false)
  })

  it('解析广播厂商数据和设备尺寸', () => {
    expect(
      parseBleV14Advertisement(
        Uint8Array.from([0x54, 0x52, 0x00, 0x83, 0x11, 0x22, 0x33, 0x00, 2])
      )
    ).toEqual({
      cid1: 0x11,
      cid2: 0x22,
      pid: 0x33,
      deviceType: 2,
      width: 78,
      height: 78
    })
    expect(parseBleV14Advertisement(Uint8Array.from([1, 2, 3]))).toBeNull()
  })

  it('按小端编码和解码长度、类型', () => {
    const bytes = encodeBleV14Frame(0x8004, Uint8Array.from([80]))
    expect(Array.from(bytes)).toEqual([0x05, 0x00, 0x04, 0x80, 80])
    expect(decodeBleV14Frame(bytes)).toMatchObject({
      length: 5,
      type: 0x8004
    })
    expect(() => decodeBleV14Frame(Uint8Array.from([5, 0, 4, 128]))).toThrow(
      '帧长度不匹配'
    )
  })

  it('构造全部短控制指令', () => {
    expect(Array.from(buildBleV14ClearAllFrame())).toEqual([4, 0, 3, 128])
    expect(Array.from(buildBleV14BrightnessFrame(100))).toEqual([5, 0, 4, 128, 100])
    expect(Array.from(buildBleV14GetVersionFrame())).toEqual([4, 0, 5, 128])
    expect(Array.from(buildBleV14RotationFrame(3))).toEqual([5, 0, 6, 128, 3])
    expect(Array.from(buildBleV14BoardModeFrame(2))).toEqual([5, 0, 4, 1, 2])
    expect(Array.from(buildBleV14ScreenPowerFrame(true))).toEqual([5, 0, 7, 1, 1])
    expect(Array.from(buildBleV14SyncTimeFrame({ hour: 9, minute: 8, second: 7 }))).toEqual([
      7, 0, 1, 128, 9, 8, 7
    ])
    expect(() => buildBleV14BrightnessFrame(9)).toThrow('亮度')
  })

  it('解析硬件信息、版本和通用状态响应', () => {
    expect(
      decodeBleV14DeviceInfo(
        encodeBleV14Frame(0x8001, Uint8Array.from([3, 1, 0, 88]))
      )
    ).toEqual({
      deviceType: 3,
      width: 104,
      height: 104,
      rotation: 1,
      passwordFlag: 0,
      brightness: 88
    })
    expect(
      decodeBleV14Version(
        encodeBleV14Frame(0x8005, Uint8Array.from([1, 4, 7, 9]))
      )
    ).toEqual({ major: 1, minor: 4, cid: 7, pid: 9, version: '1.4' })
    expect(
      decodeBleV14Ack(encodeBleV14Frame(0x0107, Uint8Array.from([1])), 0x0107)
    ).toBe(1)
  })

  it('构造实时画笔和整体移动指令', () => {
    const paint = buildBleV14RealtimeBoardFrame({
      effect: 0,
      rgb: [255, 16, 0],
      points: [
        { column: 2, row: 3 },
        { column: 4, row: 5 }
      ]
    })
    expect(Array.from(paint)).toEqual([
      12, 0, 5, 1, 0, 255, 16, 0, 2, 3, 4, 5
    ])
    expect(
      Array.from(
        buildBleV14RealtimeBoardFrame({
          effect: 3,
          movement: { up: 1, down: 2, left: 3, right: 4 }
        })
      )
    ).toEqual([9, 0, 5, 1, 3, 1, 2, 3, 4])
  })

  it('按 4096 字节数据上限构造临时图片首包和续包', () => {
    const frames = buildBleV14DiyImageFrames(new Uint8Array(5000).fill(0xaa))
    expect(frames).toHaveLength(2)
    expect(readBleV14ImageMetadata(frames[0])).toEqual({
      type: BLE_V1_4_COMMAND.DIY_IMAGE,
      packetKind: 0,
      totalImageBytes: 5000
    })
    expect(readBleV14ImageMetadata(frames[1]).packetKind).toBe(2)
    expect(decodeBleV14Frame(frames[0]).payload.slice(5)).toHaveLength(4096)
    expect(decodeBleV14Frame(frames[1]).payload.slice(5)).toHaveLength(904)
    expect(() => buildBleV14DiyImageFrames(new Uint8Array(1), 4097)).toThrow(
      '图片单帧数据上限'
    )
  })

  it('构造带 CRC32、预留字节和列表序号的保存图片帧', () => {
    const imageData = Uint8Array.from([1, 2, 3, 4])
    expect(crc32Ieee(imageData)).toBe(0xb63cfbcd)
    const [frame] = buildBleV14SavedImageFrames({ imageData, slot: 7 })
    const decoded = decodeBleV14Frame(frame)
    expect(decoded.type).toBe(BLE_V1_4_COMMAND.SAVE_IMAGE)
    expect(Array.from(decoded.payload.slice(0, 11))).toEqual([
      0,
      4, 0, 0, 0,
      0xcd, 0xfb, 0x3c, 0xb6,
      0,
      7
    ])
    expect(() => buildBleV14SavedImageFrames({ imageData, slot: 11 })).toThrow(
      '列表序号'
    )
  })

  it('分包高亮坐标并标记首包和续包', () => {
    const points = Array.from({ length: 2049 }, (_, index) => ({
      column: index % 104,
      row: Math.floor(index / 104)
    }))
    const frames = buildBleV14HighlightFrames({ rgb: [1, 2, 3], points })
    expect(frames).toHaveLength(2)
    expect(decodeBleV14Frame(frames[0]).payload[0]).toBe(0)
    expect(decodeBleV14Frame(frames[1]).payload[0]).toBe(2)
    expect(() =>
      buildBleV14HighlightFrames({ rgb: [1, 2, 3], points, maxCoordinateBytes: 4098 })
    ).toThrow('2 到 4096')
  })

  it('按可写字节数拆分 BLE 写入并支持帧间隔', async () => {
    const frame = Uint8Array.from({ length: 10 }, (_, index) => index)
    expect(splitBleV14WriteChunks(frame, 4).map((chunk) => chunk.length)).toEqual([
      4, 4, 2
    ])

    const write = vi.fn().mockResolvedValue(undefined)
    const wait = vi.fn().mockResolvedValue(undefined)
    await sendBleV14Frames([frame, frame], write, {
      maxWriteBytes: 6,
      frameGapMs: 50,
      wait
    })
    expect(write).toHaveBeenCalledTimes(4)
    expect(wait).toHaveBeenCalledOnce()
    expect(wait).toHaveBeenCalledWith(50)
  })
})
