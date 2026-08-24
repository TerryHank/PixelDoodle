import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const requestMock = vi.hoisted(() => vi.fn())

vi.mock('@tarojs/taro', () => ({
  default: {
    request: requestMock
  }
}))

import {
  buildMaterialGalleryListPath,
  getMaterialGalleryWork,
  listMaterialGallery
} from '../material-library-service'

function galleryWork(overrides: Record<string, unknown> = {}) {
  return {
    v: 2 as const,
    access: 'public' as const,
    id: 7,
    title: '皮卡丘头像',
    width: 29,
    height: 29,
    palette: ['#ffdd00'],
    keys: ['yellow'],
    grid: '00'.repeat(29 * 29),
    createdAt: '2026-08-23T00:00:00.000Z',
    source: 'kandipad',
    category: '宝可梦',
    tags: ['皮卡丘', 'Pokemon'],
    ...overrides
  }
}

describe('material library service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as typeof globalThis & {
      __PIXELDOODLE_GALLERY_API_BASE_URL__?: string
    }).__PIXELDOODLE_GALLERY_API_BASE_URL__ = 'https://gallery.example.com/'
  })

  afterEach(() => {
    delete (globalThis as typeof globalThis & {
      __PIXELDOODLE_GALLERY_API_BASE_URL__?: string
    }).__PIXELDOODLE_GALLERY_API_BASE_URL__
  })

  it('serializes search, source, category and target board filters', () => {
    expect(
      buildMaterialGalleryListPath({
        page: 2,
        perPage: 24,
        query: '  小兔 可爱  ',
        source: 'pindou-fun',
        category: '动物',
        boardSize: { width: 104, height: 74 }
      })
    ).toBe(
      '/api/gallery/list?page=2&per_page=24&q=%E5%B0%8F%E5%85%94%20%E5%8F%AF%E7%88%B1&source=pindou-fun&category=%E5%8A%A8%E7%89%A9&max_width=104&max_height=74'
    )
  })

  it('loads a filtered page without packaging gallery JSON in the client bundle', async () => {
    const payload = {
      works: [],
      hasMore: false,
      total: 0,
      page: 1,
      perPage: 20
    }
    requestMock.mockResolvedValue({ statusCode: 200, data: payload })

    await expect(
      listMaterialGallery({ boardSize: { width: 29, height: 29 } })
    ).resolves.toEqual({ ...payload, delivery: 'remote' })
    expect(requestMock).toHaveBeenCalledWith({
      url: 'https://gallery.example.com/api/gallery/list?page=1&per_page=20&max_width=29&max_height=29'
    })
  })

  it('loads canonical detail JSON only when a material is selected', async () => {
    const work = galleryWork({ id: 1655 })
    requestMock.mockResolvedValue({
      statusCode: 200,
      data: { work }
    })

    await expect(getMaterialGalleryWork(1655)).resolves.toEqual({ work })
    expect(requestMock).toHaveBeenCalledWith({
      url: 'https://gallery.example.com/api/gallery/list?id=1655'
    })
  })

  it('falls back to the bundled gallery for remote errors and no-backend H5', async () => {
    const work = galleryWork()
    requestMock
      .mockResolvedValueOnce({
        statusCode: 503,
        data: { error: '画廊数据读取失败' }
      })
      .mockResolvedValueOnce({
        statusCode: 200,
        data: {
          schemaVersion: 1,
          archiveTotal: 64268,
          bundledTotal: 1,
          works: [work]
        }
      })

    await expect(
      listMaterialGallery({
        query: '皮卡丘 Pokemon',
        category: '宝可梦',
        boardSize: { width: 29, height: 29 }
      })
    ).resolves.toEqual({
      works: [work],
      hasMore: false,
      total: 1,
      page: 1,
      perPage: 20,
      delivery: 'offline',
      archiveTotal: 64268,
      bundledTotal: 1,
      fallbackReason: '画廊数据读取失败'
    })
    expect(requestMock).toHaveBeenNthCalledWith(1, {
      url: 'https://gallery.example.com/api/gallery/list?page=1&per_page=20&q=%E7%9A%AE%E5%8D%A1%E4%B8%98%20Pokemon&category=%E5%AE%9D%E5%8F%AF%E6%A2%A6&max_width=29&max_height=29'
    })
    expect(requestMock).toHaveBeenNthCalledWith(2, {
      url: '/static/gallery/offline-materials-v1.json'
    })

    requestMock.mockResolvedValueOnce({
      statusCode: 200,
      data: '<!doctype html>'
    })
    await expect(listMaterialGallery()).resolves.toMatchObject({
      delivery: 'offline',
      fallbackReason: '在线素材库返回的数据格式无效'
    })

    delete (globalThis as typeof globalThis & {
      __PIXELDOODLE_GALLERY_API_BASE_URL__?: string
    }).__PIXELDOODLE_GALLERY_API_BASE_URL__
    requestMock.mockResolvedValueOnce({ statusCode: 404, data: {} })
    await expect(
      listMaterialGallery({ query: '皮卡丘', boardSize: { width: 29, height: 29 } })
    ).resolves.toMatchObject({
      works: [work],
      delivery: 'offline',
      total: 1
    })
    await expect(getMaterialGalleryWork(7)).resolves.toEqual({ work })
    expect(requestMock).toHaveBeenCalledTimes(4)
  })
})
