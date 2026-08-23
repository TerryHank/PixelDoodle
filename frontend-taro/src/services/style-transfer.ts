export interface StyleTransferInput {
  filePath: string
  fileName?: string
  fields: Record<string, string>
}

export interface StyleTransferResult {
  filePath: string
  fileName?: string
  generatedImage?: string
}

export interface StyleTransferAdapter {
  transform(input: StyleTransferInput): Promise<StyleTransferResult>
}

let activeAdapter: StyleTransferAdapter | null = null

export function registerStyleTransferAdapter(adapter: StyleTransferAdapter | null) {
  activeAdapter = adapter
}

export async function transformImageStyle(
  input: StyleTransferInput
): Promise<StyleTransferResult> {
  if (input.fields.style_transfer === 'none') {
    return {
      filePath: input.filePath,
      fileName: input.fileName
    }
  }

  if (!activeAdapter) {
    if (input.fields.style_transfer === 'wanxiang') {
      throw new Error('万相云服务未配置，请检查 CloudBase 环境')
    }

    return {
      filePath: input.filePath,
      fileName: input.fileName
    }
  }

  return activeAdapter.transform(input)
}
