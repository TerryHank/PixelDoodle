use std::{
    collections::{HashMap, VecDeque},
    sync::{Mutex, OnceLock},
};

use axum::{
    extract::Multipart,
    http::{HeaderMap, StatusCode},
    response::{Html, IntoResponse},
    routing::{get, post},
    Json, Router,
};
use chrono::Local;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tower_http::services::ServeDir;
use uuid::Uuid;

use crate::{
    device::{
        highlight_serial, list_ble_devices, list_serial_ports, send_to_ble_backend, send_to_serial,
        BleDevicesResponse, BleSendResponse, HighlightRequest, HighlightResponse, SendResponse,
        SerialPortsResponse, SerialSendRequest,
    },
    engine,
    export::{self, BinaryExport, ExportRequest},
    repo_root,
    types::{EngineOutput, GenerateOptions},
};

#[derive(Debug, Serialize)]
struct PaletteResponse {
    colors: Value,
    presets: Value,
}

const GENERATE_CACHE_MAX_ENTRIES: usize = 64;

#[derive(Debug)]
struct GenerateCacheStore {
    entries: HashMap<String, EngineOutput>,
    order: VecDeque<String>,
    max_entries: usize,
}

impl Default for GenerateCacheStore {
    fn default() -> Self {
        Self::with_capacity(GENERATE_CACHE_MAX_ENTRIES)
    }
}

impl GenerateCacheStore {
    fn with_capacity(max_entries: usize) -> Self {
        Self {
            entries: HashMap::new(),
            order: VecDeque::new(),
            max_entries: max_entries.max(1),
        }
    }

    fn get(&mut self, key: &str) -> Option<EngineOutput> {
        let value = self.entries.get(key)?.clone();
        self.touch(key);
        Some(value)
    }

    fn insert(&mut self, key: String, value: EngineOutput) {
        if self.entries.contains_key(&key) {
            self.entries.insert(key.clone(), value);
            self.touch(&key);
            return;
        }

        if self.entries.len() >= self.max_entries {
            if let Some(oldest) = self.order.pop_front() {
                self.entries.remove(&oldest);
            }
        }

        self.order.push_back(key.clone());
        self.entries.insert(key, value);
    }

    fn touch(&mut self, key: &str) {
        if let Some(position) = self.order.iter().position(|existing| existing == key) {
            self.order.remove(position);
        }
        self.order.push_back(key.to_string());
    }
}

fn generate_cache() -> &'static Mutex<GenerateCacheStore> {
    static CACHE: OnceLock<Mutex<GenerateCacheStore>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(GenerateCacheStore::default()))
}

fn build_generate_cache_key(file_bytes: &[u8], options: &GenerateOptions) -> String {
    let mut hasher = Sha256::new();
    hasher.update(file_bytes);
    hasher.update([0u8]);
    hasher.update(serde_json::to_vec(options).expect("generate options should serialize"));
    format!("{:x}", hasher.finalize())
}

fn build_generate_response(result: EngineOutput, palette_preset: String) -> Json<Value> {
    Json(json!({
        "session_id": Uuid::new_v4().to_string(),
        "grid_size": result.grid_size,
        "pixel_matrix": result.pixel_matrix,
        "color_summary": result.color_summary,
        "total_beads": result.total_beads,
        "palette_preset": palette_preset,
        "preview_image": result.preview_image,
    }))
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
        .map_err(|err| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to load index: {err}"),
            )
        })?;
    Ok(Html(html))
}

async fn generate_pattern(
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Result<Json<Value>, (StatusCode, String)> {
    let mut fields = HashMap::<String, String>::new();
    let mut file_bytes = Vec::new();
    let mut file_content_type = String::new();

    while let Some(field) = multipart.next_field().await.map_err(|err| {
        (
            StatusCode::BAD_REQUEST,
            format!("Failed to read multipart field: {err}"),
        )
    })? {
        let name = field.name().unwrap_or_default().to_string();
        if name == "file" {
            if let Some(content_type) = field.content_type() {
                file_content_type = content_type.to_string();
            }
            file_bytes = field
                .bytes()
                .await
                .map_err(|err| {
                    (
                        StatusCode::BAD_REQUEST,
                        format!("Failed to read upload file: {err}"),
                    )
                })?
                .to_vec();
        } else {
            let value = field.text().await.map_err(|err| {
                (
                    StatusCode::BAD_REQUEST,
                    format!("Failed to read form value: {err}"),
                )
            })?;
            fields.insert(name, value);
        }
    }

    if file_bytes.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "Please upload an image file".to_string(),
        ));
    }
    if !file_content_type.is_empty() && !file_content_type.starts_with("image/") {
        return Err((
            StatusCode::BAD_REQUEST,
            "Please upload an image file".to_string(),
        ));
    }
    if file_bytes.len() > 20 * 1024 * 1024 {
        return Err((
            StatusCode::BAD_REQUEST,
            "File size exceeds 20MB limit".to_string(),
        ));
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

    let bypass_cache = headers
        .get("x-benchmark-bypass-cache")
        .and_then(|value| value.to_str().ok())
        .map(|value| {
            matches!(
                value.to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false);
    let cache_key = build_generate_cache_key(&file_bytes, &options);
    let palette_preset = options.palette_preset.clone();

    if !bypass_cache {
        if let Some(cached) = generate_cache()
            .lock()
            .map_err(|_| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Generate cache unavailable".to_string(),
                )
            })?
            .get(&cache_key)
        {
            return Ok(build_generate_response(cached, palette_preset));
        }
    }

    let result =
        tokio::task::spawn_blocking(move || engine::process_image_bytes(&file_bytes, options))
            .await
            .map_err(|err| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Generate worker failed: {err}"),
                )
            })?
            .map_err(|err| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Processing failed: {err}"),
                )
            })?;

    if !bypass_cache {
        generate_cache()
            .lock()
            .map_err(|_| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Generate cache unavailable".to_string(),
                )
            })?
            .insert(cache_key, result.clone());
    }

    Ok(build_generate_response(result, palette_preset))
}

