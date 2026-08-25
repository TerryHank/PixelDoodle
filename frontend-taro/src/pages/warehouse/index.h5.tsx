import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { AppTabBar } from '@/components/app-tab-bar'
import { fileAdapter } from '@/adapters/file'
import {
  buildInventoryCsv,
  filterInventoryRows,
  parseInventoryCsv,
  type InventoryOperation,
  type InventorySort,
  type InventoryStatusFilter
} from '@/features/bead-warehouse/model'
import { usePatternStore } from '@/store/pattern-store'
import { useWarehouseStore } from '@/store/warehouse-store'
import './index.scss'

export default function WarehousePageH5() {
  const colors = usePatternStore((state) => state.fullPaletteList)
  const loadPalette = usePatternStore((state) => state.loadPalette)
  const quantities = useWarehouseStore((state) => state.quantities)
  const lowThreshold = useWarehouseStore((state) => state.lowThreshold)
  const beadsPerGram = useWarehouseStore((state) => state.beadsPerGram)
  const adjust = useWarehouseStore((state) => state.adjust)
  const importValues = useWarehouseStore((state) => state.importValues)
  const setLowThreshold = useWarehouseStore((state) => state.setLowThreshold)
  const setBeadsPerGram = useWarehouseStore((state) => state.setBeadsPerGram)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<InventoryStatusFilter>('all')
  const [series, setSeries] = useState('all')
  const [sort, setSort] = useState<InventorySort>('code')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [selectedCode, setSelectedCode] = useState('')
  const [operation, setOperation] = useState<InventoryOperation>('in')
  const [unit, setUnit] = useState<'bead' | 'gram'>('bead')
  const [amount, setAmount] = useState('100')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!colors.length) void loadPalette()
  }, [colors.length, loadPalette])

  useEffect(() => {
    if (!selectedCode && colors[0]) setSelectedCode(colors[0].code)
  }, [colors, selectedCode])

  const seriesOptions = useMemo(
    () => ['all', ...Array.from(new Set(colors.map((color) => color.code.match(/^[A-Z]+/)?.[0]).filter(Boolean) as string[]))],
    [colors]
  )
  const rows = useMemo(() => filterInventoryRows(colors, quantities, {
    query, status, series, sort, lowThreshold
  }), [colors, lowThreshold, quantities, query, series, sort, status])
  const total = Object.values(quantities).reduce((sum, value) => sum + Math.max(0, value), 0)
  const managed = Object.values(quantities).filter((value) => value > 0).length

  function submitAdjustment() {
    const numericAmount = Number(amount)
    if (!selectedCode || !Number.isFinite(numericAmount) || numericAmount < 0) {
      setMessage('请选择色号并输入非负数量')
      return
    }
    adjust(selectedCode, operation, numericAmount, unit)
    setMessage(`${selectedCode} 库存已更新`)
  }

  async function importCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const result = parseInventoryCsv(await file.text(), new Set(colors.map((color) => color.code)))
    if (result.errors.length) {
      setMessage(result.errors.slice(0, 3).join('；'))
      return
    }
    importValues(result.values)
    setMessage(`已导入 ${Object.keys(result.values).length} 个色号`)
  }

  async function exportCsv() {
    const csv = buildInventoryCsv(colors, quantities)
    await fileAdapter.saveBinaryFile(
      `DIY拼豆-豆仓-${new Date().toISOString().slice(0, 10)}.csv`,
      'text/csv;charset=utf-8',
      new TextEncoder().encode(`\uFEFF${csv}`).buffer
    )
    setMessage('豆仓 CSV 已导出')
  }

  return (
    <main className='warehouse-page'>
      <div className='warehouse-page__content'>
        <header className='warehouse-page__heading'>
          <span>离线库存管理</span>
          <h1>豆仓</h1>
          <p>按色号管理入库、出库、盘点和缺货预警，数据保存在当前设备。</p>
        </header>

        <section className='warehouse-summary' aria-label='豆仓总览'>
          <strong>{managed}</strong><span>有库存色号</span>
          <strong>{total}</strong><span>库存总豆数</span>
          <strong>{rows.filter((row) => row.status === 'low' || row.status === 'out').length}</strong><span>当前筛选预警</span>
        </section>

        <section className='warehouse-adjust' aria-label='库存调整'>
          <h2>库存调整</h2>
          <select className='warehouse-control' aria-label='调整色号' value={selectedCode} onChange={(event) => setSelectedCode(event.target.value)}>
            {colors.map((color) => <option key={color.code} value={color.code}>{color.code} · {color.name_zh || color.name}</option>)}
          </select>
          <select className='warehouse-control' aria-label='调整类型' value={operation} onChange={(event) => setOperation(event.target.value as InventoryOperation)}>
            <option value='in'>入库</option><option value='out'>出库</option><option value='set'>盘点校准</option>
          </select>
          <input className='warehouse-control' aria-label='调整数量' min='0' step='1' type='number' value={amount} onChange={(event) => setAmount(event.target.value)} />
          <select className='warehouse-control' aria-label='数量单位' value={unit} onChange={(event) => setUnit(event.target.value as 'bead' | 'gram')}>
            <option value='bead'>颗</option><option value='gram'>克</option>
          </select>
          <button className='warehouse-control' type='button' onClick={submitAdjustment}>确认调整</button>
          <label className='warehouse-adjust__label'>低库存阈值<input className='warehouse-control' aria-label='低库存阈值' min='0' type='number' value={lowThreshold} onChange={(event) => setLowThreshold(Number(event.target.value))} /></label>
          <label className='warehouse-adjust__label'>每克豆数<input className='warehouse-control' aria-label='每克豆数' min='1' type='number' value={beadsPerGram} onChange={(event) => setBeadsPerGram(Number(event.target.value))} /></label>
          <label className='warehouse-file'>导入 CSV<input aria-label='导入库存 CSV' accept='.csv,text/csv' type='file' onChange={(event) => void importCsv(event)} /></label>
          <button className='warehouse-control' type='button' onClick={() => void exportCsv()}>导出 CSV</button>
          {message ? <p role='status'>{message}</p> : null}
        </section>

        <section className='warehouse-filters' aria-label='库存筛选'>
          <input className='warehouse-control' aria-label='搜索库存色号' placeholder='搜索色号或颜色名' value={query} onChange={(event) => setQuery(event.target.value)} />
          <select className='warehouse-control' aria-label='库存状态' value={status} onChange={(event) => setStatus(event.target.value as InventoryStatusFilter)}>
            <option value='all'>全部状态</option><option value='in-stock'>有库存</option><option value='low'>库存偏低</option><option value='out'>已耗尽</option>
          </select>
          <select className='warehouse-control' aria-label='色号系列' value={series} onChange={(event) => setSeries(event.target.value)}>
            {seriesOptions.map((item) => <option key={item} value={item}>{item === 'all' ? '全部系列' : `${item} 系列`}</option>)}
          </select>
          <select className='warehouse-control' aria-label='库存排序' value={sort} onChange={(event) => setSort(event.target.value as InventorySort)}>
            <option value='code'>色号排序</option><option value='quantity-desc'>库存从多到少</option><option value='quantity-asc'>库存从少到多</option>
          </select>
          <button className='warehouse-control' aria-pressed={view === 'grid'} type='button' onClick={() => setView('grid')}>网格</button>
          <button className='warehouse-control' aria-pressed={view === 'list'} type='button' onClick={() => setView('list')}>列表</button>
        </section>

        <section className={`warehouse-list warehouse-list--${view}`} aria-label='豆仓库存列表'>
          {rows.map((row) => (
            <article className={`warehouse-color warehouse-color--${row.status}`} key={row.color.code}>
              <span className='warehouse-color__swatch' style={{ backgroundColor: row.color.hex }} />
              <strong>{row.color.code}</strong>
              <span>{row.color.name_zh || row.color.name}</span>
              <b>{row.quantity} 颗</b>
              <small>{row.status === 'out' ? '已耗尽' : row.status === 'low' ? '库存偏低' : '有库存'}</small>
            </article>
          ))}
        </section>
      </div>
      <AppTabBar current='warehouse' />
    </main>
  )
}
