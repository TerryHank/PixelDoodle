import type { GenerateOptions, GenerateResult, PaletteColor, PalettePreset } from './ts-engine';

type EngineKind = 'server-http' | 'ts-worker' | 'wasm-worker';

interface PaletteResponse {
  colors: PaletteColor[];
  presets: Record<string, PalettePreset>;
}

interface BenchmarkSummary {
  engine: EngineKind;
  runs: number[];
  averageMs: number;
  equalsServer: boolean;
  note: string;
}

const defaultOptions: GenerateOptions = {
  mode: 'fixed_grid',
  grid_width: 48,
  grid_height: 48,
  led_size: 64,
  pixel_size: 8,
  use_dithering: false,
  palette_preset: '221',
  max_colors: 0,
  similarity_threshold: 0,
  remove_bg: false,
  contrast: 0,
  saturation: 0,
  sharpness: 0,
};

let paletteData: PaletteResponse | null = null;

function setStatus(message: string) {
  const status = document.getElementById('benchmark-status');
  if (status) status.textContent = message;
}

function getSelectedExample(): string {
  const select = document.getElementById('benchmark-example') as HTMLSelectElement | null;
  return select?.value || 'luoxiaohei';
}

async function ensurePalette(): Promise<PaletteResponse> {
  if (!paletteData) {
    const response = await fetch('/api/palette');
    paletteData = await response.json();
  }
  return paletteData;
}

