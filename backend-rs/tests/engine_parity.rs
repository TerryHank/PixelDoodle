use std::{
    fs,
    path::{Path, PathBuf},
};

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("backend-rs should live under repo root")
        .to_path_buf()
}

fn example_image_bytes() -> Vec<u8> {
    fs::read(
        repo_root()
            .join("docs")
            .join("examples")
            .join("luoxiaohei_original.jpg"),
    )
    .unwrap()
}

#[test]
fn debug_pipeline_final_matrix_matches_engine_output() {
    let bytes = example_image_bytes();
    let options = backend_rs::types::GenerateOptions::default();

    let debug = backend_rs::engine::debug_pipeline(&bytes, options.clone()).unwrap();
    let output = backend_rs::engine::process_image_bytes(&bytes, options).unwrap();

    assert_eq!(debug.final_matrix, output.pixel_matrix);
    assert_eq!(debug.final_matrix.len(), output.grid_size.height);
    assert_eq!(debug.final_matrix.first().map(Vec::len).unwrap_or(0), output.grid_size.width);
    assert_eq!(output.preview_image, "");
}

#[test]
fn debug_pipeline_respects_forced_subpalette_codes() {
    let bytes = example_image_bytes();
    let options = backend_rs::types::GenerateOptions::default();

    let baseline = backend_rs::engine::debug_pipeline(&bytes, options.clone()).unwrap();
    let forced = backend_rs::engine::debug_pipeline_with_subpalette_codes(
        &bytes,
        options,
        &baseline.subpalette_codes,
    )
    .unwrap();

    assert_eq!(forced.subpalette_codes, baseline.subpalette_codes);
    assert_eq!(forced.final_matrix, baseline.final_matrix);
    assert_eq!(forced.cleaned_matrix, baseline.cleaned_matrix);
}
