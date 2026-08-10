export interface FileAdapter {
  saveBinaryFile(name: string, mime: string, data: ArrayBuffer): Promise<void>
}
