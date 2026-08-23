import { getPrivateApiHeaders } from './identity'
import { requestJson } from './http'
import type {
  ColorSummaryItem,
  GridSize,
  JsonValue,
  PixelMatrix
} from '@/types/api'
import {
  PRIVATE_CLOUD_CANVAS_SCHEMA,
  type CreatePrivateCloudWorkRequest,
  type PrivateCloudCanvasDocument,
  type PrivateCloudWork,
  type PrivateCloudWorkPage,
  type PrivateCloudWorkSummary,
  type UpdatePrivateCloudWorkRequest
} from '@/types/private-cloud'

function encoded(value: string | number | boolean) {
  return encodeURIComponent(String(value))
}

function privateHeaders(userId: string, includeJson = false) {
  return {
    ...getPrivateApiHeaders(userId),
    ...(includeJson ? { 'content-type': 'application/json' } : {})
  }
}

export function buildPrivateCloudCanvasDocument(input: {
  gridSize: GridSize
  pixelMatrix: PixelMatrix
  colorSummary: ColorSummaryItem[]
  palettePreset: string
  editorState?: Record<string, JsonValue>
}): PrivateCloudCanvasDocument {
  const totalBeads = input.pixelMatrix.reduce(
    (total, row) => total + row.filter((cell) => cell !== null).length,
    0
  )

  return {
    schema_version: PRIVATE_CLOUD_CANVAS_SCHEMA,
    grid_size: { ...input.gridSize },
    pixel_matrix: input.pixelMatrix.map((row) => [...row]),
    color_summary: input.colorSummary.map((item) => ({ ...item })),
    total_beads: totalBeads,
    palette_preset: input.palettePreset,
    ...(input.editorState ? { editor_state: { ...input.editorState } } : {})
  }
}

export async function createPrivateCloudWork(
  userId: string,
  payload: CreatePrivateCloudWorkRequest
) {
  return requestJson<PrivateCloudWork>('/api/cloud/works', {
    method: 'POST',
    header: privateHeaders(userId, true),
    data: payload
  })
}

export async function listPrivateCloudWorks(
  userId: string,
  options: {
    includeDeleted?: boolean
    limit?: number
    offset?: number
  } = {}
) {
  const query = [
    `include_deleted=${encoded(options.includeDeleted ?? false)}`,
    `limit=${encoded(options.limit ?? 50)}`,
    `offset=${encoded(options.offset ?? 0)}`
  ].join('&')
  return requestJson<PrivateCloudWorkPage>(`/api/cloud/works?${query}`, {
    header: privateHeaders(userId)
  })
}

export async function getPrivateCloudWork(
  userId: string,
  workId: string,
  options: { includeDeleted?: boolean } = {}
) {
  return requestJson<PrivateCloudWork>(
    `/api/cloud/works/${encoded(workId)}?include_deleted=${encoded(
      options.includeDeleted ?? false
    )}`,
    { header: privateHeaders(userId) }
  )
}

export async function updatePrivateCloudWork(
  userId: string,
  workId: string,
  payload: UpdatePrivateCloudWorkRequest
) {
  return requestJson<PrivateCloudWork>(`/api/cloud/works/${encoded(workId)}`, {
    method: 'PUT',
    header: privateHeaders(userId, true),
    data: payload
  })
}

export async function deletePrivateCloudWork(
  userId: string,
  workId: string,
  expectedVersion: number
) {
  return requestJson<PrivateCloudWorkSummary>(
    `/api/cloud/works/${encoded(workId)}?expected_version=${encoded(expectedVersion)}`,
    {
      method: 'DELETE',
      header: privateHeaders(userId)
    }
  )
}

export async function restorePrivateCloudWork(
  userId: string,
  workId: string,
  expectedVersion: number
) {
  return requestJson<PrivateCloudWorkSummary>(
    `/api/cloud/works/${encoded(workId)}/restore`,
    {
      method: 'POST',
      header: privateHeaders(userId, true),
      data: { expected_version: expectedVersion }
    }
  )
}
