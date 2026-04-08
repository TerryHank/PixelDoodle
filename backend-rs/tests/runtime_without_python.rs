use std::env;

use axum::http::{header, StatusCode};
use http_body_util::BodyExt;
use serde_json::json;
use tower::ServiceExt;

fn sample_pixel_matrix() -> serde_json::Value {
    json!([
        ["C01", "C02", null, "C03"],
        ["C04", "C05", "C06", "C07"],
        [null, "C08", "C09", "C10"],
        ["C11", "C12", "C13", "C14"]
    ])
}

async fn request_json(
    method: &str,
    uri: &str,
    body: serde_json::Value,
) -> (StatusCode, axum::http::HeaderMap, Vec<u8>) {
    let app = backend_rs::app::build_app().await;
    let response = app
        .oneshot(
            axum::http::Request::builder()
                .method(method)
                .uri(uri)
                .header(header::CONTENT_TYPE, "application/json")
                .body(axum::body::Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    let status = response.status();
    let headers = response.headers().clone();
    let bytes = response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes()
        .to_vec();
    (status, headers, bytes)
}

#[tokio::test]
async fn export_routes_work_without_python_runtime() {
    env::set_var("PYTHON_EXECUTABLE", "__definitely_missing_python__");

    let export_payload = json!({
        "pixel_matrix": sample_pixel_matrix(),
        "color_data": {
            "C01": "#000000",
            "C02": "#ffffff",
            "C03": "#ff0000",
            "C04": "#00ff00",
            "C05": "#0000ff",
            "C06": "#aaaaaa",
            "C07": "#222222",
            "C08": "#ffee00",
            "C09": "#00ffee",
            "C10": "#ff00ee",
            "C11": "#663300",
            "C12": "#336699",
            "C13": "#669933",
            "C14": "#993366"
        },
        "color_summary": [
            {"code":"C01","name":"Black","name_zh":"黑","hex":"#000000","rgb":[0,0,0],"count":1},
            {"code":"C02","name":"White","name_zh":"白","hex":"#ffffff","rgb":[255,255,255],"count":1}
        ],
        "palette_preset": "221",
        "cell_size": 20,
        "show_grid": true,
        "show_codes_in_cells": true,
        "show_coordinates": true
    });

    let (png_status, png_headers, png_body) =
        request_json("POST", "/api/export/png", export_payload.clone()).await;
    assert_eq!(
        png_status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&png_body)
    );
    assert_eq!(png_headers.get(header::CONTENT_TYPE).unwrap(), "image/png");
    assert!(png_body.starts_with(&[0x89, b'P', b'N', b'G']));

    let (pdf_status, pdf_headers, pdf_body) =
        request_json("POST", "/api/export/pdf", export_payload).await;
    assert_eq!(
        pdf_status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&pdf_body)
    );
    assert_eq!(
        pdf_headers.get(header::CONTENT_TYPE).unwrap(),
        "application/pdf"
    );
    assert!(pdf_body.starts_with(b"%PDF-"));
}

#[tokio::test]
async fn serial_ports_route_no_longer_depends_on_python() {
    env::set_var("PYTHON_EXECUTABLE", "__definitely_missing_python__");
    let app = backend_rs::app::build_app().await;
    let response = app
        .oneshot(
            axum::http::Request::builder()
                .uri("/api/serial/ports")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    let status = response.status();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&body));
    let payload: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(payload
        .get("ports")
        .and_then(|ports| ports.as_array())
        .is_some());
}

#[tokio::test]
async fn ble_discovery_route_no_longer_depends_on_python() {
    env::set_var("PYTHON_EXECUTABLE", "__definitely_missing_python__");
    let app = backend_rs::app::build_app().await;
    let response = app
        .oneshot(
            axum::http::Request::builder()
                .uri("/api/ble/devices")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    let status = response.status();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&body));
    let payload: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(payload
        .get("devices")
        .and_then(|devices| devices.as_array())
        .is_some());
}