fn field_string(fields: &HashMap<String, String>, key: &str, default: &str) -> String {
    fields
        .get(key)
        .cloned()
        .unwrap_or_else(|| default.to_string())
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
        .map(|value| {
            matches!(
                value.to_ascii_lowercase().as_str(),
                "true" | "1" | "yes" | "on"
            )
        })
        .unwrap_or(default)
}

async fn export_pattern_json(
    Json(data): Json<Value>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let pixel_matrix = data
        .get("pixel_matrix")
        .and_then(|value| value.as_array())
        .ok_or_else(|| {
            (
                StatusCode::BAD_REQUEST,
                "pixel_matrix is required".to_string(),
            )
        })?;
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
            (
                axum::http::header::CONTENT_TYPE,
                "application/json".to_string(),
            ),
            (
                axum::http::header::CONTENT_DISPOSITION,
                format!("attachment; filename=beadcraft_pattern_{timestamp}.json"),
            ),
        ],
        serde_json::to_vec_pretty(&export_data).map_err(|err| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("JSON export failed: {err}"),
            )
        })?,
    ))
}

async fn export_pattern_png(
    Json(data): Json<Value>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let request: ExportRequest = serde_json::from_value(data).map_err(|err| {
        (
            StatusCode::BAD_REQUEST,
            format!("Invalid export request: {err}"),
        )
    })?;
    let export = export::export_png(request).map_err(|err| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("PNG export failed: {err}"),
        )
    })?;
    Ok(build_binary_response(export))
}

async fn export_pattern_pdf(
    Json(data): Json<Value>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let request: ExportRequest = serde_json::from_value(data).map_err(|err| {
        (
            StatusCode::BAD_REQUEST,
            format!("Invalid export request: {err}"),
        )
    })?;
    let export = export::export_pdf(request).map_err(|err| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("PDF export failed: {err}"),
        )
    })?;
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
    let response =
        list_serial_ports().map_err(|err| (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()))?;
    Ok(Json(response))
}

async fn send_serial(
    Json(data): Json<SerialSendRequest>,
) -> Result<Json<SendResponse>, (StatusCode, String)> {
    let response =
        send_to_serial(data).map_err(|err| (StatusCode::BAD_REQUEST, err.to_string()))?;
    Ok(Json(response))
}

async fn send_serial_highlight(
    Json(data): Json<HighlightRequest>,
) -> Result<Json<HighlightResponse>, (StatusCode, String)> {
    let response =
        highlight_serial(data).map_err(|err| (StatusCode::BAD_REQUEST, err.to_string()))?;
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
        .nest_service(
            "/examples",
            ServeDir::new(repo_root().join("docs").join("examples")),
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{ColorSummaryEntry, EngineOutput, GridSize};

    fn sample_output() -> EngineOutput {
        EngineOutput {
            grid_size: GridSize {
                width: 2,
                height: 2,
            },
            pixel_matrix: vec![vec![Some("A1".to_string()), None]],
            color_summary: vec![ColorSummaryEntry {
                code: "A1".to_string(),
                name: "Alpha".to_string(),
                name_zh: "阿尔法".to_string(),
                hex: "#000000".to_string(),
                rgb: [0, 0, 0],
                count: 1,
            }],
            total_beads: 1,
            preview_image: String::new(),
        }
    }

    #[test]
    fn generate_cache_key_is_stable_and_sensitive_to_inputs() {
        let options = GenerateOptions::default();
        let key_a = build_generate_cache_key(b"abc", &options);
        let key_b = build_generate_cache_key(b"abc", &options);
        let key_other_bytes = build_generate_cache_key(b"abd", &options);
        let key_other_options = build_generate_cache_key(
            b"abc",
            &GenerateOptions {
                grid_width: 64,
                ..options.clone()
            },
        );

        assert_eq!(key_a, key_b);
        assert_ne!(key_a, key_other_bytes);
        assert_ne!(key_a, key_other_options);
    }

    #[test]
    fn generate_cache_store_reuses_entries_and_evicts_oldest() {
        let mut cache = GenerateCacheStore::with_capacity(4);
        let base = sample_output();

        cache.insert("a".to_string(), base.clone());
        cache.insert("b".to_string(), base.clone());
        cache.insert("c".to_string(), base.clone());
        cache.insert("d".to_string(), base.clone());
        cache.insert("e".to_string(), base);

        assert!(cache.get("a").is_none());
        assert!(cache.get("e").is_some());
    }
}
