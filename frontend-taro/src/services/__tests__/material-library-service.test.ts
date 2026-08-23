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
    ).resolves.toEqual(payload)
    expect(requestMock).toHaveBeenCalledWith({
      url: 'https://gallery.example.com/api/gallery/list?page=1&per_page=20&max_width=29&max_height=29'
    })
  })

  it('loads canonical detail JSON only when a material is selected', async () => {
    requestMock.mockResolvedValue({
      statusCode: 200,
      data: { work: { id: 1655 } }
    })

    await getMaterialGalleryWork(1655)
    expect(requestMock).toHaveBeenCalledWith({
      url: 'https://gallery.example.com/api/gallery/list?id=1655'
    })
  })

  it('surfaces API error messages', async () => {
    requestMock.mockResolvedValue({
      statusCode: 503,
      data: { error: '画廊数据读取失败' }
    })

    await expect(listMaterialGallery()).rejects.toThrow('画廊数据读取失败')
  })
})
