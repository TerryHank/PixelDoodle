// frontend-local/src/wasm-worker.ts
import init, { generate_pattern_bytes } from "/static/local-processing/wasm/beadcraft_wasm.js";
var initPromise = null;
async function ensureWasmReady() {
  if (!initPromise) {
    initPromise = init({ module_or_path: "/static/local-processing/wasm/beadcraft_wasm_bg.wasm" });
  }
  await initPromise;
}
self.onmessage = async (event) => {
  const { id, bytes, options } = event.data;
  try {
    await ensureWasmReady();
    const result = generate_pattern_bytes(new Uint8Array(bytes), options);
    const response = { id, ok: true, result };
    self.postMessage(response);
  } catch (error) {
    const response = {
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
    self.postMessage(response);
  }
};
