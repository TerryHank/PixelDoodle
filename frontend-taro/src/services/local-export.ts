import type { ColorSummaryItem, PixelMatrix } from '@/types/api'

type ExportKind = 'png' | 'pdf' | 'json'

interface ExportPayload {
  pixel_matrix?: PixelMatrix
  color_data?: Record<string, string>
  color_summary?: Array<Partial<ColorSummaryItem>>
  cell_size?: number
  show_grid?: boolean
  show_codes_in_cells?: boolean
  show_coordinates?: boolean
  palette_preset?: string
}

interface Raster {
  width: number
  height: number
  data: Uint8Array
}

const MAX_RASTER_EDGE = 4096

function encodeUtf8(value: string) {
  const bytes: number[] = []
  for (let index = 0; index < value.length; index += 1) {
    let codePoint = value.charCodeAt(index)
    if (codePoint >= 0xd800 && codePoint <= 0xdbff && index + 1 < value.length) {
      const low = value.charCodeAt(index + 1)
      if (low >= 0xdc00 && low <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (low - 0xdc00)
        index += 1
      }
    }

    if (codePoint <= 0x7f) {
      bytes.push(codePoint)
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f))
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f)
      )
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f)
      )
    }
  }
  return new Uint8Array(bytes)
}

const FONT: Record<string, string[]> = {
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  ':': ['00000', '00100', '00100', '00000', '00100', '00100', '00000'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  J: ['00001', '00001', '00001', '00001', '10001', '10001', '01110'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111']
}

function concatBytes(parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer
}

function assertMatrix(payload: ExportPayload): PixelMatrix {
  if (!Array.isArray(payload.pixel_matrix) || payload.pixel_matrix.length === 0) {
    throw new Error('pixel_matrix is required')
  }
  return payload.pixel_matrix
}

function parseHex(value: string | undefined): [number, number, number] {
  const match = String(value ?? '').match(/^#?([\da-f]{6})$/i)
  if (!match) {
    return [230, 230, 230]
  }
  const number = Number.parseInt(match[1], 16)
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255]
}

function fillRect(
  raster: Raster,
  x: number,
  y: number,
  width: number,
  height: number,
  color: [number, number, number]
) {
  const startX = Math.max(0, Math.floor(x))
  const startY = Math.max(0, Math.floor(y))
  const endX = Math.min(raster.width, Math.ceil(x + width))
  const endY = Math.min(raster.height, Math.ceil(y + height))
  for (let row = startY; row < endY; row += 1) {
    for (let column = startX; column < endX; column += 1) {
      const offset = (row * raster.width + column) * 3
      raster.data[offset] = color[0]
      raster.data[offset + 1] = color[1]
      raster.data[offset + 2] = color[2]
    }
  }
}

function drawText(
  raster: Raster,
  text: string,
  x: number,
  y: number,
  color: [number, number, number],
  scale = 1
) {
  let cursor = x
  for (const rawCharacter of text.toUpperCase()) {
    const glyph = FONT[rawCharacter] ?? FONT[' ']
    glyph.forEach((row, rowIndex) => {
      for (let column = 0; column < row.length; column += 1) {
        if (row[column] === '1') {
          fillRect(raster, cursor + column * scale, y + rowIndex * scale, scale, scale, color)
        }
      }
    })
    cursor += 6 * scale
  }
}

function drawCenteredText(
  raster: Raster,
  text: string,
  centerX: number,
  centerY: number,
  color: [number, number, number],
  scale = 1
) {
  const width = Math.max(0, text.length * 6 - 1) * scale
  drawText(raster, text, Math.round(centerX - width / 2), Math.round(centerY - 3.5 * scale), color, scale)
}

function renderPattern(payload: ExportPayload): Raster {
  const matrix = assertMatrix(payload)
  const rows = matrix.length
  const columns = Math.max(...matrix.map((row) => row.length), 0)
  const showCoordinates = payload.show_coordinates !== false
  const showCodes = payload.show_codes_in_cells !== false
  const showGrid = payload.show_grid !== false
  const summary = Array.isArray(payload.color_summary) ? payload.color_summary : []
  const gutter = showCoordinates ? 28 : 0
  const outer = 8
  const legendWidth = summary.length ? 180 : 0
  const requestedCellSize = Math.max(1, Math.floor(Number(payload.cell_size) || 20))
  const maxCellWidth = Math.floor(
    (MAX_RASTER_EDGE - outer * 2 - gutter - legendWidth) / Math.max(columns, 1)
  )
  const maxCellHeight = Math.floor(
    (MAX_RASTER_EDGE - outer * 2 - gutter) / Math.max(rows, 1)
  )
  const cellSize = Math.max(1, Math.min(requestedCellSize, maxCellWidth, maxCellHeight))
  const gridX = outer + gutter
  const gridY = outer + gutter
  const gridWidth = columns * cellSize
  const gridHeight = rows * cellSize
  const legendHeight = summary.length ? 28 + summary.length * 14 : 0
  const width = Math.max(1, gridX + gridWidth + legendWidth + outer)
  const height = Math.max(1, gridY + gridHeight + outer, outer + legendHeight)
  const raster: Raster = {
    width,
    height,
    data: new Uint8Array(width * height * 3).fill(255)
  }
  const colorData = payload.color_data ?? Object.fromEntries(
    summary.filter((item) => item.code).map((item) => [String(item.code), String(item.hex ?? '')])
  )

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const code = matrix[row]?.[column] ?? null
      const x = gridX + column * cellSize
      const y = gridY + row * cellSize
      const rgb = code ? parseHex(colorData[code]) : ((row + column) % 2 ? [245, 245, 245] : [224, 224, 224]) as [number, number, number]
      fillRect(raster, x, y, cellSize, cellSize, rgb)

      if (showGrid && cellSize > 2) {
        fillRect(raster, x, y, cellSize, 1, [80, 80, 80])
        fillRect(raster, x, y, 1, cellSize, [80, 80, 80])
      }

      if (showCodes && code && cellSize >= 10) {
        const maxScale = Math.floor((cellSize - 2) / Math.max(code.length * 6 - 1, 7))
        if (maxScale >= 1) {
          const textColor: [number, number, number] =
            rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114 > 145
              ? [20, 20, 20]
              : [255, 255, 255]
          drawCenteredText(raster, code, x + cellSize / 2, y + cellSize / 2, textColor, Math.min(2, maxScale))
        }
      }
    }
  }

  if (showGrid) {
    fillRect(raster, gridX, gridY + gridHeight, gridWidth + 1, 1, [80, 80, 80])
    fillRect(raster, gridX + gridWidth, gridY, 1, gridHeight + 1, [80, 80, 80])
  }

  if (showCoordinates && cellSize >= 8) {
    for (let column = 0; column < columns; column += 1) {
      drawCenteredText(raster, String(column + 1), gridX + (column + 0.5) * cellSize, outer + 9, [30, 30, 30])
    }
    for (let row = 0; row < rows; row += 1) {
      drawCenteredText(raster, String(row + 1), outer + 10, gridY + (row + 0.5) * cellSize, [30, 30, 30])
    }
  }

  if (summary.length) {
    const legendX = gridX + gridWidth + 14
    drawText(raster, `TOTAL:${summary.reduce((total, item) => total + Number(item.count ?? 0), 0)}`, legendX, outer, [20, 20, 20])
    summary.forEach((item, index) => {
      const y = outer + 18 + index * 14
      const code = String(item.code ?? '')
      fillRect(raster, legendX, y, 10, 10, parseHex(item.hex ?? colorData[code]))
      drawText(raster, `${code}:${Number(item.count ?? 0)}`, legendX + 16, y + 1, [20, 20, 20])
    })
  }

  return raster
}

