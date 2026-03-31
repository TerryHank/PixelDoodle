import Taro from '@tarojs/taro'
import type { FileAdapter } from './types'

export const weappFileAdapter: FileAdapter = {
  async saveBinaryFile(name, mime, data) {
    const fs = Taro.getFileSystemManager()
    const filePath = `${Taro.env.USER_DATA_PATH}/${name}`

    fs.writeFileSync(filePath, data, 'binary')

    if (mime === 'image/png') {
      await Taro.saveImageToPhotosAlbum({ filePath })
      return
    }

    await Taro.saveFileToDisk({
      filePath
    })
  }
}
