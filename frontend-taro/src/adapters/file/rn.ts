import type { FileAdapter } from './types'

export const rnFileAdapter: FileAdapter = {
  async saveBinaryFile() {
    throw new Error('RN Android 端文件保存尚未完成')
  }
}
