import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const sourceRoot = path.resolve(
  scriptDirectory,
  '../../perler-beads/data/gallery'
)
const outputPath = path.resolve(
  scriptDirectory,
  '../static/gallery/offline-materials-v1.json'
)

const sources = [
  'beadshub',
  'pindou-fun',
  'pindou-io',
  'pindoule',
  'kandipad'
]
const categories = [
  '宝可梦',
  '动漫',
  '游戏',
  '卡通',
  '影视',
  '动物',
  '节日',
  '食物',
  '植物自然',
  '文字标志',
  '人物',
  '其他'
]
const boardTiers = [
  { width: 29, height: 29 },
  { width: 32, height: 32 },
  { width: 52, height: 52 },
  { width: 78, height: 78 },
  { width: 104, height: 74 },
  { width: 104, height: 104 }
]
const worksPerBoardTier = 200
const blockedContentPattern =
  /(?:^|[^a-z])(fuck|shit|bitch|dick|sex|porn|cursing)(?:[^a-z]|$)|混蛋|性爱|色情|诅咒/i

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function fitsBoard(item, board) {
  return item.width <= board.width && item.height <= board.height
}

function isFamilySafe(value) {
  return !blockedContentPattern.test(String(value || ''))
}

function rank(item, seed) {
  return Math.imul((item.id ^ seed) >>> 0, 2654435761) >>> 0
}

function buildPools(items, seed) {
  const pools = new Map()
  for (const category of categories) {
    const sourcePools = new Map()
    for (const source of sources) {
      sourcePools.set(
        source,
        items
          .filter((item) => item.category === category && item.source === source)
          .sort((left, right) => rank(left, seed) - rank(right, seed))
      )
    }
    pools.set(category, sourcePools)
  }
  return pools
}

function takeBalanced(items, count, seed, selectedIds) {
  const result = []
  const pools = buildPools(items, seed)
  const baseQuota = Math.floor(count / categories.length)
  const remainder = count % categories.length

  categories.forEach((category, categoryIndex) => {
    const target = baseQuota + (categoryIndex < remainder ? 1 : 0)
    const categoryPools = pools.get(category)
    let sourceIndex = (seed + categoryIndex) % sources.length

    while (result.filter((item) => item.category === category).length < target) {
      let added = false
      for (let offset = 0; offset < sources.length; offset += 1) {
        const source = sources[(sourceIndex + offset) % sources.length]
        const pool = categoryPools.get(source)
        while (pool.length && selectedIds.has(pool[0].id)) pool.shift()
        const item = pool.shift()
        if (!item) continue
        selectedIds.add(item.id)
        result.push(item)
        sourceIndex = (sourceIndex + offset + 1) % sources.length
        added = true
        break
      }
      if (!added) break
    }
  })

  if (result.length < count) {
    const remaining = items
      .filter((item) => !selectedIds.has(item.id))
      .sort((left, right) => rank(left, seed + 7919) - rank(right, seed + 7919))
    for (const item of remaining) {
      selectedIds.add(item.id)
      result.push(item)
      if (result.length >= count) break
    }
  }

  return result
}

function loadWork(item) {
  const workPath = path.resolve(sourceRoot, item.workPath)
  if (!workPath.startsWith(`${sourceRoot}${path.sep}`)) {
    throw new Error(`Unsafe gallery work path: ${item.workPath}`)
  }
  const work = readJson(workPath)
  const expectedGridLength = work.width * work.height * 2
  if (
    (work.v !== 1 && work.v !== 2) ||
    work.access !== 'public' ||
    !Array.isArray(work.palette) ||
    !Array.isArray(work.keys) ||
    work.palette.length !== work.keys.length ||
    typeof work.grid !== 'string' ||
    work.grid.length !== expectedGridLength
  ) {
    throw new Error(`Invalid gallery work: ${item.id}`)
  }

  return {
    ...work,
    id: item.id,
    title: item.title,
    createdAt: item.createdAt,
    source: item.source,
    category: item.category,
    tags: [...new Set(item.tags)]
      .map((tag) => String(tag).trim())
      .filter((tag) => tag && tag.length <= 32 && isFamilySafe(tag))
      .slice(0, 24)
  }
}

const catalog = readJson(path.join(sourceRoot, 'catalog.json')).filter(
  (item) =>
    item.access === 'public' &&
    isFamilySafe(item.title) &&
    sources.includes(item.source) &&
    categories.includes(item.category)
)
const buildReport = readJson(path.join(sourceRoot, 'build-report.json'))
const selectedIds = new Set()
const selectedItems = []

boardTiers.forEach((board, boardIndex) => {
  const previousBoards = boardTiers.slice(0, boardIndex)
  const tierItems = catalog.filter(
    (item) =>
      !selectedIds.has(item.id) &&
      fitsBoard(item, board) &&
      !previousBoards.some((previousBoard) => fitsBoard(item, previousBoard))
  )
  const selectedForTier = takeBalanced(
    tierItems,
    worksPerBoardTier,
    1009 + boardIndex * 101,
    selectedIds
  )

  if (selectedForTier.length < worksPerBoardTier) {
    selectedForTier.push(
      ...takeBalanced(
        catalog.filter(
          (item) => !selectedIds.has(item.id) && fitsBoard(item, board)
        ),
        worksPerBoardTier - selectedForTier.length,
        2003 + boardIndex * 103,
        selectedIds
      )
    )
  }

  if (selectedForTier.length !== worksPerBoardTier) {
    throw new Error(
      `Could not select ${worksPerBoardTier} works for ${board.width}x${board.height}`
    )
  }
  selectedItems.push(...selectedForTier)
})

const works = selectedItems
  .map(loadWork)
  .sort((left, right) => rank(left, 424242) - rank(right, 424242))
const payload = {
  schemaVersion: 1,
  archiveCatalogSha256: buildReport.catalogSha256,
  archiveTotal: buildReport.catalogCount,
  bundledTotal: works.length,
  boardSizes: boardTiers,
  sources,
  categories,
  rightsNote:
    '归档依据已记录的来源授权生成；保留 source、category 与 tags 供溯源。',
  works
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, `${JSON.stringify(payload)}\n`, 'utf8')

const sourceCounts = Object.fromEntries(
  sources.map((source) => [source, works.filter((work) => work.source === source).length])
)
const categoryCounts = Object.fromEntries(
  categories.map((category) => [
    category,
    works.filter((work) => work.category === category).length
  ])
)

console.log(
  JSON.stringify(
    {
      outputPath,
      bytes: fs.statSync(outputPath).size,
      archiveTotal: payload.archiveTotal,
      bundledTotal: payload.bundledTotal,
      sourceCounts,
      categoryCounts
    },
    null,
    2
  )
)
