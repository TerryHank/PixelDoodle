import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@tarojs/taro', () => ({
  default: {
    hideLoading: vi.fn(),
    redirectTo: vi.fn(),
    request: vi.fn(),
    showLoading: vi.fn(),
    showToast: vi.fn()
  }
}))

vi.mock('@/components/app-tab-bar', () => ({
  AppTabBar: () => null
}))

import MaterialsPageH5 from './index.h5'

describe('materials H5 page', () => {
  it('renders search, source, category and six-board controls', () => {
    const html = renderToStaticMarkup(<MaterialsPageH5 />)
    expect(html).toContain('全尺寸拼豆素材库')
    expect(html).toContain('搜索素材')
    expect(html).toContain('全部来源')
    expect(html).toContain('全部分类')
    expect(html).toContain('104 × 74')
    expect(html).toContain('搜索历史')
    expect(html).toContain('收藏到本地图册')
  })
})
