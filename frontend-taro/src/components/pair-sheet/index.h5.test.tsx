import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PairSheetH5 } from './index.h5'

describe('pair sheet diagnostics', () => {
  it('shows browser, authorization and connection checks', () => {
    const html = renderToStaticMarkup(
      <PairSheetH5
        open
        statusMessage='已连接设备 CB724E'
        statusTone='connected'
        bleAvailable
        devices={[{
          key: 'pdd',
          name: 'PDD_CB724E',
          uuid: 'CB724E',
          meta: '104×104',
          connected: true,
          remembered: true
        }]}
        onClose={vi.fn()}
        onSelectDevice={vi.fn()}
        onAddDevice={vi.fn()}
      />
    )

    expect(html).toContain('连接诊断')
    expect(html).toContain('浏览器蓝牙能力')
    expect(html).toContain('当前 GATT 连接')
  })
})
