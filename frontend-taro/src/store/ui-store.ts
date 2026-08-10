import { create } from 'zustand'
import { DEFAULT_SCAN_MODE } from '../constants/examples'
import type { ScanMode } from '../types/device'

export interface UIState {
  isPairSheetOpen: boolean
  isSettingsSheetOpen: boolean
  toastMessage: string
  isLoading: boolean
  scanMode: ScanMode
}

export const useUIStore = create<UIState>(() => ({
  isPairSheetOpen: false,
  isSettingsSheetOpen: false,
  toastMessage: '',
  isLoading: false,
  scanMode: DEFAULT_SCAN_MODE
}))
