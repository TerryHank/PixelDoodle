use std::{
    env,
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use axum::http::{header, StatusCode};
use http_body_util::BodyExt;
use serde_json::Value;
use tower::ServiceExt;

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("backend-rs should live under repo root")
        .to_path_buf()
}

fn build_multipart_body(boundary: &str, image_bytes: &[u8]) -> Vec<u8> {
    let mut body = Vec::new();
    let fields = [
        ("mode", "fixed_grid"),
        ("grid_width", "48"),
        ("grid_height", "48"),
        ("led_size", "64"),
        ("pixel_size", "8"),
        ("use_dithering", "false"),
        ("palette_preset", "221"),
        ("max_colors", "0"),
        ("similarity_threshold", "0"),
        ("remove_bg", "false"),
        ("contrast", "0"),
        ("saturation", "0"),
        ("sharpness", "0"),
    ];

    for (name, value) in fields {
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        body.extend_from_slice(
            format!("Content-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n").as_bytes(),
        );
    }

    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(
        b"Content-Disposition: form-data; name=\"file\"; filename=\"luoxiaohei_original.jpg\"\r\n",
    );
    body.extend_from_slice(b"Content-Type: image/jpeg\r\n\r\n");
    body.extend_from_slice(image_bytes);
    body.extend_from_slice(b"\r\n");
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    body
}

fn run_python_baseline(image_path: &Path) -> Value {
    let root = repo_root();
    let request_path = root.join("backend-rs").join("target").join("tmp-generate-request.json");
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

    let python = env::var("PYTHON_EXECUTABLE")
        .unwrap_or_else(|_| "D:\\Workspace\\PixelDoodle-web\\.venv\\Scripts\\python.exe".to_string());

    let output = Command::new(python)
        .arg(root.join("tools").join("parity").join("generate_baseline.py"))
        .arg("generate")
        .arg(&request_path)
        .current_dir(&root)
        .output()
        .unwrap();

    assert!(output.status.success(), "python baseline failed: {}", String::from_utf8_lossy(&output.stderr));
    serde_json::from_slice(&output.stdout).unwrap()
}

#[tokio::test]
async fn generate_matches_python_baseline_for_example_image() {
    env::set_var(
        "PYTHON_EXECUTABLE",
        "D:\\Workspace\\PixelDoodle-web\\.venv\\Scripts\\python.exe",
    );
    let root = repo_root();
    let image_path = root.join("docs").join("examples").join("luoxiaohei_original.jpg");
    let image_bytes = fs::read(&image_path).unwrap();
    let boundary = "beadcraft-test-boundary";
    let body = build_multipart_body(boundary, &image_bytes);
    let app = backend_rs::app::build_app().await;

    let response = app
        .oneshot(
            axum::http::Request::builder()
                .method("POST")
                .uri("/api/generate")
                .header(
                    header::CONTENT_TYPE,
                    format!("multipart/form-data; boundary={boundary}"),
                )
                .body(axum::body::Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let rust_payload: Value = serde_json::from_slice(
        &response.into_body().collect().await.unwrap().to_bytes(),
    )
    .unwrap();
    let python_payload = run_python_baseline(&image_path);

    assert_eq!(rust_payload["grid_size"], python_payload["grid_size"]);
    assert_eq!(rust_payload["pixel_matrix"], python_payload["pixel_matrix"]);
    assert_eq!(rust_payload["color_summary"], python_payload["color_summary"]);
    assert_eq!(rust_payload["total_beads"], python_payload["total_beads"]);
}
