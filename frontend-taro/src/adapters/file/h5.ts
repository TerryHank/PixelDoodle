import type { FileAdapter } from './types'
import { isTauri } from '@tauri-apps/api/core'

function extensionOf(name: string) {
  return name.split('.').pop()?.toLowerCase() || ''
}

async function saveWithTauri(name: string, mime: string, data: ArrayBuffer) {
  const [{ save }, { writeFile }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/plugin-fs')
  ])
  const extension = extensionOf(name)
  const path = await save({
    defaultPath: name,
    filters: extension
      ? [{ name: mime || 'DIY拼豆导出', extensions: [extension] }]
      : undefined
  })
  if (!path) {
    throw new Error('已取消导出')
  }
  await writeFile(path, new Uint8Array(data))
}

async function saveWithBrowserDownload(
  name: string,
  mime: string,
  data: ArrayBuffer
) {
  const blob = new Blob([data], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')

  anchor.href = url
  anchor.download = name
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()

  setTimeout(() => {
    anchor.remove()
    URL.revokeObjectURL(url)
  }, 60_000)
}

export const h5FileAdapter: FileAdapter = {
  async saveBinaryFile(name, mime, data) {
    if (isTauri()) {
      await saveWithTauri(name, mime, data)
      return
    }
    await saveWithBrowserDownload(name, mime, data)
  }
}
