import { describe, expect, it } from 'vitest'

import {
  DEFAULT_GENERATION_STYLE_INDEX,
  GENERATION_STYLES
} from './generation-styles'

describe('generation styles', () => {
  it('matches the supported DashScope style options', () => {
    expect(GENERATION_STYLES).toEqual([
      { index: 0, name: '复古漫画' },
      { index: 1, name: '3D童话' },
      { index: 2, name: '二次元' },
      { index: 3, name: '小清新' },
      { index: 4, name: '未来科技' },
      { index: 5, name: '国画古风' },
      { index: 6, name: '将军百战' },
      { index: 7, name: '炫彩卡通' },
      { index: 8, name: '清雅国风' },
      { index: 9, name: '喜迎新年' },
      { index: 14, name: '国风工笔' },
      { index: 15, name: '恭贺新禧' },
      { index: 30, name: '童话世界' },
      { index: 31, name: '黏土世界' },
      { index: 32, name: '像素世界' },
      { index: 33, name: '冒险世界' },
      { index: 34, name: '日漫世界' },
      { index: 35, name: '3D世界' },
      { index: 36, name: '二次元世界' },
      { index: 37, name: '手绘世界' },
      { index: 38, name: '蜡笔世界' },
      { index: 39, name: '冰箱贴世界' },
      { index: 40, name: '吧唧世界' }
    ])
  })

  it('defaults to the Japanese-anime-world style', () => {
    expect(DEFAULT_GENERATION_STYLE_INDEX).toBe(34)
  })
})
