export async function hideLoadingSafely(
  hideLoading: () => void | Promise<void>
) {
  try {
    await hideLoading()
  } catch {
    // Ignore duplicated hideLoading calls across runtimes.
  }
}
