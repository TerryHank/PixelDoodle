import colors from '@/generated/local-processing/artkal-m-series.json'
import presets from '@/generated/local-processing/artkal-presets.json'
import type {
  PaletteColor,
  PalettePresetMap,
  PaletteResponse
} from '@/types/api'

const localPalette: PaletteResponse = {
  colors: colors as PaletteColor[],
  presets: presets as PalettePresetMap
}

export function getLocalPalette(): PaletteResponse {
  return localPalette
}
