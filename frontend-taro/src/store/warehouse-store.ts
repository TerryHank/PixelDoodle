import { create } from 'zustand'
import { adjustInventoryQuantity, type InventoryOperation } from '@/features/bead-warehouse/model'
import { readPersistedState, writePersistedState } from '@/utils/persistence'

const STORAGE_KEY = 'pixeldoodle:bead-warehouse-v1'

interface PersistedWarehouse {
  quantities: Record<string, number>
  lowThreshold: number
  beadsPerGram: number
}

const initial = readPersistedState<PersistedWarehouse>(STORAGE_KEY, {
  quantities: {},
  lowThreshold: 100,
  beadsPerGram: 100
})

function persist(state: PersistedWarehouse) {
  writePersistedState(STORAGE_KEY, state)
}

export interface WarehouseState extends PersistedWarehouse {
  adjust: (code: string, operation: InventoryOperation, amount: number, unit: 'bead' | 'gram') => void
  importValues: (values: Record<string, number>) => void
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
    persist({ quantities, lowThreshold: state.lowThreshold, beadsPerGram: state.beadsPerGram })
    return { quantities }
  }),
  importValues: (values) => set((state) => {
    const quantities = { ...state.quantities, ...values }
    persist({ quantities, lowThreshold: state.lowThreshold, beadsPerGram: state.beadsPerGram })
    return { quantities }
  }),
  setLowThreshold: (value) => set((state) => {
    const lowThreshold = Math.max(0, Math.round(value || 0))
    persist({ quantities: state.quantities, lowThreshold, beadsPerGram: state.beadsPerGram })
    return { lowThreshold }
  }),
  setBeadsPerGram: (value) => set((state) => {
    const beadsPerGram = Math.max(1, Math.round(value || 1))
    persist({ quantities: state.quantities, lowThreshold: state.lowThreshold, beadsPerGram })
    return { beadsPerGram }
  })
}))
