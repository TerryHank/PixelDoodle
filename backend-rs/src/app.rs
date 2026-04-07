use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

use axum::{
    extract::Multipart,
    http::StatusCode,
    response::{Html, IntoResponse},
    routing::{get, post},
    Json, Router,
};
use base64::Engine;
use chrono::Local;
use serde::Serialize;
use serde_json::{json, Value};
use tokio::process::Command;
use tower_http::services::ServeDir;
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

async fn index() -> Result<Html<String>, (StatusCode, String)> {
    let html = tokio::fs::read_to_string(repo_root().join("templates").join("index.html"))
        .await
        .map_err(|err| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to load index: {err}")))?;
    Ok(Html(html))
}

fn python_executable() -> String {
    if let Ok(path) = std::env::var("PYTHON_EXECUTABLE") {
        return path;
    }

    let root = repo_root();
    let local_windows = root.join(".venv").join("Scripts").join("python.exe");
    if local_windows.exists() {
        return local_windows.to_string_lossy().to_string();
    }
    let local_unix = root.join(".venv").join("bin").join("python");
    if local_unix.exists() {
        return local_unix.to_string_lossy().to_string();
    }

    if cfg!(windows) {
        "python".to_string()
    } else {
        "python3".to_string()
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
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
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

async fn run_export_bridge(command: &str, payload: Value) -> Result<impl IntoResponse, (StatusCode, String)> {
    let root = repo_root();
    let work_dir = root.join("backend-rs").join("target").join("bridge");
    tokio::fs::create_dir_all(&work_dir)
        .await
        .map_err(|err| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to prepare bridge dir: {err}")))?;

    let request_id = Uuid::new_v4().to_string();
    let request_path = work_dir.join(format!("export-{request_id}.json"));
    tokio::fs::write(
        &request_path,
        serde_json::to_vec(&payload)
            .map_err(|err| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to serialize export payload: {err}")))?,
    )
    .await
    .map_err(|err| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to persist export payload: {err}")))?;

    let output = Command::new(python_executable())
        .arg(root.join("tools").join("parity").join("export_baseline.py"))
        .arg(command)
        .arg(&request_path)
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .current_dir(&root)
        .output()
        .await
        .map_err(|err| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to start export bridge: {err}")))?;

    let _ = tokio::fs::remove_file(&request_path).await;

    if !output.status.success() {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Export failed: {}", String::from_utf8_lossy(&output.stderr).trim()),
        ));
    }

    let payload: Value = serde_json::from_slice(&output.stdout)
        .map_err(|err| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to decode export output: {err}")))?;
    let content_type = payload["content_type"]
        .as_str()
        .unwrap_or("application/octet-stream")
        .to_string();
    let filename = payload["filename"]
        .as_str()
        .unwrap_or("beadcraft_export.bin")
        .to_string();
    let body_base64 = payload["body_base64"]
        .as_str()
        .ok_or_else(|| (StatusCode::INTERNAL_SERVER_ERROR, "Export response missing body".to_string()))?;
    let body = base64::engine::general_purpose::STANDARD
        .decode(body_base64)
        .map_err(|err| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to decode export body: {err}")))?;

    Ok((
        [
            (axum::http::header::CONTENT_TYPE, content_type),
            (
                axum::http::header::CONTENT_DISPOSITION,
                format!("attachment; filename={filename}"),
            ),
        ],
        body,
    ))
}

async fn run_json_bridge(script_name: &str, command: &str, payload: Option<Value>) -> Result<Value, (StatusCode, String)> {
    let root = repo_root();
    let work_dir = root.join("backend-rs").join("target").join("bridge");
    tokio::fs::create_dir_all(&work_dir)
        .await
        .map_err(|err| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to prepare bridge dir: {err}")))?;

    let request_id = Uuid::new_v4().to_string();
    let request_path = work_dir.join(format!("{script_name}-{request_id}.json"));

    let maybe_request_arg = if let Some(payload) = payload {
        tokio::fs::write(
            &request_path,
            serde_json::to_vec(&payload)
                .map_err(|err| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to serialize bridge payload: {err}")))?,
        )
        .await
        .map_err(|err| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to persist bridge payload: {err}")))?;
        Some(request_path.clone())
    } else {
        None
    };

    let mut process = Command::new(python_executable());
    process
        .arg(root.join("tools").join("parity").join(script_name))
        .arg(command)
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .current_dir(&root);
    if let Some(path) = &maybe_request_arg {
        process.arg(path);
    }

    let output = process
        .output()
        .await
        .map_err(|err| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to start {script_name}: {err}")))?;

    if maybe_request_arg.is_some() {
        let _ = tokio::fs::remove_file(&request_path).await;
    }

    if !output.status.success() {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("{command} failed: {}", String::from_utf8_lossy(&output.stderr).trim()),
        ));
    }

    serde_json::from_slice(&output.stdout)
        .map_err(|err| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to decode bridge output: {err}")))
}

async fn export_pattern_json(Json(data): Json<Value>) -> Result<impl IntoResponse, (StatusCode, String)> {
    let pixel_matrix = data
        .get("pixel_matrix")
        .and_then(|value| value.as_array())
        .ok_or_else(|| (StatusCode::BAD_REQUEST, "pixel_matrix is required".to_string()))?;
    let width = pixel_matrix
        .first()
        .and_then(|row| row.as_array())
        .map(|row| row.len())
        .unwrap_or(0);
    let height = pixel_matrix.len();

    let timestamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
    let export_data = json!({
        "version": "1.0",
        "exported_at": Local::now().to_rfc3339(),
        "dimensions": {
            "width": width,
            "height": height,
        },
        "pixel_matrix": data.get("pixel_matrix").cloned().unwrap_or(Value::Null),
        "color_summary": data.get("color_summary").cloned().unwrap_or_else(|| json!([])),
    });

    Ok((
        [
            (axum::http::header::CONTENT_TYPE, "application/json".to_string()),
            (
                axum::http::header::CONTENT_DISPOSITION,
                format!("attachment; filename=beadcraft_pattern_{timestamp}.json"),
            ),
        ],
        serde_json::to_vec_pretty(&export_data)
            .map_err(|err| (StatusCode::INTERNAL_SERVER_ERROR, format!("JSON export failed: {err}")))?,
    ))
}

async fn export_pattern_png(Json(data): Json<Value>) -> Result<impl IntoResponse, (StatusCode, String)> {
    if data.get("pixel_matrix").is_none() {
        return Err((StatusCode::BAD_REQUEST, "pixel_matrix is required".to_string()));
    }
    run_export_bridge("png", data).await
}

async fn export_pattern_pdf(Json(data): Json<Value>) -> Result<impl IntoResponse, (StatusCode, String)> {
    if data.get("pixel_matrix").is_none() {
        return Err((StatusCode::BAD_REQUEST, "pixel_matrix is required".to_string()));
    }
    run_export_bridge("pdf", data).await
}

async fn get_serial_ports() -> Result<Json<Value>, (StatusCode, String)> {
    Ok(Json(run_json_bridge("device_bridge.py", "serial_ports", None).await?))
}

async fn send_to_serial(Json(data): Json<Value>) -> Result<Json<Value>, (StatusCode, String)> {
    if data.get("pixel_matrix").is_none() {
        return Err((StatusCode::BAD_REQUEST, "pixel_matrix is required".to_string()));
    }
    if data.get("port").is_none() {
        return Err((StatusCode::BAD_REQUEST, "port is required".to_string()));
    }
    Ok(Json(run_json_bridge("device_bridge.py", "serial_send", Some(data)).await?))
}

async fn highlight_serial(Json(data): Json<Value>) -> Result<Json<Value>, (StatusCode, String)> {
    if data.get("port").is_none() {
        return Err((StatusCode::BAD_REQUEST, "port is required".to_string()));
    }
    Ok(Json(run_json_bridge("device_bridge.py", "serial_highlight", Some(data)).await?))
}

async fn get_ble_devices() -> Result<Json<Value>, (StatusCode, String)> {
    Ok(Json(run_json_bridge("device_bridge.py", "ble_devices", None).await?))
}

async fn send_to_ble(Json(data): Json<Value>) -> Result<Json<Value>, (StatusCode, String)> {
    if data.get("pixel_matrix").is_none() {
        return Err((StatusCode::BAD_REQUEST, "pixel_matrix is required".to_string()));
    }
    Ok(Json(run_json_bridge("device_bridge.py", "ble_send", Some(data)).await?))
}

pub async fn build_app() -> Router {
    Router::new()
        .route("/", get(index))
        .route("/api/palette", get(get_palette))
        .route("/api/generate", post(generate_pattern))
        .route("/api/export/json", post(export_pattern_json))
        .route("/api/export/png", post(export_pattern_png))
        .route("/api/export/pdf", post(export_pattern_pdf))
        .route("/api/serial/ports", get(get_serial_ports))
        .route("/api/serial/send", post(send_to_serial))
        .route("/api/serial/highlight", post(highlight_serial))
        .route("/api/ble/devices", get(get_ble_devices))
        .route("/api/ble/send", post(send_to_ble))
        .nest_service("/static", ServeDir::new(repo_root().join("static")))
        .nest_service("/examples", ServeDir::new(repo_root().join("docs").join("examples")))
}
