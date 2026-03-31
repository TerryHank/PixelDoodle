import Taro from '@tarojs/taro'
import {
  BLE_CHARACTERISTIC_UUID,
  BLE_CHUNK_SIZE,
  BLE_SERVICE_UUID,
  BLE_WIFI_SCAN_CHARACTERISTIC_UUID,
  BLE_WIFI_SCAN_PACKET
} from '@/constants/ble'
import { buildHighlightPacket, buildImagePackets } from '@/utils/ble-packet'
import type { BleAdapter } from './types'

let currentDeviceId = ''

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

async function discoverTargetDevice(uuid?: string) {
  await Taro.openBluetoothAdapter()
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

export const weappBleAdapter: BleAdapter = {
  async connectTargetDevice(uuid) {
    const targetDevice = await discoverTargetDevice(uuid)
    currentDeviceId = targetDevice.deviceId

    await Taro.createBLEConnection({
      deviceId: currentDeviceId
    })
    await Taro.getBLEDeviceServices({
      deviceId: currentDeviceId
    })
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
    const deviceId = ensureConnectedDevice()

    await Taro.writeBLECharacteristicValue({
      deviceId,
      serviceId: BLE_SERVICE_UUID,
      characteristicId: BLE_CHARACTERISTIC_UUID,
      value: toArrayBuffer(Uint8Array.from([BLE_WIFI_SCAN_PACKET]))
    })

    return []
  }
}
