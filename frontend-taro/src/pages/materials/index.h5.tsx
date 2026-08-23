import Taro from '@tarojs/taro'
import { memo, useEffect, useRef, useState, type FormEvent } from 'react'
import { AppTabBar } from '@/components/app-tab-bar'
import {
  MATERIAL_CATEGORY_OPTIONS,
  MATERIAL_SOURCE_OPTIONS,
  buildMaterialPatternImport,
  decodeMaterialPaletteIndices,
  getMaterialSourceLabel
} from '@/features/material-library/model'
import {
  BOARD_SIZE_OPTIONS,
  getPresetColors,
  getBoardSize
} from '@/features/pixel-editor/model'
import {
  getMaterialGalleryWork,
  listMaterialGallery
} from '@/services/material-library-service'
import {
  applyMaterialPatternImport,
  savePendingMaterialImport
} from '@/services/material-pattern-import'
import { usePatternStore } from '@/store/pattern-store'
import type { MaterialGalleryWork } from '@/types/material-library'
import './index.h5.scss'

const PAGE_SIZE = 20

interface MaterialPreviewCanvasProps {
  work: MaterialGalleryWork
}

const MaterialPreviewCanvas = memo(function MaterialPreviewCanvas({
  work
}: MaterialPreviewCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) {
      return
    }

    canvas.width = work.width
    canvas.height = work.height
    context.clearRect(0, 0, work.width, work.height)
    context.imageSmoothingEnabled = false

    try {
      const matrix = decodeMaterialPaletteIndices(work)
      for (let y = 0; y < matrix.length; y += 1) {
        const row = matrix[y]
        for (let x = 0; x < row.length; x += 1) {
          const paletteIndex = row[x]
          if (paletteIndex === null) {
            continue
          }
          context.fillStyle = work.palette[paletteIndex]
          context.fillRect(x, y, 1, 1)
        }
      }
    } catch {
      context.fillStyle = '#CBD5E1'
      context.fillRect(0, 0, work.width, work.height)
    }
  }, [work])

  return (
    <canvas
      ref={canvasRef}
      className='material-card__canvas'
      role='img'
      aria-label={`${work.title} 拼豆图纸预览`}
    />
  )
})

function initialBoardId() {
  const current = usePatternStore.getState().boardSize
  return (
    BOARD_SIZE_OPTIONS.find(
      (item) => item.width === current.width && item.height === current.height
    )?.id ?? BOARD_SIZE_OPTIONS[0].id
  )
}

