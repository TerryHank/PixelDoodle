import type { PaletteColor } from '@/types/api'

export type InventoryOperation = 'in' | 'out' | 'set'
export type InventoryStatusFilter = 'all' | 'in-stock' | 'low' | 'out'
export type InventorySort = 'code' | 'quantity-desc' | 'quantity-asc'

export interface InventoryRow {
  color: PaletteColor
  quantity: number
  status: Exclude<InventoryStatusFilter, 'all'>
}

export function adjustInventoryQuantity(
  current: number,
  operation: InventoryOperation,
  amount: number
) {
  const safeCurrent = Math.max(0, Math.round(Number.isFinite(current) ? current : 0))
  const safeAmount = Math.max(0, Math.round(Number.isFinite(amount) ? amount : 0))
  if (operation === 'set') return safeAmount
  if (operation === 'out') return Math.max(0, safeCurrent - safeAmount)
  return safeCurrent + safeAmount
}

export function inventoryStatus(quantity: number, lowThreshold: number): InventoryRow['status'] {
  if (quantity <= 0) return 'out'
  if (quantity <= lowThreshold) return 'low'
  return 'in-stock'
}

export function filterInventoryRows(
  colors: PaletteColor[],
  quantities: Record<string, number>,
  options: {
    query: string
    status: InventoryStatusFilter
    series: string
    sort: InventorySort
    lowThreshold: number
  }
) {
  const query = options.query.trim().toLocaleLowerCase()
  const rows = colors
    .map<InventoryRow>((color) => {
      const quantity = Math.max(0, Math.round(quantities[color.code] ?? 0))
      return { color, quantity, status: inventoryStatus(quantity, options.lowThreshold) }
    })
    .filter((row) => {
      const matchesQuery =
        !query ||
        row.color.code.toLocaleLowerCase().includes(query) ||
        row.color.name.toLocaleLowerCase().includes(query) ||
        row.color.name_zh.toLocaleLowerCase().includes(query)
      const matchesSeries = options.series === 'all' || row.color.code.startsWith(options.series)
      const matchesStatus = options.status === 'all' || row.status === options.status
      return matchesQuery && matchesSeries && matchesStatus
    })

  return rows.sort((left, right) => {
    if (options.sort === 'quantity-desc') return right.quantity - left.quantity || left.color.code.localeCompare(right.color.code)
    if (options.sort === 'quantity-asc') return left.quantity - right.quantity || left.color.code.localeCompare(right.color.code)
    return left.color.code.localeCompare(right.color.code, undefined, { numeric: true })
  })
}

export function parseInventoryCsv(text: string, knownCodes: Set<string>) {
  const values: Record<string, number> = {}
  const errors: string[] = []
  const seen = new Set<string>()
  text.replace(/^\uFEFF/, '').split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim()
    if (!line || /^colorcode\s*,\s*quantity$/i.test(line)) return
    const [rawCode, rawQuantity, ...extra] = line.split(',').map((item) => item.trim())
    const code = rawCode?.toUpperCase() ?? ''
    const quantity = Number(rawQuantity)
    if (extra.length || !/^[A-Z]+\d+$/.test(code) || !Number.isInteger(quantity) || quantity < 0) {
      errors.push(`第 ${index + 1} 行格式错误`)
    } else if (!knownCodes.has(code)) {
      errors.push(`第 ${index + 1} 行未知色号 ${code}`)
    } else if (seen.has(code)) {
      errors.push(`第 ${index + 1} 行色号 ${code} 重复`)
    } else {
      seen.add(code)
      values[code] = quantity
    }
  })
  return { values, errors }
}

export function buildInventoryCsv(colors: PaletteColor[], quantities: Record<string, number>) {
  const rows = colors.map((color) => `${color.code},${Math.max(0, Math.round(quantities[color.code] ?? 0))}`)
  return `colorCode,quantity\n${rows.join('\n')}\n`
}
