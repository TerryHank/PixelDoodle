import { describe, expect, it } from 'vitest'
import {
  buildDeviceActivationPackets,
  buildHighlightPacket,
  parseWifiScanResult,
  splitBlePayload
} from '../ble-packet'

describe('splitBlePayload', () => {
  it('splits image payload into 19-byte chunks', () => {
    const chunks = splitBlePayload(new Uint8Array(40), 19)

    expect(chunks).toHaveLength(3)
    expect(chunks[0]).toHaveLength(19)
    expect(chunks[1]).toHaveLength(19)
    expect(chunks[2]).toHaveLength(2)
  })

  it('builds the highlight packet in rgb565 format', () => {
    expect(Array.from(buildHighlightPacket([[255, 0, 0]]))).toEqual([0x04, 0x01, 0x00, 0xf8])
  })

  it('builds the fixed 51-byte v2 signed device activation handshake', () => {
    const packets = buildDeviceActivationPackets(
      'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEy'
    )

    expect(packets.map((packet) => Array.from(packet))).toEqual([
      [0x0b, 51, 0],
      [0x0c, ...Array.from({ length: 19 }, (_, index) => index)],
      [0x0c, ...Array.from({ length: 19 }, (_, index) => index + 19)],
      [0x0c, ...Array.from({ length: 13 }, (_, index) => index + 38)],
      [0x0d]
    ])
  })

  it('parses wifi scan payload into network list', () => {
    const result = parseWifiScanResult('Office\t-52\t1\nGuest\t-70\t0')

    expect(result[0]).toMatchObject({
      ssid: 'Office',
      rssi: -52,
      secure: true
    })
    expect(result[1]).toMatchObject({
      ssid: 'Guest',
      secure: false
    })
  })

  it('parses wifi scan payload from json text', () => {
    const result = parseWifiScanResult('{"ssid":"Office","rssi":-52,"secured":true}')

    expect(result[0]).toMatchObject({
      ssid: 'Office',
      rssi: -52,
      secure: true
    })
  })
})
