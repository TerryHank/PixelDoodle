export interface WeappImageRaster {
  width: number
  height: number
  data: Uint8ClampedArray
}

export interface WeappRasterLoader {
  loadRaster: (
    sourcePath: string,
    width: number,
    height: number
  ) => Promise<WeappImageRaster>
}

let activeWeappRasterLoader: WeappRasterLoader | null = null

export function registerWeappRasterLoader(loader: WeappRasterLoader | null) {
  activeWeappRasterLoader = loader
}

export function getWeappRasterLoader() {
  return activeWeappRasterLoader
}