function uint32(value: number) {
  return new Uint8Array([
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255
  ])
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function adler32(bytes: Uint8Array) {
  let a = 1
  let b = 0
  for (const byte of bytes) {
    a = (a + byte) % 65521
    b = (b + a) % 65521
  }
  return ((b << 16) | a) >>> 0
}

function zlibStore(bytes: Uint8Array) {
  const parts = [new Uint8Array([0x78, 0x01])]
  for (let offset = 0; offset < bytes.length; offset += 65535) {
    const length = Math.min(65535, bytes.length - offset)
    const final = offset + length >= bytes.length ? 1 : 0
    parts.push(new Uint8Array([
      final,
      length & 255,
      (length >>> 8) & 255,
      (~length) & 255,
      ((~length) >>> 8) & 255
    ]))
    parts.push(bytes.subarray(offset, offset + length))
  }
  parts.push(uint32(adler32(bytes)))
  return concatBytes(parts)
}

function pngChunk(type: string, data: Uint8Array) {
  const typeBytes = encodeUtf8(type)
  return concatBytes([uint32(data.length), typeBytes, data, uint32(crc32(concatBytes([typeBytes, data])))])
}

function encodePng(raster: Raster) {
  const scanlines = new Uint8Array((raster.width * 3 + 1) * raster.height)
  for (let row = 0; row < raster.height; row += 1) {
    const targetOffset = row * (raster.width * 3 + 1)
    scanlines[targetOffset] = 0
    scanlines.set(
      raster.data.subarray(row * raster.width * 3, (row + 1) * raster.width * 3),
      targetOffset + 1
    )
  }
  const header = concatBytes([
    uint32(raster.width),
    uint32(raster.height),
    new Uint8Array([8, 2, 0, 0, 0])
  ])
  return concatBytes([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlibStore(scanlines)),
    pngChunk('IEND', new Uint8Array())
  ])
}

