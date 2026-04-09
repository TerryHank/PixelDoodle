import { View } from '@tarojs/components'
import type { ColorSummaryItem, PixelMatrix } from '@/types/api'
import './index.scss'

function sampleMatrix(matrix: PixelMatrix, size: number) {
  const height = matrix.length
  const width = matrix[0]?.length ?? 0
  if (!height || !width) {
    return Array.from({ length: size * size }, () => null)
  }

  const result: Array<string | null> = []
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sourceY = Math.min(height - 1, Math.floor((y * height) / size))
      const sourceX = Math.min(width - 1, Math.floor((x * width) / size))
      result.push(matrix[sourceY][sourceX] ?? null)
    }
  }

  return result
}

export interface PatternThumbProps {
  pixelMatrix: PixelMatrix
  colorSummary: ColorSummaryItem[]
}

export function PatternThumb({ pixelMatrix, colorSummary }: PatternThumbProps) {
  const colorLookup = Object.fromEntries(
    colorSummary.map((item) => [item.code, item.hex])
  )
  const cells = sampleMatrix(pixelMatrix, 12)

  return (
    <View className='pattern-thumb'>
      {cells.map((code, index) => (
        <View
          key={`${code ?? 'empty'}-${index}`}
          className={`pattern-thumb__cell ${code ? '' : 'pattern-thumb__cell--empty'}`}
          style={code ? { background: colorLookup[code] || '#ffffff' } : undefined}
        />
      ))}
    </View>
  )
}
