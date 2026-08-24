import Taro from '@tarojs/taro'
import { getApiBaseUrl } from './env'
import type {
  MaterialGalleryDetailResponse,
  MaterialGalleryFilters,
  MaterialGalleryListResponse,
  MaterialGalleryWork
} from '@/types/material-library'

type GalleryApiGlobal = typeof globalThis & {
  __PIXELDOODLE_GALLERY_API_BASE_URL__?: string
  process?: { env?: Record<string, string | undefined> }
}

interface OfflineMaterialGalleryPackage {
  schemaVersion: 1
  archiveTotal: number
  bundledTotal: number
  works: MaterialGalleryListResponse['works']
}

const OFFLINE_GALLERY_URL = '/static/gallery/offline-materials-v1.json'
let offlineGalleryPromise: Promise<OfflineMaterialGalleryPackage> | null = null

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

async function requestGalleryJson<T>(baseUrl: string, path: string) {
  const response = await Taro.request<T>({
    url: `${baseUrl}${path}`
  })
  if (response.statusCode >= 400) {
    throw new Error(getErrorMessage(response.statusCode, response.data))
  }
  return response.data
}

function isMaterialGalleryWork(value: unknown): value is MaterialGalleryWork {
  if (!value || typeof value !== 'object') return false
  const work = value as Partial<MaterialGalleryWork>
  return Boolean(
    (work.v === 1 || work.v === 2) &&
      work.access === 'public' &&
      Number.isInteger(work.id) &&
      Number(work.id) > 0 &&
      typeof work.title === 'string' &&
      Number.isInteger(work.width) &&
      Number(work.width) > 0 &&
      Number.isInteger(work.height) &&
      Number(work.height) > 0 &&
      Array.isArray(work.palette) &&
      work.palette.length > 0 &&
      work.palette.every((color) => /^#[0-9a-f]{6}$/i.test(color)) &&
      Array.isArray(work.keys) &&
      work.keys.length === work.palette.length &&
      work.keys.every((key) => typeof key === 'string') &&
      typeof work.grid === 'string' &&
      work.grid.length === Number(work.width) * Number(work.height) * 2 &&
      /^(?:[0-9a-f]{2})+$/i.test(work.grid) &&
      typeof work.createdAt === 'string' &&
      typeof work.source === 'string' &&
      typeof work.category === 'string' &&
      Array.isArray(work.tags) &&
      work.tags.every((tag) => typeof tag === 'string')
  )
}

function validateRemoteListResponse(
  value: unknown,
  filters: MaterialGalleryFilters
): MaterialGalleryListResponse {
  if (!value || typeof value !== 'object') {
    throw new Error('在线素材库返回的数据格式无效')
  }
  const response = value as Partial<MaterialGalleryListResponse>
  if (
    !Array.isArray(response.works) ||
    !response.works.every(isMaterialGalleryWork) ||
    typeof response.hasMore !== 'boolean'
  ) {
    throw new Error('在线素材库返回的数据格式无效')
  }
  const normalized = normalizedFilters(filters)
  return {
    works: response.works,
    hasMore: response.hasMore,
    total: Number.isInteger(response.total)
      ? Number(response.total)
      : response.works.length,
    page: Number.isInteger(response.page) ? Number(response.page) : normalized.page,
    perPage: Number.isInteger(response.perPage)
      ? Number(response.perPage)
      : normalized.perPage,
    delivery: 'remote'
  }
}

async function loadOfflineGallery() {
  if (!offlineGalleryPromise) {
    offlineGalleryPromise = Taro.request<OfflineMaterialGalleryPackage>({
      url: OFFLINE_GALLERY_URL
    })
      .then((response) => {
        if (response.statusCode >= 400) {
          throw new Error(`内置素材库读取失败（${response.statusCode}）`)
        }
        const payload = response.data
        if (
          payload?.schemaVersion !== 1 ||
          !Array.isArray(payload.works) ||
          payload.works.length !== payload.bundledTotal ||
          !payload.works.every(isMaterialGalleryWork)
        ) {
          throw new Error('内置素材库数据格式无效')
        }
        return payload
      })
      .catch((error) => {
        offlineGalleryPromise = null
        throw error
      })
  }
  return offlineGalleryPromise
}

function normalizedFilters(filters: MaterialGalleryFilters) {
  return {
    page: Math.max(1, Math.round(filters.page ?? 1)),
    perPage: Math.min(60, Math.max(1, Math.round(filters.perPage ?? 20))),
    query: filters.query?.trim().toLocaleLowerCase() || '',
    source: filters.source?.trim() || '',
    category: filters.category?.trim() || '',
    boardSize: filters.boardSize
  }
}

async function listOfflineMaterialGallery(
  filters: MaterialGalleryFilters,
  fallbackReason?: string
) {
  const payload = await loadOfflineGallery()
  const normalized = normalizedFilters(filters)
  const terms = normalized.query.split(/\s+/).filter(Boolean)
  const filtered = payload.works.filter((work) => {
    if (normalized.source && work.source !== normalized.source) return false
    if (normalized.category && work.category !== normalized.category) return false
    if (
      normalized.boardSize &&
      (work.width > normalized.boardSize.width ||
        work.height > normalized.boardSize.height)
    ) {
      return false
    }
    if (terms.length) {
      const searchText = [work.title, work.category, work.source, ...work.tags]
        .join(' ')
        .toLocaleLowerCase()
      if (!terms.every((term) => searchText.includes(term))) return false
    }
    return true
  })
  const offset = (normalized.page - 1) * normalized.perPage
  const works = filtered.slice(offset, offset + normalized.perPage)
  return {
    works,
    hasMore: offset + works.length < filtered.length,
    total: filtered.length,
    page: normalized.page,
    perPage: normalized.perPage,
    delivery: 'offline' as const,
    archiveTotal: payload.archiveTotal,
    bundledTotal: payload.bundledTotal,
    ...(fallbackReason ? { fallbackReason } : {})
  }
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
  const baseUrl = getGalleryApiBaseUrl()
  return requestGalleryJson<unknown>(
    baseUrl,
    buildMaterialGalleryListPath(filters)
  )
    .then((response) => validateRemoteListResponse(response, filters))
    .catch((error) => {
      const reason =
        baseUrl && error instanceof Error ? error.message : undefined
      return listOfflineMaterialGallery(filters, reason)
    })
}

function getOfflineMaterialGalleryWork(id: number) {
  return loadOfflineGallery().then((payload) => {
    const work = payload.works.find((item) => item.id === id)
    if (!work) throw new Error('内置素材不存在')
    return { work }
  })
}

export function getMaterialGalleryWork(id: number) {
  if (!Number.isInteger(id) || id <= 0) {
    return Promise.reject(new Error('素材 ID 无效'))
  }
  const baseUrl = getGalleryApiBaseUrl()
  if (!baseUrl && offlineGalleryPromise) {
    return getOfflineMaterialGalleryWork(id)
  }
  return requestGalleryJson<MaterialGalleryDetailResponse>(
    baseUrl,
    `/api/gallery/list?id=${encodeURIComponent(String(id))}`
  )
    .then((response) => {
      if (!isMaterialGalleryWork(response?.work)) {
        throw new Error('在线素材详情格式无效')
      }
      return response
    })
    .catch(() => getOfflineMaterialGalleryWork(id))
}
