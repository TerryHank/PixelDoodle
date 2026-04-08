// frontend-local/src/benchmark.ts
var defaultOptions = {
  mode: "fixed_grid",
  grid_width: 48,
  grid_height: 48,
  led_size: 64,
  pixel_size: 8,
  use_dithering: false,
  palette_preset: "221",
  max_colors: 0,
  similarity_threshold: 0,
  remove_bg: false,
  contrast: 0,
  saturation: 0,
  sharpness: 0
};
var paletteData = null;
function setStatus(message) {
  const status = document.getElementById("benchmark-status");
  if (status) status.textContent = message;
}
function getSelectedExample() {
  const select = document.getElementById("benchmark-example");
  return select?.value || "luoxiaohei";
}
async function ensurePalette() {
  if (!paletteData) {
    const response = await fetch("/api/palette");
    paletteData = await response.json();
  }
  return paletteData;
}
async function loadExampleBytes(name) {
  const response = await fetch(`/examples/${name}_original.jpg`);
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}
async function generateViaServer(exampleBytes, options) {
  const formData = new FormData();
  formData.append("file", new Blob([exampleBytes], { type: "image/jpeg" }), "example.jpg");
  formData.append("mode", options.mode);
  formData.append("grid_width", String(options.grid_width));
  formData.append("grid_height", String(options.grid_height));
  formData.append("led_size", String(options.led_size));
  formData.append("pixel_size", String(options.pixel_size));
  formData.append("use_dithering", String(options.use_dithering));
  formData.append("palette_preset", options.palette_preset);
  formData.append("max_colors", String(options.max_colors));
  formData.append("similarity_threshold", String(options.similarity_threshold));
  formData.append("remove_bg", String(options.remove_bg));
  formData.append("contrast", String(options.contrast));
  formData.append("saturation", String(options.saturation));
  formData.append("sharpness", String(options.sharpness));
  const startedAt = performance.now();
  const response = await fetch("/api/generate", {
    method: "POST",
    body: formData,
    headers: {
      "x-benchmark-bypass-cache": "1"
    }
  });
  if (!response.ok) {
    throw new Error(`/api/generate failed with ${response.status}`);
  }
  const json = await response.json();
  const endedAt = performance.now();
  return {
    durationMs: endedAt - startedAt,
    result: normalizeServerResult(json)
  };
}
function normalizeServerResult(result) {
  return {
    grid_size: result.grid_size,
    pixel_matrix: result.pixel_matrix,
    color_summary: result.color_summary,
    total_beads: result.total_beads,
    preview_image: result.preview_image ?? ""
  };
}
function compareResults(lhs, rhs) {
  return JSON.stringify(lhs) === JSON.stringify(rhs);
}
function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
async function runWorkerBenchmark(engine, workerPath, exampleBytes, options, colors, presets, baseline) {
  const worker = new Worker(workerPath, { type: "module" });
  try {
    const runs = [];
    let lastResult = null;
    for (let i = 0; i < 3; i += 1) {
      const id = `${engine}-${i}-${crypto.randomUUID()}`;
      const startedAt = performance.now();
      const result = await new Promise((resolve, reject) => {
        const handler = (event) => {
          if (event.data.id !== id) return;
          worker.removeEventListener("message", handler);
          if (!event.data.ok || !event.data.result) {
            reject(new Error(event.data.error || `${engine} worker failed`));
            return;
          }
          resolve(event.data.result);
        };
        worker.addEventListener("message", handler);
        const payload = engine === "ts-worker" ? { id, bytes: exampleBytes.buffer.slice(0), options, colors, presets } : { id, bytes: exampleBytes.buffer.slice(0), options };
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
      note: engine === "ts-worker" ? "TypeScript worker local pipeline" : "Rust core compiled to WebAssembly"
    };
  } finally {
    worker.terminate();
  }
}
async function runServerBenchmark(exampleBytes, options) {
  const runs = [];
  let baseline = null;
  for (let i = 0; i < 3; i += 1) {
    const { durationMs, result } = await generateViaServer(exampleBytes, options);
    runs.push(durationMs);
    if (!baseline) baseline = result;
  }
  return {
    baseline,
    summary: {
      engine: "server-http",
      runs,
      averageMs: average(runs),
      equalsServer: true,
      note: "Rust Axum HTTP generation"
    }
  };
}
function renderResults(results) {
  const container = document.getElementById("benchmark-results");
  if (!container) return;
  container.innerHTML = results.map((result) => {
    const runs = result.runs.map((value) => `${value.toFixed(2)} ms`).join(" / ");
    const matchText = result.equalsServer ? "\u662F" : "\u5426";
    return `
        <tr>
          <td>${result.engine}</td>
          <td>${runs}</td>
          <td>${result.averageMs.toFixed(2)} ms</td>
          <td>${matchText}</td>
          <td>${result.note}</td>
        </tr>
      `;
  }).join("");
}
async function runBenchmark() {
  const button = document.getElementById("benchmark-run");
  if (button) button.disabled = true;
  try {
    setStatus("\u52A0\u8F7D\u8C03\u8272\u677F\u548C\u793A\u4F8B\u56FE\u7247...");
    const [{ colors, presets }, exampleBytes] = await Promise.all([
      ensurePalette(),
      loadExampleBytes(getSelectedExample())
    ]);
    setStatus("\u8FD0\u884C Rust HTTP \u57FA\u7EBF...");
    const server = await runServerBenchmark(exampleBytes, defaultOptions);
    setStatus("\u8FD0\u884C TypeScript Worker...");
    const tsWorker = await runWorkerBenchmark(
      "ts-worker",
      "/static/local-processing/ts-worker.js",
      exampleBytes,
      defaultOptions,
      colors,
      presets,
      server.baseline
    );
    setStatus("\u8FD0\u884C Rust/WASM Worker...");
    const wasmWorker = await runWorkerBenchmark(
      "wasm-worker",
      "/static/local-processing/wasm-worker.js",
      exampleBytes,
      defaultOptions,
      colors,
      presets,
      server.baseline
    );
    renderResults([server.summary, tsWorker, wasmWorker]);
    setStatus("\u57FA\u51C6\u5B8C\u6210");
  } catch (error) {
    console.error(error);
    setStatus(error instanceof Error ? error.message : String(error));
  } finally {
    if (button) button.disabled = false;
  }
}
document.addEventListener("DOMContentLoaded", () => {
  const button = document.getElementById("benchmark-run");
  button?.addEventListener("click", () => {
    void runBenchmark();
  });
});
