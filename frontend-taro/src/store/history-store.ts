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
  renameEntry: (id: string, title: string) => boolean
  removeEntry: (id: string) => boolean
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
  renameEntry: (id, title) => {
    const normalizedTitle = title.trim().slice(0, 40)
    if (!normalizedTitle) return false
    const nextEntries = get().entries.map((entry) =>
      entry.id === id ? { ...entry, title: normalizedTitle } : entry
    )
    const saved = persist(nextEntries)
    set({ entries: nextEntries })
    return saved
  },
  removeEntry: (id) => {
    const nextEntries = get().entries.filter((entry) => entry.id !== id)
    const saved = persist(nextEntries)
    set({ entries: nextEntries })
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
