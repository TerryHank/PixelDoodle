export interface ApplyPatternChangeAndMaybeRegenerateInput {
  applyChange: () => void
  originalImage: string | null
  regenerate: (filePath: string) => Promise<void>
}

export async function applyPatternChangeAndMaybeRegenerate(
  input: ApplyPatternChangeAndMaybeRegenerateInput
) {
  input.applyChange()
  const originalImage = input.originalImage.trim()
  if (!originalImage) {
    return false
  }

  await input.regenerate(originalImage)
  return true
}