export default function MaterialsPageH5() {
  const [works, setWorks] = useState<MaterialGalleryWork[]>([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [page, setPage] = useState(1)
  const [queryInput, setQueryInput] = useState('')
  const [query, setQuery] = useState('')
  const [source, setSource] = useState('')
  const [category, setCategory] = useState('')
  const [boardId, setBoardId] = useState(initialBoardId)
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [applyingId, setApplyingId] = useState<number | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const selectedBoard = getBoardSize(boardId)

  useEffect(() => {
    let active = true
    setIsLoading(true)
    setErrorMessage('')

    void listMaterialGallery({
      page,
      perPage: PAGE_SIZE,
      query,
      source,
      category,
      boardSize: selectedBoard
    }).then(
      (response) => {
        if (!active) return
        setWorks(response.works)
        setTotal(response.total)
        setHasMore(response.hasMore)
        setIsLoading(false)
      },
      (error) => {
        if (!active) return
        setWorks([])
        setTotal(0)
        setHasMore(false)
        setErrorMessage(error instanceof Error ? error.message : '素材库加载失败')
        setIsLoading(false)
      }
    )

    return () => {
      active = false
    }
  }, [boardId, category, page, query, reloadToken, source])

  function commitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPage(1)
    setQuery(queryInput.trim())
  }

  async function applyMaterial(workId: number) {
    if (applyingId !== null) {
      return
    }

    setApplyingId(workId)
    Taro.showLoading({ title: '正在适配钉板...' })
    try {
      const response = await getMaterialGalleryWork(workId)
      let patternState = usePatternStore.getState()
      if (patternState.fullPaletteList.length === 0) {
        await patternState.loadPalette()
        patternState = usePatternStore.getState()
      }

      const targetColors = getPresetColors(
        patternState.fullPaletteList,
        patternState.presets,
        patternState.palettePreset
      )
      const payload = buildMaterialPatternImport(response.work, {
        boardSize: selectedBoard,
        colors: targetColors,
        palettePreset: patternState.palettePreset
      })
      savePendingMaterialImport(payload)
      applyMaterialPatternImport(payload)
      await Taro.redirectTo({
        url: '/pages/home/index?materialImport=1'
      })
    } catch (error) {
      Taro.showToast({
        title: error instanceof Error ? error.message : '素材套用失败',
        icon: 'none',
        duration: 2600
      })
    } finally {
      Taro.hideLoading()
      setApplyingId(null)
    }
  }

  return (
    <main className='materials-page'>
      <div className='materials-page__shell'>
        <header className='materials-hero'>
          <button
            className='materials-hero__back'
            type='button'
            onClick={() => Taro.redirectTo({ url: '/pages/home/index' })}
          >
            ← 返回创作
          </button>
          <div>
            <span className='materials-hero__eyebrow'>PixelDoodle Materials</span>
            <h1>全尺寸拼豆素材库</h1>
            <p>搜索已量化图纸，选择目标钉板后可直接套用并继续编辑。</p>
          </div>
        </header>

        <form className='materials-filters' onSubmit={commitSearch}>
          <label className='materials-field materials-field--search'>
            <span>关键词</span>
            <input
              value={queryInput}
              onChange={(event) => setQueryInput(event.target.value)}
              placeholder='搜索标题、分类或标签，如：皮卡丘'
              type='search'
            />
          </label>
          <label className='materials-field'>
            <span>来源</span>
            <select
              value={source}
              onChange={(event) => {
                setSource(event.target.value)
                setPage(1)
              }}
            >
              <option value=''>全部来源</option>
              {MATERIAL_SOURCE_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
          <label className='materials-field'>
            <span>分类</span>
            <select
              value={category}
              onChange={(event) => {
                setCategory(event.target.value)
                setPage(1)
              }}
            >
              <option value=''>全部分类</option>
              {MATERIAL_CATEGORY_OPTIONS.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </label>
          <label className='materials-field'>
            <span>目标钉板</span>
            <select
              value={boardId}
              onChange={(event) => {
                setBoardId(event.target.value)
                setPage(1)
              }}
            >
              {BOARD_SIZE_OPTIONS.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </label>
          <button className='materials-filters__submit' type='submit'>搜索素材</button>
        </form>

        <div className='materials-summary' aria-live='polite'>
          <span>{isLoading ? '正在读取素材库…' : `找到 ${total.toLocaleString()} 张可适配图纸`}</span>
          <span>目标 {selectedBoard.label} · 第 {page} 页</span>
        </div>

        {isLoading ? (
          <div className='materials-state'>正在加载并绘制拼豆图纸…</div>
        ) : errorMessage ? (
          <div className='materials-state materials-state--error'>
            <strong>素材库暂时无法加载</strong>
            <span>{errorMessage}</span>
            <button type='button' onClick={() => setReloadToken((value) => value + 1)}>重试</button>
          </div>
        ) : works.length === 0 ? (
          <div className='materials-state'>没有符合当前条件的图纸</div>
        ) : (
          <section className='materials-grid' aria-label='拼豆素材结果'>
            {works.map((work) => (
              <article className='material-card' key={`${work.source}:${work.id}`}>
                <div className='material-card__preview'>
                  <MaterialPreviewCanvas work={work} />
                </div>
                <div className='material-card__body'>
                  <h2 title={work.title}>{work.title}</h2>
                  <div className='material-card__meta'>
                    <span>{work.width} × {work.height}</span>
                    <span>{work.palette.length} 色</span>
                  </div>
                  <div className='material-card__badges'>
                    <span className='material-card__category'>{work.category}</span>
                    {work.tags
                      .filter((tag) => tag !== work.category)
                      .slice(0, 2)
                      .map((tag) => (
                        <span className='material-card__tag' key={tag}>{tag}</span>
                      ))}
                  </div>
                  <div className='material-card__source'>{getMaterialSourceLabel(work.source)}</div>
                  <button
                    className='material-card__apply'
                    type='button'
                    disabled={applyingId !== null}
                    onClick={() => void applyMaterial(work.id)}
                  >
                    {applyingId === work.id
                      ? '正在套用…'
                      : `套用到 ${selectedBoard.label} 并编辑`}
                  </button>
                </div>
              </article>
            ))}
          </section>
        )}

        <nav className='materials-pagination' aria-label='素材分页'>
          <button
            type='button'
            disabled={page <= 1 || isLoading}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
          >
            上一页
          </button>
          <span>第 {page} 页</span>
          <button
            type='button'
            disabled={!hasMore || isLoading}
            onClick={() => setPage((value) => value + 1)}
          >
            下一页
          </button>
        </nav>
      </div>
      <AppTabBar current='materials' />
    </main>
  )
}
