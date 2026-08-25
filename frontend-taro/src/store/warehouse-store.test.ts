import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PatternInventoryRequirement } from '@/features/bead-warehouse/model'

vi.mock('@/utils/persistence', () => ({
  readPersistedState: (_key: string, fallback: unknown) => fallback,
  writePersistedState: vi.fn(() => true)
}))

import { useWarehouseStore } from './warehouse-store'

const requirements: PatternInventoryRequirement[] = [
  {
    code: 'C4',
    name: 'Blue',
    nameZh: '蓝色',
    hex: '#0000ff',
    required: 187,
    available: 187,
    remaining: 0,
    shortage: 0
  }
]

describe('warehouse store pattern consumption', () => {
  beforeEach(() => {
    useWarehouseStore.setState({
      quantities: { C4: 187 },
      lowThreshold: 100,
      beadsPerGram: 100,
      lastDeduction: null
    })
  })

  it('deducts the pattern and restores it with one-step undo', () => {
    expect(useWarehouseStore.getState().consumePattern(requirements)).toBe(true)
    expect(useWarehouseStore.getState()).toMatchObject({
      quantities: { C4: 0 },
      lastDeduction: { requirements: { C4: 187 } }
    })

    expect(useWarehouseStore.getState().undoLastDeduction()).toBe(true)
    expect(useWarehouseStore.getState()).toMatchObject({
      quantities: { C4: 187 },
      lastDeduction: null
    })
  })
})
