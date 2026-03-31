export function normalizeUuid(input: string) {
  return input.trim().toUpperCase()
}

export function isUuidLike(input: string) {
  return /^[0-9A-F]{12}$/.test(normalizeUuid(input))
}

