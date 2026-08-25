import type { PatternHistoryEntry } from '@/types/community'

export type GallerySort = 'newest' | 'oldest' | 'name'

export function filterLocalGallery(
  entries: PatternHistoryEntry[],
  query: string,
  size: string,
  sort: GallerySort
) {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filtered = entries.filter((entry) => {
    const matchesQuery =
      !normalizedQuery ||
      entry.title.toLocaleLowerCase().includes(normalizedQuery) ||
      entry.sourceLabel.toLocaleLowerCase().includes(normalizedQuery)
    const matchesSize =
      size === 'all' || `${entry.gridSize.width}x${entry.gridSize.height}` === size
    return matchesQuery && matchesSize
  })

  return [...filtered].sort((left, right) => {
    if (sort === 'name') return left.title.localeCompare(right.title, 'zh-CN')
    const delta = Date.parse(right.createdAt) - Date.parse(left.createdAt)
    return sort === 'oldest' ? -delta : delta
  })
}
