import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@tarojs/components', () => ({
  Button: 'button',
  Text: 'span',
  View: 'div'
}))

import { DeviceMonitorPanel } from './index'

describe('device monitor panel', () => {
  it('renders PDD board, rotation and lock telemetry', () => {
    const html = renderToStaticMarkup(
      <DeviceMonitorPanel
        alerts={[]}
        device={{
          deviceId: 'CB724E',
          transport: 'ble',
          connectionState: 'online',
          healthState: 'healthy',
          lastSeenAt: 1,
          lastHeartbeatAt: 1,
          lastAckAt: null,
          lastNackAt: null,
          lastTimeoutAt: null,
          telemetry: {
            brightness: 25,
            boardWidth: 104,
            boardHeight: 104,
            rotationDegrees: 0,
            passwordFlag: 0
          }
        }}
      />
    )

    expect(html).toContain('104×104')
    expect(html).toContain('0°')
    expect(html).toContain('密码预留标志')
  })
})
