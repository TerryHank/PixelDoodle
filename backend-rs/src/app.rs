use std::collections::HashMap;

use axum::{
    extract::Multipart,
    http::StatusCode,
    response::{Html, IntoResponse},
    routing::{get, post},
    Json, Router,
};
use chrono::Local;
use serde::Serialize;
use serde_json::{json, Value};
use tower_http::services::ServeDir;
use uuid::Uuid;

use crate::{
    device::{
        highlight_serial, list_ble_devices, list_serial_ports, send_to_ble_backend, send_to_serial,
        BleDevicesResponse, BleSendResponse, HighlightRequest, HighlightResponse, SerialPortsResponse,
        SerialSendRequest, SendResponse,
    },
    engine,
    export::{self, BinaryExport, ExportRequest},
    repo_root,
    types::GenerateOptions,
};

#[derive(Debug, Serialize)]
struct PaletteResponse {
    colors: Value,
    presets: Value,
}

async fn read_json_file(path: std::path::PathBuf) -> Value {
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

async fn generate_pattern(mut multipart: Multipart) -> Result<Json<Value>, (StatusCode, String)> {
    let mut fields = HashMap::<String, String>::new();
    let mut file_bytes = Vec::new();
    let mut file_content_type = String::new();

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

    let options = GenerateOptions {
        mode: field_string(&fields, "mode", "fixed_grid"),
        grid_width: field_usize(&fields, "grid_width", 48),
        grid_height: field_usize(&fields, "grid_height", 48),
        led_size: field_usize(&fields, "led_size", 64),
        pixel_size: field_usize(&fields, "pixel_size", 8),
        use_dithering: field_bool(&fields, "use_dithering", false),
        palette_preset: field_string(&fields, "palette_preset", "221"),
        max_colors: field_usize(&fields, "max_colors", 0),
        similarity_threshold: field_usize(&fields, "similarity_threshold", 0),
        remove_bg: field_bool(&fields, "remove_bg", false),
        contrast: field_f32(&fields, "contrast", 0.0),
        saturation: field_f32(&fields, "saturation", 0.0),
        sharpness: field_f32(&fields, "sharpness", 0.0),
    };

    let palette_preset = options.palette_preset.clone();
    let result = engine::process_image_bytes(&file_bytes, options)
        .map_err(|err| (StatusCode::INTERNAL_SERVER_ERROR, format!("Processing failed: {err}")))?;

    Ok(Json(json!({
        "session_id": Uuid::new_v4().to_string(),
        "grid_size": result.grid_size,
        "pixel_matrix": result.pixel_matrix,
        "color_summary": result.color_summary,
        "total_beads": result.total_beads,
        "palette_preset": palette_preset,
        "preview_image": result.preview_image,
    })))
}

fn field_string(fields: &HashMap<String, String>, key: &str, default: &str) -> String {
    fields.get(key).cloned().unwrap_or_else(|| default.to_string())
}

fn field_usize(fields: &HashMap<String, String>, key: &str, default: usize) -> usize {
    fields
        .get(key)
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(default)
}

fn field_f32(fields: &HashMap<String, String>, key: &str, default: f32) -> f32 {
    fields
        .get(key)
        .and_then(|value| value.parse::<f32>().ok())
        .unwrap_or(default)
}

fn field_bool(fields: &HashMap<String, String>, key: &str, default: bool) -> bool {
    fields
        .get(key)
        .map(|value| matches!(value.to_ascii_lowercase().as_str(), "true" | "1" | "yes" | "on"))
        .unwrap_or(default)
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
    let request: ExportRequest = serde_json::from_value(data)
        .map_err(|err| (StatusCode::BAD_REQUEST, format!("Invalid export request: {err}")))?;
    let export = export::export_png(request)
        .map_err(|err| (StatusCode::INTERNAL_SERVER_ERROR, format!("PNG export failed: {err}")))?;
    Ok(build_binary_response(export))
}

async fn export_pattern_pdf(Json(data): Json<Value>) -> Result<impl IntoResponse, (StatusCode, String)> {
    let request: ExportRequest = serde_json::from_value(data)
        .map_err(|err| (StatusCode::BAD_REQUEST, format!("Invalid export request: {err}")))?;
    let export = export::export_pdf(request)
        .map_err(|err| (StatusCode::INTERNAL_SERVER_ERROR, format!("PDF export failed: {err}")))?;
    Ok(build_binary_response(export))
}

fn build_binary_response(export: BinaryExport) -> impl IntoResponse {
    (
        [
            (axum::http::header::CONTENT_TYPE, export.content_type),
            (
                axum::http::header::CONTENT_DISPOSITION,
                format!("attachment; filename={}", export.filename),
            ),
        ],
        export.body,
    )
}

async fn get_serial_ports() -> Result<Json<SerialPortsResponse>, (StatusCode, String)> {
    let response = list_serial_ports()
        .map_err(|err| (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()))?;
    Ok(Json(response))
}

async fn send_serial(Json(data): Json<SerialSendRequest>) -> Result<Json<SendResponse>, (StatusCode, String)> {
    let response = send_to_serial(data)
        .map_err(|err| (StatusCode::BAD_REQUEST, err.to_string()))?;
    Ok(Json(response))
}

async fn send_serial_highlight(
    Json(data): Json<HighlightRequest>,
) -> Result<Json<HighlightResponse>, (StatusCode, String)> {
    let response = highlight_serial(data)
        .map_err(|err| (StatusCode::BAD_REQUEST, err.to_string()))?;
    Ok(Json(response))
}

async fn get_ble_devices() -> Json<BleDevicesResponse> {
    Json(list_ble_devices())
}

async fn send_to_ble(Json(_data): Json<Value>) -> Json<BleSendResponse> {
    Json(send_to_ble_backend())
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
        .route("/api/serial/send", post(send_serial))
        .route("/api/serial/highlight", post(send_serial_highlight))
        .route("/api/ble/devices", get(get_ble_devices))
        .route("/api/ble/send", post(send_to_ble))
        .nest_service("/static", ServeDir::new(repo_root().join("static")))
        .nest_service("/examples", ServeDir::new(repo_root().join("docs").join("examples")))
}
