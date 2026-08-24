import { create } from 'zustand'
import type { PatternHistoryEntry } from '@/types/community'
import { readPersistedState, writePersistedState } from '@/utils/persistence'

const HISTORY_STORAGE_KEY = 'pixeldoodle:pattern-history'
const HISTORY_LIMIT = 24

const initialHistory = readPersistedState<PatternHistoryEntry[]>(
  HISTORY_STORAGE_KEY,
  []
)

function persist(entries: PatternHistoryEntry[]) {
  return writePersistedState(HISTORY_STORAGE_KEY, entries)
}

export interface HistoryStoreState {
  entries: PatternHistoryEntry[]
  addEntry: (entry: PatternHistoryEntry) => boolean
  clearHistory: () => void
}

export const useHistoryStore = create<HistoryStoreState>((set, get) => ({
  entries: initialHistory,
  addEntry: (entry) => {
    let saved = false
    set(() => {
      const nextEntries = [entry, ...get().entries.filter((item) => item.id !== entry.id)].slice(
        0,
        HISTORY_LIMIT
      )
      saved = persist(nextEntries)
      return {
        entries: nextEntries
      }
    })
    return saved
  },
  clearHistory: () =>
    set(() => {
      persist([])
      return {
        entries: []
      }
    })
}))
