import init, { generate_pattern_bytes } from '/static/local-processing/wasm/beadcraft_wasm.js';
import type { GenerateOptions } from './ts-engine';

interface WorkerRequest {
  id: string;
  bytes: ArrayBuffer;
  options: GenerateOptions;
}

interface WorkerResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

let initPromise: Promise<unknown> | null = null;

async function ensureWasmReady(): Promise<void> {
  if (!initPromise) {
    initPromise = init({ module_or_path: '/static/local-processing/wasm/beadcraft_wasm_bg.wasm' });
  }
  await initPromise;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, bytes, options } = event.data;
  try {
    await ensureWasmReady();
    const result = generate_pattern_bytes(new Uint8Array(bytes), options);
    const response: WorkerResponse = { id, ok: true, result };
    (self as DedicatedWorkerGlobalScope).postMessage(response);
  } catch (error) {
    const response: WorkerResponse = {
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    (self as DedicatedWorkerGlobalScope).postMessage(response);
  }
};

export {};
