export const MATERIAL_SEARCH_HISTORY_LIMIT = 20

export function normalizeMaterialSearchQuery(value: string) {
  return value.trim().slice(0, 20)
}

export function recordMaterialSearch(
  history: string[],
  value: string,
  limit = MATERIAL_SEARCH_HISTORY_LIMIT
) {
  const query = normalizeMaterialSearchQuery(value)
  if (!query) return history
  return [query, ...history.filter((item) => item !== query)].slice(0, limit)
}