function encodePdf(raster: Raster) {
  const landscape = raster.width > raster.height
  const pageWidth = landscape ? 842 : 595
  const pageHeight = landscape ? 595 : 842
  const scale = Math.min((pageWidth - 72) / raster.width, (pageHeight - 72) / raster.height)
  const drawWidth = raster.width * scale
  const drawHeight = raster.height * scale
  const x = (pageWidth - drawWidth) / 2
  const y = (pageHeight - drawHeight) / 2
  const imageData = zlibStore(raster.data)
  const content = encodeUtf8(`q ${drawWidth.toFixed(3)} 0 0 ${drawHeight.toFixed(3)} ${x.toFixed(3)} ${y.toFixed(3)} cm /Im0 Do Q\n`)
  const objects = [
    encodeUtf8('<< /Type /Catalog /Pages 2 0 R >>'),
    encodeUtf8('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    encodeUtf8(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`),
    concatBytes([encodeUtf8(`<< /Length ${content.length} >>\nstream\n`), content, encodeUtf8('endstream')]),
    concatBytes([
      encodeUtf8(`<< /Type /XObject /Subtype /Image /Width ${raster.width} /Height ${raster.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${imageData.length} >>\nstream\n`),
      imageData,
      encodeUtf8('\nendstream')
    ])
  ]
  const parts: Uint8Array[] = [concatBytes([encodeUtf8('%PDF-1.4\n'), new Uint8Array([37, 226, 227, 207, 211, 10])])]
  const offsets = [0]
  let offset = parts[0].length
  objects.forEach((object, index) => {
    offsets.push(offset)
    const wrapped = concatBytes([
      encodeUtf8(`${index + 1} 0 obj\n`),
      object,
      encodeUtf8('\nendobj\n')
    ])
    parts.push(wrapped)
    offset += wrapped.length
  })
  const xrefOffset = offset
  const xref = [
    'xref',
    `0 ${objects.length + 1}`,
    '0000000000 65535 f ',
    ...offsets.slice(1).map((item) => `${String(item).padStart(10, '0')} 00000 n `),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    `startxref\n${xrefOffset}`,
    '%%EOF\n'
  ].join('\n')
  parts.push(encodeUtf8(xref))
  return concatBytes(parts)
}

function encodeJson(payload: ExportPayload) {
  const matrix = assertMatrix(payload)
  return encodeUtf8(JSON.stringify({
    version: '1.0',
    exported_at: new Date().toISOString(),
    dimensions: {
      width: matrix[0]?.length ?? 0,
      height: matrix.length
    },
    pixel_matrix: matrix,
    color_summary: payload.color_summary ?? []
  }, null, 2))
}

export async function exportPatternLocally(kind: ExportKind, rawPayload: unknown) {
  const payload = (rawPayload && typeof rawPayload === 'object' ? rawPayload : {}) as ExportPayload
  if (kind === 'json') {
    return toArrayBuffer(encodeJson(payload))
  }
  const raster = renderPattern(payload)
  return toArrayBuffer(kind === 'png' ? encodePng(raster) : encodePdf(raster))
}
