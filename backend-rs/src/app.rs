use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

use axum::{
    extract::Multipart,
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::Serialize;
use serde_json::{json, Value};
use tokio::process::Command;
use uuid::Uuid;

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

fn python_executable() -> &'static str {
    if let Ok(path) = std::env::var("PYTHON_EXECUTABLE") {
        return Box::leak(path.into_boxed_str());
    }
    if cfg!(windows) {
        "python"
    } else {
        "python3"
    }
}

async fn generate_pattern(mut multipart: Multipart) -> Result<Json<Value>, (StatusCode, String)> {
    let root = repo_root();
    let mut fields = HashMap::<String, String>::new();
    let mut file_bytes = Vec::new();
    let mut file_content_type = String::new();
    let mut file_name = String::from("upload.bin");

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|err| (StatusCode::BAD_REQUEST, format!("Failed to read multipart field: {err}")))?
    {
        let name = field.name().unwrap_or_default().to_string();
        if name == "file" {
            if let Some(content_type) = field.content_type() {
                file_content_type = content_type.to_string();
            }
            if let Some(upload_name) = field.file_name() {
                file_name = upload_name.to_string();
            }
            file_bytes = field
                .bytes()
                .await
                .map_err(|err| (StatusCode::BAD_REQUEST, format!("Failed to read upload file: {err}")))?
                .to_vec();
        } else {
            let value = field
                .text()
                .await
                .map_err(|err| (StatusCode::BAD_REQUEST, format!("Failed to read form value: {err}")))?;
            fields.insert(name, value);
        }
    }

    if file_bytes.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Please upload an image file".to_string()));
    }
    if !file_content_type.is_empty() && !file_content_type.starts_with("image/") {
        return Err((StatusCode::BAD_REQUEST, "Please upload an image file".to_string()));
    }
    if file_bytes.len() > 20 * 1024 * 1024 {
        return Err((StatusCode::BAD_REQUEST, "File size exceeds 20MB limit".to_string()));
    }

    let work_dir = root.join("backend-rs").join("target").join("bridge");
    tokio::fs::create_dir_all(&work_dir)
        .await
        .map_err(|err| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to prepare bridge dir: {err}")))?;

    let request_id = Uuid::new_v4().to_string();
    let safe_name = Path::new(&file_name)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("upload.bin");
    let upload_path = work_dir.join(format!("{request_id}-{safe_name}"));
    let request_path = work_dir.join(format!("{request_id}.json"));

    tokio::fs::write(&upload_path, &file_bytes)
        .await
        .map_err(|err| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to persist upload: {err}")))?;

    let request_payload = json!({
        "file_path": upload_path.to_string_lossy(),
        "mode": fields.get("mode").cloned().unwrap_or_else(|| "fixed_grid".to_string()),
        "grid_width": fields.get("grid_width").cloned().unwrap_or_else(|| "48".to_string()),
        "grid_height": fields.get("grid_height").cloned().unwrap_or_else(|| "48".to_string()),
        "led_size": fields.get("led_size").cloned().unwrap_or_else(|| "64".to_string()),
        "pixel_size": fields.get("pixel_size").cloned().unwrap_or_else(|| "8".to_string()),
        "use_dithering": fields.get("use_dithering").cloned().unwrap_or_else(|| "false".to_string()),
        "palette_preset": fields.get("palette_preset").cloned().unwrap_or_else(|| "221".to_string()),
        "max_colors": fields.get("max_colors").cloned().unwrap_or_else(|| "0".to_string()),
        "similarity_threshold": fields.get("similarity_threshold").cloned().unwrap_or_else(|| "0".to_string()),
        "remove_bg": fields.get("remove_bg").cloned().unwrap_or_else(|| "false".to_string()),
        "contrast": fields.get("contrast").cloned().unwrap_or_else(|| "0".to_string()),
        "saturation": fields.get("saturation").cloned().unwrap_or_else(|| "0".to_string()),
        "sharpness": fields.get("sharpness").cloned().unwrap_or_else(|| "0".to_string()),
    });

    tokio::fs::write(
        &request_path,
        serde_json::to_vec(&request_payload)
            .map_err(|err| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to serialize request: {err}")))?,
    )
    .await
    .map_err(|err| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to persist request payload: {err}")))?;

    let output = Command::new(python_executable())
        .arg(root.join("tools").join("parity").join("generate_baseline.py"))
        .arg("generate")
        .arg(&request_path)
        .current_dir(&root)
        .output()
        .await
        .map_err(|err| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to start python bridge: {err}")))?;

    let _ = tokio::fs::remove_file(&upload_path).await;
    let _ = tokio::fs::remove_file(&request_path).await;

    if !output.status.success() {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!(
                "Processing failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ),
        ));
    }

    let payload: Value = serde_json::from_slice(&output.stdout)
        .map_err(|err| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to decode bridge output: {err}")))?;

    Ok(Json(payload))
}

pub async fn build_app() -> Router {
    Router::new()
        .route("/api/palette", get(get_palette))
        .route("/api/generate", post(generate_pattern))
}
