import { generatePatternLocal, type GenerateOptions, type PaletteColor, type PalettePreset } from './ts-engine';

interface WorkerRequest {
  id: string;
  bytes: ArrayBuffer;
  options: GenerateOptions;
  colors: PaletteColor[];
  presets: Record<string, PalettePreset>;
}

interface WorkerResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, bytes, options, colors, presets } = event.data;
  try {
    const result = await generatePatternLocal(new Uint8Array(bytes), options, colors, presets);
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
