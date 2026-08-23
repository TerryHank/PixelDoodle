import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  access,
  appendFile,
  mkdir,
  readFile,
  rename,
  stat,
  writeFile
} from 'node:fs/promises'
import path from 'node:path'

const ORIGIN = 'https://kandipad.com'
const OUTPUT_ROOT = path.resolve(
  process.env.KANDIPAD_OUTPUT ||
    'D:/Workspace/PixelDoodle/data/external-materials/kandipad'
)
const USER_AGENT =
  'Mozilla/5.0 (compatible; PixelDoodleAuthorizedArchiver/1.0; +local-authorized-archive)'
const GALLERY_CONCURRENCY = Number(process.env.KANDIPAD_GALLERY_CONCURRENCY || 4)
const MATRIX_CONCURRENCY = Number(process.env.KANDIPAD_MATRIX_CONCURRENCY || 8)
const IMAGE_CONCURRENCY = Number(process.env.KANDIPAD_IMAGE_CONCURRENCY || 20)
const REQUEST_TIMEOUT_MS = 60_000

const paths = {
  raw: path.join(OUTPUT_ROOT, 'raw'),
  galleryPages: path.join(OUTPUT_ROOT, 'raw', 'gallery-pages'),
  patterns: path.join(OUTPUT_ROOT, 'patterns'),
  logs: path.join(OUTPUT_ROOT, 'logs'),
  catalogResponse: path.join(OUTPUT_ROOT, 'raw', 'calculate-totals.json'),
  manifest: path.join(OUTPUT_ROOT, 'manifest.jsonl'),
  state: path.join(OUTPUT_ROOT, 'archive-state.json'),
  failures: path.join(OUTPUT_ROOT, 'logs', 'failures.jsonl')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function exists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function ensureDirectories() {
  await Promise.all(
    [OUTPUT_ROOT, paths.raw, paths.galleryPages, paths.patterns, paths.logs].map(
      (directory) => mkdir(directory, { recursive: true })
    )
  )
}

async function atomicWrite(filePath, data) {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.partial-${process.pid}`
  await writeFile(temporaryPath, data)
  await rename(temporaryPath, filePath)
}

async function fetchWithRetry(url, options = {}, retries = 5) {
  let lastError
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'user-agent': USER_AGENT,
          referer: `${ORIGIN}/fuse-bead-patterns`,
          ...(options.headers || {})
        },
        signal: controller.signal
      })
      if (response.ok) {
        return response
      }
      if (response.status < 500 && response.status !== 429) {
        throw new Error(`HTTP ${response.status} ${url}`)
      }
      lastError = new Error(`HTTP ${response.status} ${url}`)
    } catch (error) {
      lastError = error
    } finally {
      clearTimeout(timeout)
    }
    await sleep(Math.min(10_000, 500 * 2 ** (attempt - 1)))
  }
  throw lastError
}

async function downloadToFile(url, filePath) {
  if (await exists(filePath)) {
    const info = await stat(filePath)
    if (info.size > 0) return { skipped: true, bytes: info.size }
  }
  const response = await fetchWithRetry(url)
  const buffer = Buffer.from(await response.arrayBuffer())
  await atomicWrite(filePath, buffer)
  return { skipped: false, bytes: buffer.length }
}

async function mapLimit(items, limit, worker) {
  let cursor = 0
  const runners = Array.from({ length: Math.max(1, limit) }, async () => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      await worker(items[index], index)
    }
  })
  await Promise.all(runners)
}

function decodeHtml(value = '') {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#039;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replace(/<[^>]+>/g, '')
    .trim()
}

function parseGalleryPage(html, pageNumber) {
  const entries = []
  const chunks = html
    .split(/<div class="[^"]*\bgallery-project\b[^"]*" id="project_/)
    .slice(1)
  for (const chunk of chunks) {
    const slug = chunk.match(/^([^"\s]+)"/)?.[1]
    if (!slug) continue
    const pidMatch = chunk.match(/setComments\('(\d+)project_([^']+)'\)/)
    if (!pidMatch || pidMatch[2] !== slug) continue
    const thumbnailMatch = chunk.match(
      /class="thumb"[\s\S]*?<img src="([^"]*\/assets\/images\/projects\/pp\/[^"]+)" alt="([^"]*)"/
    )
    const thumbnailUrl = thumbnailMatch?.[1]
    if (thumbnailUrl?.includes('/feat-')) continue
    const title = decodeHtml(
      chunk.match(/class="project-title"[^>]*>([\s\S]*?)<\/a>/)?.[1] || slug
    )
    const author = decodeHtml(
      chunk.match(/class="project-user"[^>]*>([\s\S]*?)<\/a>/)?.[1] || ''
    )
    const imageAlt = decodeHtml(thumbnailMatch?.[2] || '')
    const tagPrefix = `${title} - `
    const tags = imageAlt.toLowerCase().startsWith(tagPrefix.toLowerCase())
      ? imageAlt
          .slice(tagPrefix.length)
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean)
      : []
    const fullThumbnailUrl = thumbnailUrl
      ? new URL(thumbnailUrl, ORIGIN).toString()
      : null
    const fullImageUrl = fullThumbnailUrl
      ? fullThumbnailUrl
          .replace('/projects/pp/', '/projects/pp/full/')
          .replace('/projects/pp/full/feat-', '/projects/pp/full/')
      : null
    entries.push({
      pid: Number(pidMatch[1]),
      slug,
      title,
      author,
      imageAlt,
      tags,
      detailUrl: `${ORIGIN}/pattern/${slug}`,
      thumbnailUrl: fullThumbnailUrl,
      fullImageUrl,
      sourcePage: pageNumber
    })
  }
  return entries
}

async function fetchCatalogResponse() {
  if (!(await exists(paths.catalogResponse))) {
    const response = await fetchWithRetry(`${ORIGIN}/gallery/calculate-totals`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'x-requested-with': 'XMLHttpRequest'
      },
      body: new URLSearchParams({ search: '', sort: 'trending' })
    })
    await atomicWrite(paths.catalogResponse, await response.text())
  }
  return JSON.parse(await readFile(paths.catalogResponse, 'utf8'))
}

async function buildManifest() {
  const totals = await fetchCatalogResponse()
  const fuseCount = Number(totals.fuse?.count || 0)
  const pageCount = Math.ceil(fuseCount / 60)
  console.log(`KandiPad catalog reports ${fuseCount} fuse patterns across ${pageCount} pages`)

  const pages = Array.from({ length: pageCount }, (_, index) => index + 1)
  let completedPages = 0
  await mapLimit(pages, GALLERY_CONCURRENCY, async (pageNumber) => {
    const filePath = path.join(
      paths.galleryPages,
      `${String(pageNumber).padStart(4, '0')}.html`
    )
    if (!(await exists(filePath))) {
      const url =
        pageNumber === 1
          ? `${ORIGIN}/fuse-bead-patterns`
          : `${ORIGIN}/fuse-bead-patterns/${pageNumber}`
      const response = await fetchWithRetry(url)
      await atomicWrite(filePath, await response.text())
    }
    completedPages += 1
    if (completedPages % 25 === 0 || completedPages === pageCount) {
      console.log(`gallery pages ${completedPages}/${pageCount}`)
    }
  })

  const byPid = new Map()
  const gallerySources = [
    { mode: 'trending', directory: paths.galleryPages },
    { mode: 'recent', directory: path.join(paths.raw, 'gallery-pages-recent') },
    { mode: 'popular', directory: path.join(paths.raw, 'gallery-pages-popular') }
  ]
  for (const source of gallerySources) {
    if (!(await exists(source.directory))) continue
    for (const pageNumber of pages) {
      const filePath = path.join(
        source.directory,
        `${String(pageNumber).padStart(4, '0')}.html`
      )
      if (!(await exists(filePath))) continue
      const html = await readFile(filePath, 'utf8')
      for (const entry of parseGalleryPage(html, pageNumber)) {
        const previous = byPid.get(entry.pid)
        byPid.set(entry.pid, {
          ...(previous || entry),
          sourcePages: [
            ...(previous?.sourcePages || []),
            { mode: source.mode, page: pageNumber }
          ]
        })
      }
    }
  }

  const entries = [...byPid.values()].sort((left, right) => left.pid - right.pid)
  await atomicWrite(
    paths.manifest,
    `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`
  )
  await atomicWrite(
    paths.state,
    JSON.stringify(
      {
        source: `${ORIGIN}/fuse-bead-patterns`,
        archivedAt: new Date().toISOString(),
        reportedFuseCount: fuseCount,
        discoveredPatterns: entries.length,
        pageCount
      },
      null,
      2
    )
  )
  console.log(`manifest contains ${entries.length} unique fuse patterns`)
  return entries
}

async function loadManifest() {
  if (!(await exists(paths.manifest))) return buildManifest()
  return (await readFile(paths.manifest, 'utf8'))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function patternDirectory(entry) {
  const shard = String(entry.pid % 100).padStart(2, '0')
  return path.join(paths.patterns, shard, String(entry.pid))
}

async function recordFailure(stage, entry, error) {
  await appendFile(
    paths.failures,
    `${JSON.stringify({
      at: new Date().toISOString(),
      stage,
      pid: entry?.pid,
      slug: entry?.slug,
      error: error instanceof Error ? error.message : String(error)
    })}\n`
  )
}

async function archiveMatrices(entries) {
  let completed = 0
  await mapLimit(entries, MATRIX_CONCURRENCY, async (entry) => {
    const directory = patternDirectory(entry)
    const matrixPath = path.join(directory, 'matrix.json')
    const metadataPath = path.join(directory, 'metadata.json')
    try {
      await mkdir(directory, { recursive: true })
      if (!(await exists(metadataPath))) {
        await atomicWrite(metadataPath, JSON.stringify(entry, null, 2))
      }
      if (!(await exists(matrixPath))) {
        const response = await fetchWithRetry(`${ORIGIN}/pattern/get-matrix`, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'x-requested-with': 'XMLHttpRequest'
          },
          body: new URLSearchParams({ pid: String(entry.pid) })
        })
        const raw = await response.text()
        if (raw === 'bad') throw new Error('matrix endpoint returned bad')
        JSON.parse(raw)
        await atomicWrite(matrixPath, raw)
      }
    } catch (error) {
      await recordFailure('matrix', entry, error)
    }
    completed += 1
    if (completed % 250 === 0 || completed === entries.length) {
      console.log(`matrices ${completed}/${entries.length}`)
    }
  })
}

async function archiveImages(entries) {
  const jobs = []
  for (const entry of entries) {
    const directory = patternDirectory(entry)
    if (entry.thumbnailUrl) {
      jobs.push({
        stage: 'thumbnail',
        entry,
        url: entry.thumbnailUrl,
        filePath: path.join(directory, path.basename(new URL(entry.thumbnailUrl).pathname))
      })
    }
    if (entry.fullImageUrl) {
      jobs.push({
        stage: 'full-image',
        entry,
        url: entry.fullImageUrl,
        filePath: path.join(
          directory,
          `full-${path.basename(new URL(entry.fullImageUrl).pathname)}`
        )
      })
    }
  }

  let completed = 0
  await mapLimit(jobs, IMAGE_CONCURRENCY, async (job) => {
    try {
      await downloadToFile(job.url, job.filePath)
    } catch (error) {
      await recordFailure(job.stage, job.entry, error)
    }
    completed += 1
    if (completed % 500 === 0 || completed === jobs.length) {
      console.log(`images ${completed}/${jobs.length}`)
    }
  })
}

async function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

async function main() {
  await ensureDirectories()
  const phase = process.argv[2] || 'all'
  const entries = phase === 'catalog' ? await buildManifest() : await loadManifest()

  if (phase === 'catalog') return
  if (phase === 'matrices' || phase === 'all') await archiveMatrices(entries)
  if (phase === 'images' || phase === 'all') await archiveImages(entries)

  const state = JSON.parse(await readFile(paths.state, 'utf8'))
  state.completedAt = new Date().toISOString()
  state.manifestSha256 = await sha256(paths.manifest)
  await atomicWrite(paths.state, JSON.stringify(state, null, 2))
  console.log(`archive phase ${phase} complete`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
