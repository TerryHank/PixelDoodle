// frontend-local/src/ts-engine.ts
function linearize(channel) {
  return channel > 0.04045 ? ((channel + 0.055) / 1.055) ** 2.4 : channel / 12.92;
}
function rgbToLab(rgb) {
  const r = linearize(rgb[0] / 255);
  const g = linearize(rgb[1] / 255);
  const b = linearize(rgb[2] / 255);
  const x = r * 0.4124564 + g * 0.3575761 + b * 0.1804375;
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
  const z = r * 0.0193339 + g * 0.119192 + b * 0.9503041;
  return xyzToLab([x, y, z]);
}
function xyzToLab([x, y, z]) {
  const white = [0.95047, 1, 1.08883];
  const delta = 6 / 29;
  const delta3 = delta * delta * delta;
  const f = (t) => t > delta3 ? Math.cbrt(t) : t / (3 * delta * delta) + 4 / 29;
  const fx = f(x / white[0]);
  const fy = f(y / white[1]);
  const fz = f(z / white[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function labDistance(lhs, rhs) {
  const dl = lhs[0] - rhs[0];
  const da = lhs[1] - rhs[1];
  const db = lhs[2] - rhs[2];
  return Math.sqrt(dl * dl + da * da + db * db);
}
function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}
function grayscale(rgb) {
  return rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114;
}
function resolveGridSize(width, height, options) {
  if (options.mode === "pixel_size") {
    return {
      width: Math.max(16, Math.round(width / Math.max(options.pixel_size || 8, 1))),
      height: Math.max(16, Math.round(height / Math.max(options.pixel_size || 8, 1)))
    };
  }
  return {
    width: Math.max(1, options.grid_width || 48),
    height: Math.max(1, options.grid_height || 48)
  };
}
async function decodeImage(bytes) {
  const blob = new Blob([bytes]);
  return createImageBitmap(blob);
}
function drawScaled(bitmap, width, height) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("2D context unavailable");
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}
function cloneImageData(data) {
  return new ImageData(new Uint8ClampedArray(data.data), data.width, data.height);
}
function applyContrast(imageData, amount) {
  if (!amount) return;
  const factor = 1 + amount / 100;
  const data = imageData.data;
  let mean = 127;
  let accum = 0;
  for (let i = 0; i < data.length; i += 4) {
    accum += grayscale([data[i], data[i + 1], data[i + 2]]);
  }
  mean = accum / (data.length / 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = clampByte(mean + (data[i] - mean) * factor);
    data[i + 1] = clampByte(mean + (data[i + 1] - mean) * factor);
    data[i + 2] = clampByte(mean + (data[i + 2] - mean) * factor);
  }
}
function applySaturation(imageData, amount) {
  if (!amount) return;
  const factor = 1 + amount / 100;
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = grayscale([data[i], data[i + 1], data[i + 2]]);
    data[i] = clampByte(gray + (data[i] - gray) * factor);
    data[i + 1] = clampByte(gray + (data[i + 1] - gray) * factor);
    data[i + 2] = clampByte(gray + (data[i + 2] - gray) * factor);
  }
}
function applySharpness(imageData, amount) {
  if (!amount) return;
  const { width, height, data } = imageData;
  const src = new Uint8ClampedArray(data);
  const alpha = Math.max(0, amount / 100);
  const sample = (x, y, channel) => {
    const ix = Math.max(0, Math.min(width - 1, x));
    const iy = Math.max(0, Math.min(height - 1, y));
    return src[(iy * width + ix) * 4 + channel];
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        const center = sample(x, y, c) * 5;
        const blurred = sample(x - 1, y, c) + sample(x + 1, y, c) + sample(x, y - 1, c) + sample(x, y + 1, c);
        const sharpened = center - blurred;
        data[idx + c] = clampByte(src[idx + c] * (1 - alpha) + sharpened * alpha);
      }
    }
  }
}
function estimateColorCount(pixels, width, height) {
  if (pixels.length === 0) return 12;
  const means = [0, 0, 0];
  for (const rgb of pixels) {
    means[0] += rgb[0];
    means[1] += rgb[1];
    means[2] += rgb[2];
  }
  means[0] /= pixels.length;
  means[1] /= pixels.length;
  means[2] /= pixels.length;
  let totalVar = 0;
  for (const rgb of pixels) {
    totalVar += ((rgb[0] - means[0]) ** 2 + (rgb[1] - means[1]) ** 2 + (rgb[2] - means[2]) ** 2) / pixels.length;
  }
  let n = Math.round(12 + (totalVar - 500) * 28 / 3500);
  n = Math.max(12, Math.min(40, n));
  const area = width * height;
  if (area > 48 * 48) n = Math.min(40, n + 5);
  if (area < 29 * 29) n = Math.max(12, n - 3);
  return n;
}
function imageDataToPixels(imageData) {
  const pixels = [];
  const { data } = imageData;
  for (let i = 0; i < data.length; i += 4) {
    pixels.push([data[i], data[i + 1], data[i + 2]]);
  }
  return pixels;
}
function buildPaletteState(colors, presets) {
  const labValues = colors.map((color) => rgbToLab(color.rgb));
  const codeToIndex = new Map(colors.map((color, index) => [color.code, index]));
  return { colors, presets, labValues, codeToIndex };
}
function allowedPaletteIndices(state, presetKey) {
  const preset = state.presets[presetKey];
  if (!preset || !preset.codes) return null;
  return preset.codes.map((code) => state.codeToIndex.get(code)).filter((index) => typeof index === "number").sort((lhs, rhs) => lhs - rhs);
}
function closestPaletteIndex(rgb, state, allowed) {
  const lab = rgbToLab(rgb);
  const candidates = allowed ?? state.colors.map((_, index) => index);
  let bestIndex = candidates[0] ?? 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const index of candidates) {
    const distance = labDistance(lab, state.labValues[index]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}
function selectTopColors(pixels, state, allowed, limit) {
  const counts = /* @__PURE__ */ new Map();
  for (const pixel of pixels) {
    const index = closestPaletteIndex(pixel, state, allowed);
    counts.set(index, (counts.get(index) ?? 0) + 1);
  }
  return [...counts.entries()].sort((lhs, rhs) => rhs[1] - lhs[1] || lhs[0] - rhs[0]).slice(0, limit).map(([index]) => index).sort((lhs, rhs) => lhs - rhs);
}
function closestSubpaletteIndex(rgb, colors) {
  const lab = rgbToLab(rgb);
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < colors.length; i += 1) {
    const distance = labDistance(lab, rgbToLab(colors[i].rgb));
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  return bestIndex;
}
function quantizePixels(imageData, subPalette, dithering) {
  const { width, height, data } = imageData;
  const working = new Float64Array(width * height * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    working[j] = data[i];
    working[j + 1] = data[i + 1];
    working[j + 2] = data[i + 2];
  }
  const result = new Array(width * height);
  const diffuse = (x, y, error, weight) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const idx = (y * width + x) * 3;
    working[idx] += error[0] * weight;
    working[idx + 1] += error[1] * weight;
    working[idx + 2] += error[2] * weight;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 3;
      const oldPixel = [
        clampByte(working[idx]),
        clampByte(working[idx + 1]),
        clampByte(working[idx + 2])
      ];
      const localIndex = closestSubpaletteIndex(oldPixel, subPalette);
      result[y * width + x] = localIndex;
      if (!dithering) continue;
      const nextRgb = subPalette[localIndex].rgb;
      const error = [
        oldPixel[0] - nextRgb[0],
        oldPixel[1] - nextRgb[1],
        oldPixel[2] - nextRgb[2]
      ];
      diffuse(x + 1, y, error, 7 / 16);
      diffuse(x - 1, y + 1, error, 3 / 16);
      diffuse(x, y + 1, error, 5 / 16);
      diffuse(x + 1, y + 1, error, 1 / 16);
    }
  }
  return result;
}
function poolToMatrix(quantized, subPaletteIndices, gridWidth, gridHeight) {
  const matrix = [];
  const pooledWidth = gridWidth * 4;
  for (let y = 0; y < gridHeight; y += 1) {
    const row = [];
    for (let x = 0; x < gridWidth; x += 1) {
      const counts = /* @__PURE__ */ new Map();
      for (let py = 0; py < 4; py += 1) {
        for (let px = 0; px < 4; px += 1) {
          const pooledIndex = (y * 4 + py) * pooledWidth + (x * 4 + px);
          const local = quantized[pooledIndex];
          counts.set(local, (counts.get(local) ?? 0) + 1);
        }
      }
      const winner = [...counts.entries()].sort((lhs, rhs) => rhs[1] - lhs[1] || lhs[0] - rhs[0])[0];
      row.push(winner ? subPaletteIndices[winner[0]] : null);
    }
    matrix.push(row);
  }
  return matrix;
}
function removeBackground(matrix) {
  const height = matrix.length;
  const width = matrix[0]?.length ?? 0;
  if (!height || !width) return;
  const corners = [
    matrix[0][0],
    matrix[0][width - 1],
    matrix[height - 1][0],
    matrix[height - 1][width - 1]
  ].filter((value) => value !== null);
  if (!corners.length) return;
  const background = [...corners.reduce((acc, value) => acc.set(value, (acc.get(value) ?? 0) + 1), /* @__PURE__ */ new Map()).entries()].sort((lhs, rhs) => rhs[1] - lhs[1])[0]?.[0];
  if (typeof background !== "number") return;
  const queue = [];
  const visited = /* @__PURE__ */ new Set();
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const key = `${x},${y}`;
    if (visited.has(key)) return;
    if (matrix[y][x] !== background) return;
    visited.add(key);
    queue.push([x, y]);
  };
  for (let x = 0; x < width; x += 1) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    push(0, y);
    push(width - 1, y);
  }
  while (queue.length) {
    const [x, y] = queue.shift();
    matrix[y][x] = null;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
}
function renderMatrixAndSummary(matrix, colors) {
  const counts = /* @__PURE__ */ new Map();
  const firstSeen = /* @__PURE__ */ new Map();
  const order = [];
  let totalBeads = 0;
  const pixelMatrix = matrix.map(
    (row) => row.map((index) => {
      if (index === null) return null;
      const color = colors[index];
      if (!counts.has(color.code)) {
        firstSeen.set(color.code, order.length);
        order.push(color.code);
      }
      counts.set(color.code, (counts.get(color.code) ?? 0) + 1);
      totalBeads += 1;
      return color.code;
    })
  );
  const colorSummary = [...counts.entries()].sort((lhs, rhs) => rhs[1] - lhs[1] || (firstSeen.get(lhs[0]) ?? 0) - (firstSeen.get(rhs[0]) ?? 0)).map(([code, count]) => {
    const color = colors.find((item) => item.code === code);
    return {
      code,
      name: color.name,
      name_zh: color.name_zh,
      hex: color.hex,
      rgb: color.rgb,
      count
    };
  });
  return { pixel_matrix: pixelMatrix, color_summary: colorSummary, total_beads: totalBeads };
}
async function generatePatternLocal(bytes, options, colors, presets) {
  const bitmap = await decodeImage(bytes);
  const original = drawScaled(bitmap, bitmap.width, bitmap.height);
  const adjusted = cloneImageData(original);
  applyContrast(adjusted, options.contrast);
  applySaturation(adjusted, options.saturation);
  applySharpness(adjusted, options.sharpness);
  const grid = resolveGridSize(adjusted.width, adjusted.height, options);
  const selection = drawScaled(bitmap, 120, 120);
  const selectionPixels = imageDataToPixels(selection);
  const paletteState = buildPaletteState(colors, presets);
  const allowed = allowedPaletteIndices(paletteState, options.palette_preset);
  const paletteLimit = options.max_colors > 0 ? Math.min(options.max_colors, allowed?.length ?? colors.length) : estimateColorCount(selectionPixels, grid.width, grid.height);
  const subPaletteIndices = selectTopColors(selectionPixels, paletteState, allowed, paletteLimit);
  const subPalette = subPaletteIndices.map((index) => colors[index]);
  const mid = drawScaled(bitmap, grid.width * 4, grid.height * 4);
  applyContrast(mid, options.contrast);
  applySaturation(mid, options.saturation);
  applySharpness(mid, options.sharpness);
  const quantized = quantizePixels(mid, subPalette, options.use_dithering);
  const matrix = poolToMatrix(quantized, subPaletteIndices, grid.width, grid.height);
  if (options.remove_bg) {
    removeBackground(matrix);
  }
  const rendered = renderMatrixAndSummary(matrix, colors);
  return {
    grid_size: grid,
    pixel_matrix: rendered.pixel_matrix,
    color_summary: rendered.color_summary,
    total_beads: rendered.total_beads,
    preview_image: ""
  };
}

// frontend-local/src/ts-worker.ts
self.onmessage = async (event) => {
  const { id, bytes, options, colors, presets } = event.data;
  try {
    const result = await generatePatternLocal(new Uint8Array(bytes), options, colors, presets);
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
