import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerWeappRasterLoader } from './weapp-raster-loader'

const { getEnvMock } = vi.hoisted(() => ({
  getEnvMock: vi.fn()
}))

vi.mock('@tarojs/taro', () => ({
  default: {
    ENV_TYPE: {
      WEB: 'WEB',
      WEAPP: 'WEAPP',
      RN: 'RN'
    },
    getEnv: getEnvMock
  }
}))

import {
  buildLocalGenerateOptions,
  generatePatternLocally,
  getLocalGenerationUnavailableReason,
  isLocalGenerationAvailable,
  normalizeGeneratePatternResponse,
  validateLocalGenerationGrid
} from './local-generation'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  registerWeappRasterLoader(null)
})

describe('local-generation helpers', () => {
  it('coerces string form fields into wasm options', () => {
    const options = buildLocalGenerateOptions({
      mode: 'pixel_size',
      grid_width: '40',
      grid_height: '52',
      led_size: '64',
      pixel_size: '7',
      use_dithering: 'true',
      palette_preset: '221',
      max_colors: '12',
      similarity_threshold: '3',
      remove_bg: 'false',
      contrast: '1.5',
      saturation: '0.25',
      sharpness: '2'
    })

    expect(options).toEqual({
      mode: 'pixel_size',
      grid_width: 40,
      grid_height: 52,
      led_size: 64,
      pixel_size: 7,
      use_dithering: true,
      palette_preset: '221',
      max_colors: 12,
      similarity_threshold: 3,
      remove_bg: false,
      contrast: 1.5,
      saturation: 0.25,
      sharpness: 2
    })
  })

  it('normalizes wasm output into the shared response shape', () => {
    const response = normalizeGeneratePatternResponse(
      {
        grid_size: {
          width: '48',
          height: 64
        },
        pixel_matrix: [['A1', undefined], [null, 'B2']],
        color_summary: [
          {
            code: 'A1',
            count: '2',
            hex: '#000000',
            name: 'Black',
            name_zh: '黑色',
            rgb: ['0', 0, 0]
          }
        ],
        total_beads: '2',
        preview_image: undefined
      },
      '221'
    )

    expect(response.grid_size).toEqual({ width: 48, height: 64 })
    expect(response.pixel_matrix).toEqual([
      ['A1', null],
      [null, 'B2']
    ])
    expect(response.color_summary).toEqual([
      {
        code: 'A1',
        count: 2,
        hex: '#000000',
        name: 'Black',
        name_zh: '黑色',
        rgb: [0, 0, 0]
      }
    ])
    expect(response.total_beads).toBe(2)
    expect(response.preview_image).toBe('')
    expect(response.palette_preset).toBe('221')
    expect(response.session_id.length).toBeGreaterThan(0)
  })

  it('rejects fixed-grid output that does not match the selected board', () => {
    const options = buildLocalGenerateOptions({
      mode: 'fixed_grid',
      grid_width: '104',
      grid_height: '74'
    })
    const mismatched = normalizeGeneratePatternResponse(
      {
        grid_size: { width: 104, height: 74 },
        pixel_matrix: Array.from({ length: 74 }, () => Array(103).fill('A1'))
      },
      '221'
    )

    expect(() => validateLocalGenerationGrid(mismatched, options)).toThrow(
      '本地图案尺寸不匹配'
    )
  })

  it('accepts fixed-grid output with the exact selected width and height', () => {
    const options = buildLocalGenerateOptions({
      mode: 'fixed_grid',
      grid_width: '104',
      grid_height: '74'
    })
    const matching = normalizeGeneratePatternResponse(
      {
        grid_size: { width: 104, height: 74 },
        pixel_matrix: Array.from({ length: 74 }, () => Array(104).fill('A1'))
      },
      '221'
    )

    expect(validateLocalGenerationGrid(matching, options)).toBe(matching)
  })

  it('explains when weapp local raster loader has not been registered yet', () => {
    getEnvMock.mockReturnValue('WEAPP')

    expect(isLocalGenerationAvailable()).toBe(false)
    expect(getLocalGenerationUnavailableReason()).toContain('本地生成画布')
  })

  it('treats weapp local generation as available once the raster loader is ready', () => {
    getEnvMock.mockReturnValue('WEAPP')
    registerWeappRasterLoader({
      loadRaster: vi.fn()
    })

    expect(isLocalGenerationAvailable()).toBe(true)
    expect(getLocalGenerationUnavailableReason()).toBeNull()
  })

  it('falls back to the main-thread JS engine when the module worker crashes', async () => {
    getEnvMock.mockReturnValue('WEB')
    class FailingWorker {
      listeners = new Map<string, (event?: unknown) => void>()

      addEventListener(type: string, listener: (event?: unknown) => void) {
        this.listeners.set(type, listener)
      }

      postMessage() {
        queueMicrotask(() => this.listeners.get('error')?.({ type: 'error' }))
      }

      terminate() {}
    }
    class MockImage {
      width = 32
      height = 32
      onload: (() => void) | null = null
      onerror: (() => void) | null = null

      set src(_value: string) {
        queueMicrotask(() => this.onload?.())
      }
    }

    vi.stubGlobal('window', {})
    vi.stubGlobal('Worker', FailingWorker)
    vi.stubGlobal('Image', MockImage)
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:compatibility-image'),
      revokeObjectURL: vi.fn()
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob(['image']), { status: 200 }))
    )
    vi.stubGlobal('document', {
      createElement: () => {
        const canvas = {
          width: 0,
          height: 0,
          getContext: () => ({
            imageSmoothingEnabled: false,
            imageSmoothingQuality: 'low',
            drawImage: vi.fn(),
            getImageData: () => ({
              data: new Uint8ClampedArray(canvas.width * canvas.height * 4).fill(255)
            })
          })
        }
        return canvas
      }
    })

    const response = await generatePatternLocally(
      'blob:source',
      {
        mode: 'fixed_grid',
        grid_width: '2',
        grid_height: '2',
        palette_preset: 'all'
      },
      {
        colors: [
          {
            code: 'W1',
            name: 'White',
            name_zh: '白色',
            hex: '#ffffff',
            rgb: [255, 255, 255]
          }
        ],
        presets: { all: { label: '全部', codes: null } }
      }
    )

    expect(response.grid_size).toEqual({ width: 2, height: 2 })
    expect(response.pixel_matrix).toEqual([
      ['W1', 'W1'],
      ['W1', 'W1']
    ])
  })
})
