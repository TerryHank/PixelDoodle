use std::{
    fs,
    path::{Path, PathBuf},
};

use axum::http::{header, StatusCode};
use backend_rs::{engine, types::GenerateOptions};
use http_body_util::BodyExt;
use serde_json::Value;
use tower::ServiceExt;

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("backend-rs should live under repo root")
        .to_path_buf()
}

fn generate_options() -> GenerateOptions {
    GenerateOptions {
        mode: "fixed_grid".to_string(),
        grid_width: 48,
        grid_height: 48,
        led_size: 64,
        pixel_size: 8,
        use_dithering: false,
        palette_preset: "221".to_string(),
        max_colors: 0,
        similarity_threshold: 0,
        remove_bg: false,
        contrast: 0.0,
        saturation: 0.0,
        sharpness: 0.0,
    }
}

fn build_multipart_body(boundary: &str, image_bytes: &[u8], options: &GenerateOptions) -> Vec<u8> {
    let mut body = Vec::new();
    let fields = [
        ("mode", options.mode.clone()),
        ("grid_width", options.grid_width.to_string()),
        ("grid_height", options.grid_height.to_string()),
        ("led_size", options.led_size.to_string()),
        ("pixel_size", options.pixel_size.to_string()),
        ("use_dithering", options.use_dithering.to_string()),
        ("palette_preset", options.palette_preset.clone()),
        ("max_colors", options.max_colors.to_string()),
        (
            "similarity_threshold",
            options.similarity_threshold.to_string(),
        ),
        ("remove_bg", options.remove_bg.to_string()),
        ("contrast", options.contrast.to_string()),
        ("saturation", options.saturation.to_string()),
        ("sharpness", options.sharpness.to_string()),
    ];

    for (name, value) in fields {
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        body.extend_from_slice(
            format!("Content-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n")
                .as_bytes(),
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

#[tokio::test]
async fn generate_route_matches_rust_engine_for_example_image() {
    let root = repo_root();
    let image_path = root
        .join("docs")
        .join("examples")
        .join("luoxiaohei_original.jpg");
    let image_bytes = fs::read(&image_path).unwrap();
    let options = generate_options();
    let expected = engine::process_image_bytes(&image_bytes, options.clone()).unwrap();
    let boundary = "beadcraft-route-parity-boundary";
    let body = build_multipart_body(boundary, &image_bytes, &options);
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

    let payload: Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();

    assert_eq!(
        payload["grid_size"],
        serde_json::to_value(&expected.grid_size).unwrap()
    );
    assert_eq!(
        payload["pixel_matrix"],
        serde_json::to_value(&expected.pixel_matrix).unwrap()
    );
    assert_eq!(
        payload["color_summary"],
        serde_json::to_value(&expected.color_summary).unwrap()
    );
    assert_eq!(payload["total_beads"], expected.total_beads);
    assert_eq!(payload["palette_preset"], options.palette_preset);
    assert_eq!(payload["preview_image"], expected.preview_image);
    assert!(payload["session_id"].as_str().is_some());
}
