import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { MaterialGalleryWork } from '@/types/material-library'

interface OfflineGalleryPackage {
  schemaVersion: number
  archiveTotal: number
  bundledTotal: number
  archiveCatalogSha256: string
  boardSizes: Array<{ width: number; height: number }>
  sources: string[]
  categories: string[]
  works: MaterialGalleryWork[]
}

function readOfflineGallery() {
  const filePath = fileURLToPath(
    new URL('../../static/gallery/offline-materials-v1.json', import.meta.url)
  )
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as OfflineGalleryPackage
}

describe('bundled offline material gallery', () => {
  it('contains 1,200 valid unique works across all six board tiers', () => {
    const gallery = readOfflineGallery()

    expect(gallery.schemaVersion).toBe(1)
    expect(gallery.archiveTotal).toBe(64268)
    expect(gallery.bundledTotal).toBe(1200)
    expect(gallery.works).toHaveLength(1200)
    expect(new Set(gallery.works.map((work) => work.id)).size).toBe(1200)
    expect(gallery.sources).toHaveLength(5)
    expect(gallery.categories).toHaveLength(12)
    expect(gallery.archiveCatalogSha256).toMatch(/^[a-f0-9]{64}$/)

    const previousBoards: Array<{ width: number; height: number }> = []
    for (const board of gallery.boardSizes) {
      const tierWorks = gallery.works.filter(
        (work) =>
          work.width <= board.width &&
          work.height <= board.height &&
          !previousBoards.some(
            (previous) =>
              work.width <= previous.width && work.height <= previous.height
          )
      )
      expect(tierWorks).toHaveLength(200)
      previousBoards.push(board)
    }

    for (const work of gallery.works) {
      expect(work.palette.length).toBe(work.keys.length)
      expect(work.grid).toHaveLength(work.width * work.height * 2)
    }
  })
})
