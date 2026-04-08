use std::{
    fs,
    path::{Path, PathBuf},
};

use backend_rs::{engine, types::GenerateOptions};
use serde_json::Value;

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("backend-rs should live under repo root")
        .to_path_buf()
}

fn generate_options() -> GenerateOptions {
    GenerateOptions {
        mode: "fixed_grid".to_string(),
        grid_width: 64,
        grid_height: 64,
        led_size: 64,
        pixel_size: 8,
        use_dithering: false,
        palette_preset: "221".to_string(),
        max_colors: 0,
        similarity_threshold: 0,
        remove_bg: true,
        contrast: 0.0,
        saturation: 0.0,
        sharpness: 0.0,
    }
}

#[test]
fn wasm_engine_matches_backend_engine_for_main_page_defaults() {
    let root = repo_root();
    let image_path = root
        .join("docs")
        .join("examples")
        .join("luoxiaohei_original.jpg");
    let image_bytes = fs::read(&image_path).unwrap();
    let options = generate_options();

    let backend_output = engine::process_image_bytes(&image_bytes, options.clone()).unwrap();
    let wasm_output =
        beadcraft_wasm::process_image_bytes_host(&image_bytes, serde_json::to_value(options).unwrap())
            .expect("wasm engine should process example image");

    let backend_value = serde_json::to_value(&backend_output).unwrap();
    let wasm_value: Value = serde_json::from_value(wasm_output).unwrap();

    assert_eq!(backend_value["grid_size"], wasm_value["grid_size"]);
    assert_eq!(backend_value["pixel_matrix"], wasm_value["pixel_matrix"]);
    assert_eq!(backend_value["color_summary"], wasm_value["color_summary"]);
    assert_eq!(backend_value["total_beads"], wasm_value["total_beads"]);
    assert_eq!(backend_value["preview_image"], wasm_value["preview_image"]);
}
