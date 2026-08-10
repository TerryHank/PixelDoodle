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
  if (!activeAdapter) {
    return {
      filePath: input.filePath,
      fileName: input.fileName
    }
  }

  return activeAdapter.transform(input)
}
