declare module '*.png' {
  const src: string
  export default src
}

declare module '*.jpg' {
  const src: string
  export default src
}

declare module '*.svg' {
  const src: string
  export default src
}

declare module '*.wasm' {
  const src: string
  export default src
}

declare module '@/generated/local-processing/beadcraft-wasm-bindgen' {
  export function initSync(module: { module: BufferSource | WebAssembly.Module }): unknown
  export function generate_pattern_bytes(bytes: Uint8Array, options: unknown): unknown
}

declare module '@/generated/local-processing/beadcraft-wasm-meta' {
  export const LOCAL_WASM_FILE_NAME: string
  export const LOCAL_WASM_VERSION: string
}
