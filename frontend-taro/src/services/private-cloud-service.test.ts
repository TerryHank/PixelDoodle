import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requestJson: vi.fn(),
  getPrivateApiHeaders: vi.fn(() => ({
    'x-pixeldoodle-user-id': 'user-a'
  }))
}))

vi.mock('./http', () => ({ requestJson: mocks.requestJson }))
vi.mock('./identity', () => ({
  getPrivateApiHeaders: mocks.getPrivateApiHeaders
}))

import {
  buildPrivateCloudCanvasDocument,
  createPrivateCloudWork,
  deletePrivateCloudWork,
  getPrivateCloudWork,
  listPrivateCloudWorks,
  restorePrivateCloudWork,
  updatePrivateCloudWork
} from './private-cloud-service'

const document = buildPrivateCloudCanvasDocument({
  gridSize: { width: 2, height: 2 },
  pixelMatrix: [['A1', null], ['B1', 'A1']],
  colorSummary: [
    {
      code: 'A1',
      name: 'White',
      name_zh: '白色',
      hex: '#FFFFFF',
      rgb: [255, 255, 255],
      count: 2
    },
    {
      code: 'B1',
      name: 'Black',
      name_zh: '黑色',
      hex: '#000000',
      rgb: [0, 0, 0],
      count: 1
    }
  ],
  palettePreset: '221',
  editorState: { zoom: 2 }
})

describe('private cloud service', () => {
  beforeEach(() => {
    mocks.requestJson.mockReset()
    mocks.getPrivateApiHeaders.mockClear()
  })

  it('builds the current editable canvas contract without sharing matrix rows', () => {
    expect(document).toMatchObject({
      schema_version: 'pixeldoodle.canvas/v1',
      grid_size: { width: 2, height: 2 },
      total_beads: 3,
      palette_preset: '221',
      editor_state: { zoom: 2 }
    })
    expect(document.pixel_matrix).toEqual([
      ['A1', null],
      ['B1', 'A1']
    ])
  })

  it('adds private identity to create and update requests', async () => {
    mocks.requestJson.mockResolvedValue({ id: 'work-1' })

    await createPrivateCloudWork('user-a', {
      title: '作品',
      source_label: '自由创作',
      document
    })
    await updatePrivateCloudWork('user-a', 'work/1', {
      expected_version: 1,
      title: '作品二',
      document
    })

    expect(mocks.getPrivateApiHeaders).toHaveBeenNthCalledWith(1, 'user-a')
    expect(mocks.requestJson).toHaveBeenNthCalledWith(
      1,
      '/api/cloud/works',
      expect.objectContaining({
        method: 'POST',
        header: expect.objectContaining({
          'x-pixeldoodle-user-id': 'user-a',
          'content-type': 'application/json'
        })
      })
    )
    expect(mocks.requestJson.mock.calls[1][0]).toBe('/api/cloud/works/work%2F1')
    expect(mocks.requestJson.mock.calls[1][1].data.expected_version).toBe(1)
  })

  it('uses explicit version and deletion flags for list, get, delete and restore', async () => {
    mocks.requestJson.mockResolvedValue({})

    await listPrivateCloudWorks('user-a', {
      includeDeleted: true,
      limit: 10,
      offset: 20
    })
    await getPrivateCloudWork('user-a', 'work-1', { includeDeleted: true })
    await deletePrivateCloudWork('user-a', 'work-1', 3)
    await restorePrivateCloudWork('user-a', 'work-1', 4)

    expect(mocks.requestJson.mock.calls[0][0]).toBe(
      '/api/cloud/works?include_deleted=true&limit=10&offset=20'
    )
    expect(mocks.requestJson.mock.calls[1][0]).toBe(
      '/api/cloud/works/work-1?include_deleted=true'
    )
    expect(mocks.requestJson.mock.calls[2]).toEqual([
      '/api/cloud/works/work-1?expected_version=3',
      expect.objectContaining({ method: 'DELETE' })
    ])
    expect(mocks.requestJson.mock.calls[3][1].data).toEqual({
      expected_version: 4
    })
  })
})
