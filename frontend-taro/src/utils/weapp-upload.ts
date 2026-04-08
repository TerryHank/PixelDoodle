import Taro from '@tarojs/taro'

type WxGlobalLike = typeof globalThis & {
  wx?: {
    env?: {
      USER_DATA_PATH?: string
    }
  }
}

function readWeappUserDataPath() {
  return (globalThis as WxGlobalLike).wx?.env?.USER_DATA_PATH || ''
}

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^A-Za-z0-9._-]/g, '_')
}

export function isWeappUploadablePath(filePath: string) {
  return /^wxfile:\/\//.test(filePath) || /(^|[\\/])usr([\\/]|$)/.test(filePath)
}

export function resolveWeappUploadablePath(
  sourcePath: string,
  fileName = `pixeldoodle_${Date.now()}.jpg`
) {
  if (!sourcePath || isWeappUploadablePath(sourcePath)) {
    return sourcePath
  }

  const userDataPath = readWeappUserDataPath()
  if (!userDataPath || typeof Taro.getFileSystemManager !== 'function') {
    return sourcePath
  }

  const fs = Taro.getFileSystemManager()
  if (!fs || typeof fs.copyFileSync !== 'function') {
    return sourcePath
  }

  const safeFileName = sanitizeFileName(fileName)
  const targetPath = `${userDataPath}/${Date.now()}_${safeFileName}`

  try {
    fs.copyFileSync(sourcePath, targetPath)
    return targetPath
  } catch {
    return sourcePath
  }
}
