import type { GeneratePatternResponse } from '@/types/api'

const LOCAL_GENERATION_WORKER_URL = '/static/local-processing/wasm-worker.js'
const LOCAL_GENERATION_TIMEOUT_MS = 60000

export type GenerateTransportMode = 'local-wasm' | 'server-http'

export interface LocalGenerateOptions {
  mode: string
  grid_width: number
  grid_height: number
  led_size: number
  pixel_size: number
  use_dithering: boolean
  palette_preset: string
  max_colors: number
  similarity_threshold: number
  remove_bg: boolean
  contrast: number
  saturation: number
  sharpness: number
}

interface WorkerRequest {
  id: string
  bytes: ArrayBuffer
  options: LocalGenerateOptions
}

interface WorkerSuccessResponse {
  id: string
  ok: true
  result: Omit<GeneratePatternResponse, 'session_id' | 'palette_preset'>
}

interface WorkerErrorResponse {
  id: string
  ok: false
  error?: string
}

type WorkerResponse = WorkerSuccessResponse | WorkerErrorResponse

interface PendingRequest {
  resolve: (value: GeneratePatternResponse) => void
  reject: (error: Error) => void
  timeoutId: ReturnType<typeof setTimeout>
  palettePreset: string
}

let localGenerationWorker: Worker | null = null
const pendingRequests = new Map<string, PendingRequest>()

function createSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function isLocalGenerationAvailable() {
  return (
    typeof window !== 'undefined' &&
    typeof Worker !== 'undefined' &&
    typeof WebAssembly !== 'undefined'
  )
}

export function buildLocalGenerateOptions(fields: Record<string, string>): LocalGenerateOptions {
  return {
    mode: fields.mode ?? 'fixed_grid',
    grid_width: Number.parseInt(fields.grid_width ?? '48', 10) || 48,
    grid_height: Number.parseInt(fields.grid_height ?? '48', 10) || 48,
    led_size: Number.parseInt(fields.led_size ?? '64', 10) || 64,
    pixel_size: Number.parseInt(fields.pixel_size ?? '8', 10) || 8,
    use_dithering:
      String(fields.use_dithering ?? 'false').toLowerCase() === 'true',
    palette_preset: fields.palette_preset ?? '221',
    max_colors: Number.parseInt(fields.max_colors ?? '0', 10) || 0,
    similarity_threshold:
      Number.parseInt(fields.similarity_threshold ?? '0', 10) || 0,
    remove_bg: String(fields.remove_bg ?? 'false').toLowerCase() === 'true',
    contrast: Number(fields.contrast ?? '0') || 0,
    saturation: Number(fields.saturation ?? '0') || 0,
    sharpness: Number(fields.sharpness ?? '0') || 0
  }
}

export function normalizeGeneratePatternResponse(
  data: Partial<GeneratePatternResponse> &
    Record<string, unknown>,
  palettePreset: string
): GeneratePatternResponse {
  const colorSummary = Array.isArray(data.color_summary)
    ? data.color_summary.map((entry) => ({
        code: String(entry?.code ?? ''),
        count: Number(entry?.count ?? 0),
        hex: String(entry?.hex ?? ''),
        name: String(entry?.name ?? ''),
        name_zh: String(entry?.name_zh ?? ''),
        rgb:
          Array.isArray(entry?.rgb) && entry.rgb.length === 3
            ? [
                Number(entry.rgb[0] ?? 0),
                Number(entry.rgb[1] ?? 0),
                Number(entry.rgb[2] ?? 0)
              ] as [number, number, number]
            : [0, 0, 0]
      }))
    : []

  return {
    session_id: String(data.session_id || createSessionId()),
    grid_size: {
      width: Number((data.grid_size as { width?: unknown } | undefined)?.width ?? 0),
      height: Number((data.grid_size as { height?: unknown } | undefined)?.height ?? 0)
    },
    pixel_matrix: Array.isArray(data.pixel_matrix)
      ? data.pixel_matrix.map((row) =>
          Array.isArray(row) ? row.map((cell) => (cell == null ? null : String(cell))) : []
        )
      : [],
    color_summary: colorSummary,
    total_beads: Number(data.total_beads ?? 0),
    palette_preset: String(data.palette_preset || palettePreset || '221'),
    preview_image: String(data.preview_image || '')
  }
}

function ensureLocalGenerationWorker() {
  if (!isLocalGenerationAvailable()) {
    throw new Error('Local generation is unavailable')
  }

  if (localGenerationWorker) {
    return localGenerationWorker
  }

  const worker = new Worker(LOCAL_GENERATION_WORKER_URL, { type: 'module' })
  worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
    const { id } = event.data || {}
    if (!id) {
      return
    }

    const pending = pendingRequests.get(id)
    if (!pending) {
      return
    }

    pendingRequests.delete(id)
    clearTimeout(pending.timeoutId)

    if (!event.data.ok) {
      pending.reject(new Error(event.data.error || 'Local generation failed'))
      return
    }

    pending.resolve(
      normalizeGeneratePatternResponse(
        event.data.result,
        pending.palettePreset
      )
    )
  })
  worker.addEventListener('error', (event) => {
    console.error('Local generation worker crashed:', event)
  })
  localGenerationWorker = worker
  return worker
}

export async function generatePatternLocally(
  filePath: string,
  fields: Record<string, string>
) {
  const worker = ensureLocalGenerationWorker()
  const response = await fetch(filePath)
  if (!response.ok) {
    throw new Error('图片读取失败')
  }

  const bytes = await response.arrayBuffer()
  const requestId = createSessionId()
  const options = buildLocalGenerateOptions(fields)

  return await new Promise<GeneratePatternResponse>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingRequests.delete(requestId)
      reject(new Error('Local generation timed out'))
    }, LOCAL_GENERATION_TIMEOUT_MS)

    pendingRequests.set(requestId, {
      resolve,
      reject,
      timeoutId,
      palettePreset: options.palette_preset
    })

    const payload: WorkerRequest = {
      id: requestId,
      bytes,
      options
    }
    worker.postMessage(payload, [payload.bytes])
  })
}
