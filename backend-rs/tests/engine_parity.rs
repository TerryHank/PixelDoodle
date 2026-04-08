use std::{
    env,
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use serde_json::Value;

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("backend-rs should live under repo root")
        .to_path_buf()
}

fn python_executable() -> String {
    env::var("PYTHON_EXECUTABLE")
        .unwrap_or_else(|_| "D:\\Workspace\\PixelDoodle-web\\.venv\\Scripts\\python.exe".to_string())
}

fn run_python_baseline(image_path: &Path) -> Value {
    let root = repo_root();
    let request_path = root.join("backend-rs").join("target").join("tmp-engine-request.json");
    fs::create_dir_all(request_path.parent().unwrap()).unwrap();
    fs::write(
        &request_path,
        serde_json::json!({
            "file_path": image_path.to_string_lossy(),
            "mode": "fixed_grid",
            "grid_width": 48,
            "grid_height": 48,
            "led_size": 64,
            "pixel_size": 8,
            "use_dithering": "false",
            "palette_preset": "221",
            "max_colors": 0,
            "similarity_threshold": 0,
            "remove_bg": "false",
            "contrast": 0,
            "saturation": 0,
            "sharpness": 0
        })
        .to_string(),
    )
    .unwrap();

    let output = Command::new(python_executable())
        .arg(repo_root().join("tools").join("parity").join("generate_baseline.py"))
        .arg("generate")
        .arg(&request_path)
        .current_dir(repo_root())
        .output()
        .unwrap();

    assert!(
        output.status.success(),
        "python baseline failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    serde_json::from_slice(&output.stdout).unwrap()
}

fn run_python_stage_dump(image_path: &Path) -> Value {
    let script = r#"
import json
import sys
import zlib
import numpy as np
from PIL import Image, ImageStat
from core.quantizer import (
    _consolidate_extremes,
    _estimate_color_count,
    _build_pil_palette_image_from_colors,
    _cleanup_rare_colors,
    _smooth_edges,
)
from core.color_match import ArtkalPalette
from PIL import ImageEnhance

image_path = sys.argv[1]
image = Image.open(image_path).convert('RGB')
image_crc32 = zlib.crc32(np.array(image, dtype=np.uint8).tobytes()) & 0xffffffff
palette = ArtkalPalette()
gray = image.convert('L')
mean = int(ImageStat.Stat(gray).mean[0] + 0.5)
hist = gray.histogram()
total = sum(hist)
cumsum = 0
p5 = 0
p95 = 255
for i, count in enumerate(hist):
    cumsum += count
    if cumsum >= total * 0.05 and p5 == 0:
        p5 = i
    if cumsum >= total * 0.95:
        p95 = i
        break
spread = p95 - p5
if spread < 100:
    auto_contrast = 1.25
elif spread < 160:
    auto_contrast = 1.15
else:
    auto_contrast = 1.05
contrast_image = ImageEnhance.Contrast(image).enhance(auto_contrast)
contrast_crc32 = zlib.crc32(np.array(contrast_image, dtype=np.uint8).tobytes()) & 0xffffffff
saturation_image = ImageEnhance.Color(contrast_image).enhance(1.1)
saturation_crc32 = zlib.crc32(np.array(saturation_image, dtype=np.uint8).tobytes()) & 0xffffffff
image = ImageEnhance.Sharpness(saturation_image).enhance(1.3)
sharpness_crc32 = zlib.crc32(np.array(image, dtype=np.uint8).tobytes()) & 0xffffffff
preprocessed_crc32 = sharpness_crc32
image = _consolidate_extremes(image)
consolidated_crc32 = zlib.crc32(np.array(image, dtype=np.uint8).tobytes()) & 0xffffffff
preset_indices = palette.get_preset_indices('221')
sub_palette_size = _estimate_color_count(image, 48, 48)
selection_image = image.resize((120, 120), Image.LANCZOS)
selection_crc32 = zlib.crc32(np.array(selection_image, dtype=np.uint8).tobytes()) & 0xffffffff
sub_indices = palette.select_top_n_colors(
    np.array(selection_image).reshape(-1, 3).astype(np.float64),
    n=sub_palette_size,
    allowed_indices=preset_indices,
)
sub_colors = [palette.colors[int(i)] for i in sub_indices]
sub_codes = [c['code'] for c in sub_colors]
selection_image_pixels = np.array(selection_image, dtype=np.uint8).reshape(-1, 3).tolist()
sub_pal_img = _build_pil_palette_image_from_colors(sub_colors)

POOL_FACTOR = 4
img_mid = image.resize((48 * POOL_FACTOR, 48 * POOL_FACTOR), Image.LANCZOS)
mid_crc32 = zlib.crc32(np.array(img_mid, dtype=np.uint8).tobytes()) & 0xffffffff
img_mid_quantized = img_mid.quantize(palette=sub_pal_img, method=0, dither=0)
qnt_indices = np.array(img_mid_quantized, dtype=np.uint8)
pal_data = img_mid_quantized.getpalette()
sub_rgb_to_idx = {tuple(c['rgb']): i for i, c in enumerate(sub_colors)}
idx_mapping = np.zeros(256, dtype=np.uint8)
for actual_idx in range(256):
    r = pal_data[actual_idx * 3]
    g = pal_data[actual_idx * 3 + 1]
    b = pal_data[actual_idx * 3 + 2]
    rgb = (r, g, b)
    if rgb in sub_rgb_to_idx:
        idx_mapping[actual_idx] = sub_rgb_to_idx[rgb]
    else:
        best_idx = 0
        best_dist = float('inf')
        for sub_idx, c in enumerate(sub_colors):
            dr = r - c['rgb'][0]
            dg = g - c['rgb'][1]
            db = b - c['rgb'][2]
            dist = dr * dr + dg * dg + db * db
            if dist < best_dist:
                best_dist = dist
                best_idx = sub_idx
        idx_mapping[actual_idx] = best_idx
qnt_indices = idx_mapping[qnt_indices]
blocks = qnt_indices.reshape(48, POOL_FACTOR, 48, POOL_FACTOR)
blocks = blocks.transpose(0, 2, 1, 3).reshape(48, 48, POOL_FACTOR * POOL_FACTOR)
grid_indices = np.zeros((48, 48), dtype=np.uint8)
for y in range(48):
    for x in range(48):
        grid_indices[y, x] = np.bincount(blocks[y, x], minlength=len(sub_colors)).argmax()
pooled_matrix = [[sub_colors[int(grid_indices[y, x])]['code'] for x in range(48)] for y in range(48)]
cleaned_matrix = _cleanup_rare_colors([row[:] for row in pooled_matrix], palette, 48 * 48, 0.005)
final_matrix = _smooth_edges([row[:] for row in cleaned_matrix], palette)
print(json.dumps({
    'subpalette_codes': sub_codes,
    'original_crc32': image_crc32,
    'mean_gray': mean,
    'p5': p5,
    'p95': p95,
    'contrast_factor': auto_contrast,
    'contrast_crc32': contrast_crc32,
    'saturation_crc32': saturation_crc32,
    'sharpness_crc32': sharpness_crc32,
    'preprocessed_crc32': preprocessed_crc32,
    'consolidated_crc32': consolidated_crc32,
    'selection_crc32': selection_crc32,
    'mid_crc32': mid_crc32,
    'selection_image_pixels': selection_image_pixels,
    'pooled_matrix': pooled_matrix,
    'cleaned_matrix': cleaned_matrix,
    'final_matrix': final_matrix,
}))
"#;

    let output = Command::new(python_executable())
        .arg("-c")
        .arg(script)
        .arg(image_path)
        .current_dir(repo_root())
        .output()
        .unwrap();

    assert!(
        output.status.success(),
        "python stage dump failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    serde_json::from_slice(&output.stdout).unwrap()
}

#[test]
fn pure_rust_engine_matches_python_baseline_for_example_image() {
    let root = repo_root();
    let image_path = root.join("docs").join("examples").join("luoxiaohei_original.jpg");
    let image_bytes = fs::read(&image_path).unwrap();
    let python_payload = run_python_baseline(&image_path);
    let python_stages = run_python_stage_dump(&image_path);
    let rust_debug =
        backend_rs::engine::debug_pipeline(&image_bytes, backend_rs::types::GenerateOptions::default()).unwrap();
    let python_subpalette_codes = python_stages["subpalette_codes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|value| value.as_str().unwrap().to_string())
        .collect::<Vec<_>>();
    let rust_debug_forced = backend_rs::engine::debug_pipeline_with_subpalette_codes(
        &image_bytes,
        backend_rs::types::GenerateOptions::default(),
        &python_subpalette_codes,
    )
    .unwrap();
    println!("rust_subpalette={:?}", rust_debug.subpalette_codes);
    println!(
        "python_subpalette={:?}",
        python_stages["subpalette_codes"].as_array().unwrap()
    );
    println!(
        "input rust=(crc:{},mean:{},p5:{},p95:{},factor:{}) python=(crc:{},mean:{},p5:{},p95:{},factor:{})",
        rust_debug.original_crc32,
        rust_debug.mean_gray,
        rust_debug.p5,
        rust_debug.p95,
        rust_debug.contrast_factor,
        python_stages["original_crc32"].as_u64().unwrap(),
        python_stages["mean_gray"].as_u64().unwrap(),
        python_stages["p5"].as_u64().unwrap(),
        python_stages["p95"].as_u64().unwrap(),
        python_stages["contrast_factor"].as_f64().unwrap(),
    );
    println!(
        "stage_crc rust=({},{},{},{},{},{},{}) python=({},{},{},{},{},{},{})",
        rust_debug.contrast_crc32,
        rust_debug.saturation_crc32,
        rust_debug.sharpness_crc32,
        rust_debug.preprocessed_crc32,
        rust_debug.consolidated_crc32,
        rust_debug.selection_crc32,
        rust_debug.mid_crc32,
        python_stages["contrast_crc32"].as_u64().unwrap(),
        python_stages["saturation_crc32"].as_u64().unwrap(),
        python_stages["sharpness_crc32"].as_u64().unwrap(),
        python_stages["preprocessed_crc32"].as_u64().unwrap(),
        python_stages["consolidated_crc32"].as_u64().unwrap(),
        python_stages["selection_crc32"].as_u64().unwrap(),
        python_stages["mid_crc32"].as_u64().unwrap(),
    );
    println!(
        "rust_selection_focus={:?}",
        rust_debug
            .selection_ranked
            .iter()
            .filter(|(code, _)| ["G20", "G21", "M5", "M8", "M13"].contains(&code.as_str()))
            .collect::<Vec<_>>()
    );
    if serde_json::to_value(&rust_debug_forced.pooled_matrix).unwrap() != python_stages["pooled_matrix"] {
        let rust_pooled = serde_json::to_value(&rust_debug_forced.pooled_matrix).unwrap();
        let python_pooled = &python_stages["pooled_matrix"];
        let rust_rows = rust_pooled.as_array().unwrap();
        let python_rows = python_pooled.as_array().unwrap();
        let total_diff = rust_rows
            .iter()
            .zip(python_rows.iter())
            .map(|(rust_row, python_row)| {
                rust_row
                    .as_array()
                    .unwrap()
                    .iter()
                    .zip(python_row.as_array().unwrap().iter())
                    .filter(|(lhs, rhs)| lhs != rhs)
                    .count()
            })
            .sum::<usize>();
        println!("forced_subpalette_pooled_total_diff={total_diff}");
    }
    if serde_json::to_value(&rust_debug.selection_image_pixels).unwrap() != python_stages["selection_image_pixels"] {
        let rust_pixels = serde_json::to_value(&rust_debug.selection_image_pixels).unwrap();
        let python_pixels = &python_stages["selection_image_pixels"];
        let rust_pixels = rust_pixels.as_array().unwrap();
        let python_pixels = python_pixels.as_array().unwrap();
        let mut diffs = Vec::new();
        for (idx, (lhs, rhs)) in rust_pixels.iter().zip(python_pixels.iter()).enumerate() {
            if lhs != rhs {
                let x = idx % 120;
                let y = idx / 120;
                diffs.push((x, y, lhs.clone(), rhs.clone()));
                if diffs.len() >= 12 {
                    break;
                }
            }
        }
        let total_diff = rust_pixels
            .iter()
            .zip(python_pixels.iter())
            .filter(|(lhs, rhs)| lhs != rhs)
            .count();
        println!("selection_image_total_diff={total_diff} selection_first_diffs={diffs:?}");
    }
    if serde_json::to_value(&rust_debug.pooled_matrix).unwrap() != python_stages["pooled_matrix"] {
        let rust_pooled = serde_json::to_value(&rust_debug.pooled_matrix).unwrap();
        let python_pooled = &python_stages["pooled_matrix"];
        let rust_rows = rust_pooled.as_array().unwrap();
        let python_rows = python_pooled.as_array().unwrap();
        let mut diffs = Vec::new();
        for (y, (rust_row, python_row)) in rust_rows.iter().zip(python_rows.iter()).enumerate() {
            let rust_row = rust_row.as_array().unwrap();
            let python_row = python_row.as_array().unwrap();
            for (x, (rust_cell, python_cell)) in rust_row.iter().zip(python_row.iter()).enumerate() {
                if rust_cell != python_cell {
                    diffs.push((x, y, rust_cell.clone(), python_cell.clone()));
                    if diffs.len() >= 12 {
                        break;
                    }
                }
            }
            if diffs.len() >= 12 {
                break;
            }
        }
        let total_diff = rust_rows
            .iter()
            .zip(python_rows.iter())
            .map(|(rust_row, python_row)| {
                rust_row
                    .as_array()
                    .unwrap()
                    .iter()
                    .zip(python_row.as_array().unwrap().iter())
                    .filter(|(lhs, rhs)| lhs != rhs)
                    .count()
            })
            .sum::<usize>();
        println!("pooled_total_diff={total_diff} pooled_first_diffs={diffs:?}");
    }
    if serde_json::to_value(&rust_debug.cleaned_matrix).unwrap() != python_stages["cleaned_matrix"] {
        let rust_cleaned = serde_json::to_value(&rust_debug.cleaned_matrix).unwrap();
        let python_cleaned = &python_stages["cleaned_matrix"];
        let rust_rows = rust_cleaned.as_array().unwrap();
        let python_rows = python_cleaned.as_array().unwrap();
        let mut diffs = Vec::new();
        for (y, (rust_row, python_row)) in rust_rows.iter().zip(python_rows.iter()).enumerate() {
            let rust_row = rust_row.as_array().unwrap();
            let python_row = python_row.as_array().unwrap();
            for (x, (rust_cell, python_cell)) in rust_row.iter().zip(python_row.iter()).enumerate() {
                if rust_cell != python_cell {
                    diffs.push((x, y, rust_cell.clone(), python_cell.clone()));
                    if diffs.len() >= 12 {
                        break;
                    }
                }
            }
            if diffs.len() >= 12 {
                break;
            }
        }
        let total_diff = rust_rows
            .iter()
            .zip(python_rows.iter())
            .map(|(rust_row, python_row)| {
                rust_row
                    .as_array()
                    .unwrap()
                    .iter()
                    .zip(python_row.as_array().unwrap().iter())
                    .filter(|(lhs, rhs)| lhs != rhs)
                    .count()
            })
            .sum::<usize>();
        println!("cleaned_total_diff={total_diff} cleaned_first_diffs={diffs:?}");
    }

    let rust_payload = backend_rs::engine::process_image_bytes(
        &image_bytes,
        backend_rs::types::GenerateOptions::default(),
    )
    .unwrap();

    assert_eq!(rust_payload.grid_size.width, python_payload["grid_size"]["width"]);
    assert_eq!(rust_payload.grid_size.height, python_payload["grid_size"]["height"]);
    let rust_matrix = serde_json::to_value(&rust_payload.pixel_matrix).unwrap();
    let python_matrix = &python_payload["pixel_matrix"];
    if rust_matrix != *python_matrix {
        let rust_rows = rust_matrix.as_array().unwrap();
        let python_rows = python_matrix.as_array().unwrap();
        let mut diffs = Vec::new();
        for (y, (rust_row, python_row)) in rust_rows.iter().zip(python_rows.iter()).enumerate() {
            let rust_row = rust_row.as_array().unwrap();
            let python_row = python_row.as_array().unwrap();
            for (x, (rust_cell, python_cell)) in rust_row.iter().zip(python_row.iter()).enumerate() {
                if rust_cell != python_cell {
                    diffs.push((x, y, rust_cell.clone(), python_cell.clone()));
                    if diffs.len() >= 12 {
                        break;
                    }
                }
            }
            if diffs.len() >= 12 {
                break;
            }
        }
        let total_diff = rust_rows
            .iter()
            .zip(python_rows.iter())
            .map(|(rust_row, python_row)| {
                rust_row
                    .as_array()
                    .unwrap()
                    .iter()
                    .zip(python_row.as_array().unwrap().iter())
                    .filter(|(lhs, rhs)| lhs != rhs)
                    .count()
            })
            .sum::<usize>();
        println!("total_diff={total_diff} first_diffs={diffs:?}");
    }
    assert_eq!(
        rust_matrix,
        python_payload["pixel_matrix"]
    );
    assert_eq!(
        serde_json::to_value(&rust_payload.color_summary).unwrap(),
        python_payload["color_summary"]
    );
    assert_eq!(rust_payload.total_beads, python_payload["total_beads"]);
}
