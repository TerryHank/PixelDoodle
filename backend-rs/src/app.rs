use std::path::{Path, PathBuf};

use axum::{routing::get, Json, Router};
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Serialize)]
struct PaletteResponse {
    colors: Value,
    presets: Value,
}

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("backend-rs should live under repo root")
        .to_path_buf()
}

async fn read_json_file(path: PathBuf) -> Value {
    let text = tokio::fs::read_to_string(path)
        .await
        .expect("palette source file should exist");
    serde_json::from_str(&text).expect("palette source json should be valid")
}

async fn get_palette() -> Json<PaletteResponse> {
    let root = repo_root();
    let colors = read_json_file(root.join("data").join("artkal_m_series.json")).await;
    let presets = read_json_file(root.join("data").join("artkal_presets.json")).await;
    Json(PaletteResponse { colors, presets })
}

pub async fn build_app() -> Router {
    Router::new().route("/api/palette", get(get_palette))
}
