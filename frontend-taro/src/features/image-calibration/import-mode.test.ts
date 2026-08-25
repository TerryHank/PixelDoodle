import { describe, expect, it } from 'vitest'
import { buildImageImportPlan } from './import-mode'

describe('buildImageImportPlan', () => {
  it('keeps pixel art crisp and rasterizes directly to the target grid', () => {
    expect(buildImageImportPlan('pixel-art', 640, 480, 29, 22)).toMatchObject({
      canvasWidth: 29,
      canvasHeight: 22,
      imageSmoothingEnabled: false,
      mimeType: 'image/png',
      extension: 'png'
    })
  })

  it('keeps photo detail until the local quantization stage', () => {
    expect(buildImageImportPlan('photo', 640.4, 480.4, 29, 22)).toMatchObject({
      canvasWidth: 640,
      canvasHeight: 480,
      imageSmoothingEnabled: true,
      mimeType: 'image/jpeg',
      extension: 'jpg'
    })
  })
})
