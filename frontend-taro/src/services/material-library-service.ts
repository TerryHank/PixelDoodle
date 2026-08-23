import Taro from '@tarojs/taro'
import { getApiBaseUrl } from './env'
import type {
  MaterialGalleryDetailResponse,
  MaterialGalleryFilters,
  MaterialGalleryListResponse
} from '@/types/material-library'

type GalleryApiGlobal = typeof globalThis & {
  __PIXELDOODLE_GALLERY_API_BASE_URL__?: string
  process?: { env?: Record<string, string | undefined> }
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

export function getGalleryApiBaseUrl() {
  const globalValue = (globalThis as GalleryApiGlobal)
    .__PIXELDOODLE_GALLERY_API_BASE_URL__
  const processValue = (globalThis as GalleryApiGlobal).process?.env
    ?.TARO_APP_GALLERY_API_BASE_URL
  return trimTrailingSlash((globalValue || processValue || getApiBaseUrl()).trim())
}

function getErrorMessage(statusCode: number, data: unknown) {
  if (data && typeof data === 'object') {
    const errorData = data as { error?: unknown; detail?: unknown; message?: unknown }
    const message = errorData.error ?? errorData.detail ?? errorData.message
    if (typeof message === 'string' && message.trim()) {
      return message.trim()
    }
  }
  return `素材库请求失败（${statusCode}）`
}

async function requestGalleryJson<T>(path: string) {
  const response = await Taro.request<T>({
    url: `${getGalleryApiBaseUrl()}${path}`
  })
  if (response.statusCode >= 400) {
    throw new Error(getErrorMessage(response.statusCode, response.data))
  }
  return response.data
}

function queryPart(key: string, value: string | number) {
  return `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`
}

export function buildMaterialGalleryListPath(filters: MaterialGalleryFilters = {}) {
  const page = Math.max(1, Math.round(filters.page ?? 1))
  const perPage = Math.min(60, Math.max(1, Math.round(filters.perPage ?? 20)))
  const parts = [queryPart('page', page), queryPart('per_page', perPage)]
  const query = filters.query?.trim()
  const source = filters.source?.trim()
  const category = filters.category?.trim()

  if (query) parts.push(queryPart('q', query))
  if (source) parts.push(queryPart('source', source))
  if (category) parts.push(queryPart('category', category))
  if (filters.boardSize) {
    parts.push(queryPart('max_width', Math.max(1, Math.round(filters.boardSize.width))))
    parts.push(queryPart('max_height', Math.max(1, Math.round(filters.boardSize.height))))
  }

  return `/api/gallery/list?${parts.join('&')}`
}

export function listMaterialGallery(filters: MaterialGalleryFilters = {}) {
  return requestGalleryJson<MaterialGalleryListResponse>(
    buildMaterialGalleryListPath(filters)
  )
}

export function getMaterialGalleryWork(id: number) {
  if (!Number.isInteger(id) || id <= 0) {
    return Promise.reject(new Error('素材 ID 无效'))
  }
  return requestGalleryJson<MaterialGalleryDetailResponse>(
    `/api/gallery/list?id=${encodeURIComponent(String(id))}`
  )
}
