import { describe, expect, it, vi } from 'vitest'

import { BLE_IMAGE_PAYLOAD_BYTES } from '@/constants/ble'

import { autoSendGeneratedPattern } from './ble-image-sync'

describe('ble image sync', () => {
  it('sends the generated pattern when bluetooth is connected and ready', async () => {
    const sendImage = vi.fn().mockResolvedValue(undefined)

    const didSend = await autoSendGeneratedPattern({
      bleConnectionStatus: 'connected',
      bleCharacteristicStatus: 'ready',
      isSending: false,
      ledSize: 16,
      pixelMatrix: [['A1']],
      palette: {
        A1: {
          code: 'A1',
          name: 'Black',
          name_zh: '黑色',
          hex: '#000000',
          rgb: [0, 0, 0]
        }
      },
      sendImage
    })

    expect(didSend).toBe(true)
    expect(sendImage).toHaveBeenCalledTimes(1)
    expect(sendImage.mock.calls[0][0]).toBeInstanceOf(Uint8Array)
    expect(sendImage.mock.calls[0][0]).toHaveLength(BLE_IMAGE_PAYLOAD_BYTES)
  })

  it('skips sending when bluetooth is not ready', async () => {
    const sendImage = vi.fn().mockResolvedValue(undefined)

    const didSend = await autoSendGeneratedPattern({
      bleConnectionStatus: 'idle',
      bleCharacteristicStatus: 'idle',
      isSending: false,
      ledSize: 16,
      pixelMatrix: [['A1']],
      palette: {
        A1: {
          code: 'A1',
          name: 'Black',
          name_zh: '黑色',
          hex: '#000000',
          rgb: [0, 0, 0]
        }
      },
      sendImage
    })

    expect(didSend).toBe(false)
    expect(sendImage).not.toHaveBeenCalled()
  })
})
