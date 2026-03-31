import type { FileAdapter } from './types'

export const h5FileAdapter: FileAdapter = {
  async saveBinaryFile(name, mime, data) {
    const blob = new Blob([data], { type: mime })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')

    anchor.href = url
    anchor.download = name
    anchor.click()

    URL.revokeObjectURL(url)
  }
}