async function loadExampleBytes(name: string): Promise<Uint8Array> {
  const response = await fetch(`/examples/${name}_original.jpg`);
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

async function generateViaServer(exampleBytes: Uint8Array, options: GenerateOptions) {
  const formData = new FormData();
  formData.append('file', new Blob([exampleBytes], { type: 'image/jpeg' }), 'example.jpg');
  formData.append('mode', options.mode);
  formData.append('grid_width', String(options.grid_width));
  formData.append('grid_height', String(options.grid_height));
  formData.append('led_size', String(options.led_size));
  formData.append('pixel_size', String(options.pixel_size));
  formData.append('use_dithering', String(options.use_dithering));
  formData.append('palette_preset', options.palette_preset);
  formData.append('max_colors', String(options.max_colors));
  formData.append('similarity_threshold', String(options.similarity_threshold));
  formData.append('remove_bg', String(options.remove_bg));
  formData.append('contrast', String(options.contrast));
  formData.append('saturation', String(options.saturation));
  formData.append('sharpness', String(options.sharpness));

  const startedAt = performance.now();
  const response = await fetch('/api/generate', {
    method: 'POST',
    body: formData,
    headers: {
      'x-benchmark-bypass-cache': '1',
    },
  });
  if (!response.ok) {
    throw new Error(`/api/generate failed with ${response.status}`);
  }
  const json = await response.json();
  const endedAt = performance.now();
  return {
    durationMs: endedAt - startedAt,
    result: normalizeServerResult(json),
  };
}

function normalizeServerResult(result: any): GenerateResult {
  return {
    grid_size: result.grid_size,
    pixel_matrix: result.pixel_matrix,
    color_summary: result.color_summary,
    total_beads: result.total_beads,
    preview_image: result.preview_image ?? '',
  };
}

function compareResults(lhs: GenerateResult, rhs: GenerateResult): boolean {
  return JSON.stringify(lhs) === JSON.stringify(rhs);
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function runWorkerBenchmark(
  engine: 'ts-worker' | 'wasm-worker',
  workerPath: string,
  exampleBytes: Uint8Array,
  options: GenerateOptions,
  colors: PaletteColor[],
  presets: Record<string, PalettePreset>,
  baseline: GenerateResult,
): Promise<BenchmarkSummary> {
  const worker = new Worker(workerPath, { type: 'module' });
  try {
    const runs: number[] = [];
    let lastResult: GenerateResult | null = null;
    for (let i = 0; i < 3; i += 1) {
      const id = `${engine}-${i}-${crypto.randomUUID()}`;
      const startedAt = performance.now();
      const result = await new Promise<GenerateResult>((resolve, reject) => {
        const handler = (event: MessageEvent<{ id: string; ok: boolean; result?: GenerateResult; error?: string }>) => {
          if (event.data.id !== id) return;
          worker.removeEventListener('message', handler);
          if (!event.data.ok || !event.data.result) {
            reject(new Error(event.data.error || `${engine} worker failed`));
            return;
          }
          resolve(event.data.result);
        };
        worker.addEventListener('message', handler);
        const payload =
          engine === 'ts-worker'
            ? { id, bytes: exampleBytes.buffer.slice(0), options, colors, presets }
            : { id, bytes: exampleBytes.buffer.slice(0), options };
        worker.postMessage(payload, [payload.bytes]);
      });
      const endedAt = performance.now();
      runs.push(endedAt - startedAt);
      lastResult = result;
    }

    return {
      engine,
      runs,
      averageMs: average(runs),
      equalsServer: lastResult ? compareResults(lastResult, baseline) : false,
      note: engine === 'ts-worker' ? 'TypeScript worker local pipeline' : 'Rust core compiled to WebAssembly',
    };
  } finally {
    worker.terminate();
  }
}

async function runServerBenchmark(exampleBytes: Uint8Array, options: GenerateOptions): Promise<{
  baseline: GenerateResult;
  summary: BenchmarkSummary;
}> {
  const runs: number[] = [];
  let baseline: GenerateResult | null = null;
  for (let i = 0; i < 3; i += 1) {
    const { durationMs, result } = await generateViaServer(exampleBytes, options);
    runs.push(durationMs);
    if (!baseline) baseline = result;
  }
  return {
    baseline: baseline!,
    summary: {
      engine: 'server-http',
      runs,
      averageMs: average(runs),
      equalsServer: true,
      note: 'Rust Axum HTTP generation',
    },
  };
}

function renderResults(results: BenchmarkSummary[]) {
  const container = document.getElementById('benchmark-results');
  if (!container) return;
  container.innerHTML = results
    .map((result) => {
      const runs = result.runs.map((value) => `${value.toFixed(2)} ms`).join(' / ');
      const matchText = result.equalsServer ? '是' : '否';
      return `
        <tr>
          <td>${result.engine}</td>
          <td>${runs}</td>
          <td>${result.averageMs.toFixed(2)} ms</td>
          <td>${matchText}</td>
          <td>${result.note}</td>
        </tr>
      `;
    })
    .join('');
}

async function runBenchmark() {
  const button = document.getElementById('benchmark-run') as HTMLButtonElement | null;
  if (button) button.disabled = true;
  try {
    setStatus('加载调色板和示例图片...');
    const [{ colors, presets }, exampleBytes] = await Promise.all([
      ensurePalette(),
      loadExampleBytes(getSelectedExample()),
    ]);

    setStatus('运行 Rust HTTP 基线...');
    const server = await runServerBenchmark(exampleBytes, defaultOptions);

    setStatus('运行 TypeScript Worker...');
    const tsWorker = await runWorkerBenchmark(
      'ts-worker',
      '/static/local-processing/ts-worker.js',
      exampleBytes,
      defaultOptions,
      colors,
      presets,
      server.baseline,
    );

    setStatus('运行 Rust/WASM Worker...');
    const wasmWorker = await runWorkerBenchmark(
      'wasm-worker',
      '/static/local-processing/wasm-worker.js',
      exampleBytes,
      defaultOptions,
      colors,
      presets,
      server.baseline,
    );

    renderResults([server.summary, tsWorker, wasmWorker]);
    setStatus('基准完成');
  } catch (error) {
    console.error(error);
    setStatus(error instanceof Error ? error.message : String(error));
  } finally {
    if (button) button.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const button = document.getElementById('benchmark-run');
  button?.addEventListener('click', () => {
    void runBenchmark();
  });
});
