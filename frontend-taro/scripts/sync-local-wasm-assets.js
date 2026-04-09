const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const projectRoot = path.resolve(__dirname, '..')
const sourceDir = path.join(projectRoot, 'static', 'local-processing', 'wasm')
const targetDir = path.join(projectRoot, 'src', 'generated', 'local-processing')

const sourceJsPath = path.join(sourceDir, 'beadcraft_wasm.js')
const sourceWasmPath = path.join(sourceDir, 'beadcraft_wasm_bg.wasm')
const targetJsPath = path.join(targetDir, 'beadcraft-wasm-bindgen.js')
const targetMetaPath = path.join(targetDir, 'beadcraft-wasm-meta.ts')
const targetWasmPath = path.join(targetDir, 'beadcraft_wasm_bg.wasm')

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
}

function syncJsWrapper() {
  const wrapperSource = fs.readFileSync(sourceJsPath, 'utf8')
  const patchedWrapperSource = wrapperSource.replace(
    "        module_or_path = new URL('beadcraft_wasm_bg.wasm', import.meta.url);",
    "        throw new Error('Automatic wasm asset loading is disabled; pass explicit module bytes.');"
  )
  fs.writeFileSync(targetJsPath, patchedWrapperSource)
}

function syncWasmMeta() {
  const wasmBuffer = fs.readFileSync(sourceWasmPath)
  const wasmVersion = crypto
    .createHash('sha256')
    .update(wasmBuffer)
    .digest('hex')
    .slice(0, 16)
  const content =
    `export const LOCAL_WASM_FILE_NAME = 'beadcraft_wasm_bg.wasm'\n` +
    `export const LOCAL_WASM_VERSION = '${wasmVersion}'\n`
  fs.writeFileSync(targetMetaPath, content)
}

function syncWasmBinary() {
  fs.copyFileSync(sourceWasmPath, targetWasmPath)
}

ensureDir(targetDir)
syncJsWrapper()
syncWasmMeta()
syncWasmBinary()

const legacyBase64Path = path.join(targetDir, 'beadcraft-wasm-bg.base64.ts')
fs.rmSync(legacyBase64Path, { force: true })

console.log('synced local wasm assets into src/generated/local-processing')
