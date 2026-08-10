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

export function normalizeWeappAssetPath(filePath: string) {
  if (!filePath) {
    return filePath
  }

  const normalized = filePath.replace(/\\/g, '/')

  if (
    /^wxfile:\/\//.test(normalized) ||
    /^https?:\/\//i.test(normalized) ||
    /^data:/i.test(normalized)
  ) {
    return normalized
  }

  return normalized.replace(/^\/+/, '')
}

export function isWeappUploadablePath(filePath: string) {
  return /^wxfile:\/\//.test(filePath) || /(^|[\\/])usr([\\/]|$)/.test(filePath)
}

export async function resolveWeappUploadablePath(
  sourcePath: string,
  fileName = `pixeldoodle_${Date.now()}.jpg`
) {
  if (!sourcePath || isWeappUploadablePath(sourcePath)) {
    return sourcePath
  }

  const normalizedSourcePath = normalizeWeappAssetPath(sourcePath)

  if (typeof Taro.getImageInfo === 'function') {
    try {
      const result = await Taro.getImageInfo({
        src: normalizedSourcePath
      })
      if (result?.path) {
        return result.path
      }
    } catch {
      // Fall back to the original source path below.
    }
  }

  const userDataPath = readWeappUserDataPath()
  if (!userDataPath || typeof Taro.getFileSystemManager !== 'function') {
    return sourcePath
  }

  const fs = Taro.getFileSystemManager()
  if (!fs || typeof fs.copyFile !== 'function') {
    return sourcePath
  }

  const safeFileName = sanitizeFileName(fileName)
  const targetPath = `${userDataPath}/${Date.now()}_${safeFileName}`

  try {
    await new Promise<void>((resolve, reject) => {
      fs.copyFile({
        srcPath: normalizedSourcePath,
        destPath: targetPath,
        success: () => resolve(),
        fail: reject
      })
    })
    return targetPath
  } catch {
    return normalizedSourcePath
  }
}
