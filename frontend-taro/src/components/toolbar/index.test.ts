import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('toolbar source', () => {
  it('does not include a dropdown caret element in picker labels', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, 'index.tsx'),
      'utf8'
    )

    expect(source).not.toContain('toolbar-picker-label__caret')
    expect(source).not.toContain('▾')
  })

  it('uses an explicit hover class so weapp toolbar buttons do not stay pressed', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, 'index.tsx'),
      'utf8'
    )

    expect(source).toContain("hoverClass: 'toolbar-tap-hover'")
    expect(source).toContain('hoverStayTime: 40')
  })
})
