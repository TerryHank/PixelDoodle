import { create } from 'zustand'
import {
  adjustInventoryQuantity,
  deductPatternInventory,
  type InventoryOperation,
  type PatternInventoryRequirement
} from '@/features/bead-warehouse/model'
import { readPersistedState, writePersistedState } from '@/utils/persistence'

const STORAGE_KEY = 'pixeldoodle:bead-warehouse-v1'

interface PersistedWarehouse {
  quantities: Record<string, number>
  lowThreshold: number
  beadsPerGram: number
  lastDeduction: {
    at: number
    requirements: Record<string, number>
  } | null
}

const persisted = readPersistedState<Partial<PersistedWarehouse>>(STORAGE_KEY, {})
const initial: PersistedWarehouse = {
  quantities: persisted.quantities ?? {},
  lowThreshold: persisted.lowThreshold ?? 100,
  beadsPerGram: persisted.beadsPerGram ?? 100,
  lastDeduction: persisted.lastDeduction ?? null
}

function persist(state: PersistedWarehouse) {
  writePersistedState<PersistedWarehouse>(STORAGE_KEY, {
    quantities: state.quantities,
    lowThreshold: state.lowThreshold,
    beadsPerGram: state.beadsPerGram,
    lastDeduction: state.lastDeduction
  })
}

export interface WarehouseState extends PersistedWarehouse {
  adjust: (code: string, operation: InventoryOperation, amount: number, unit: 'bead' | 'gram') => void
  importValues: (values: Record<string, number>) => void
  consumePattern: (requirements: PatternInventoryRequirement[]) => boolean
  undoLastDeduction: () => boolean
  setLowThreshold: (value: number) => void
  setBeadsPerGram: (value: number) => void
}

export const useWarehouseStore = create<WarehouseState>((set) => ({
  ...initial,
  adjust: (code, operation, amount, unit) => set((state) => {
    const beadAmount = unit === 'gram' ? amount * state.beadsPerGram : amount
    const quantities = {
      ...state.quantities,
      [code]: adjustInventoryQuantity(state.quantities[code] ?? 0, operation, beadAmount)
    }
    const next = { ...state, quantities, lastDeduction: null }
    persist(next)
    return { quantities, lastDeduction: null }
  }),
  importValues: (values) => set((state) => {
    const quantities = { ...state.quantities, ...values }
    const next = { ...state, quantities, lastDeduction: null }
    persist(next)
    return { quantities, lastDeduction: null }
  }),
  consumePattern: (requirements) => {
    let applied = false
    set((state) => {
      const result = deductPatternInventory(state.quantities, requirements)
      if (!result.applied) return state
      applied = true
      const lastDeduction = {
        at: Date.now(),
        requirements: Object.fromEntries(
          requirements.map((item) => [item.code, item.required])
        )
      }
      const next = { ...state, quantities: result.quantities, lastDeduction }
      persist(next)
      return { quantities: result.quantities, lastDeduction }
    })
    return applied
  },
  undoLastDeduction: () => {
    let restored = false
    set((state) => {
      if (!state.lastDeduction) return state
      restored = true
      const quantities = { ...state.quantities }
      Object.entries(state.lastDeduction.requirements).forEach(([code, amount]) => {
        quantities[code] = Math.max(0, Math.round((quantities[code] ?? 0) + amount))
      })
      const next = { ...state, quantities, lastDeduction: null }
      persist(next)
      return { quantities, lastDeduction: null }
    })
    return restored
  },
  setLowThreshold: (value) => set((state) => {
    const lowThreshold = Math.max(0, Math.round(value || 0))
    persist({ ...state, lowThreshold })
    return { lowThreshold }
  }),
  setBeadsPerGram: (value) => set((state) => {
    const beadsPerGram = Math.max(1, Math.round(value || 1))
    persist({ ...state, beadsPerGram })
    return { beadsPerGram }
  })
}))
