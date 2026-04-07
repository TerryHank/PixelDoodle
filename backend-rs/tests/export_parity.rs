use axum::http::{header, StatusCode};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;

fn sample_export_payload() -> Value {
    json!({
        "pixel_matrix": [
            ["H1", "H7", null],
            ["B9", "B14", "H1"]
        ],
        "color_data": {
            "H1": "#FFFFFF",
            "H7": "#000000",
            "B9": "#183823",
            "B14": "#9DD12E"
        },
        "color_summary": [
            {"code": "H1", "name": "H1", "name_zh": "H1", "hex": "#FFFFFF", "rgb": [255,255,255], "count": 2},
            {"code": "H7", "name": "H7", "name_zh": "H7", "hex": "#000000", "rgb": [0,0,0], "count": 1},
            {"code": "B9", "name": "B9", "name_zh": "B9", "hex": "#183823", "rgb": [24,56,35], "count": 1},
            {"code": "B14", "name": "B14", "name_zh": "B14", "hex": "#9DD12E", "rgb": [157,209,46], "count": 1}
        ],
        "cell_size": 20,
        "show_grid": true,
        "show_codes_in_cells": true,
        "show_coordinates": true,
        "palette_preset": "221"
    })
}

#[tokio::test]
async fn export_json_matches_expected_shape() {
    let app = backend_rs::app::build_app().await;
    let response = app
        .oneshot(
            axum::http::Request::builder()
                .method("POST")
                .uri("/api/export/json")
                .header(header::CONTENT_TYPE, "application/json")
                .body(axum::body::Body::from(sample_export_payload().to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let headers = response.headers().clone();
    assert_eq!(
        headers.get(header::CONTENT_TYPE).unwrap(),
        "application/json"
    );

    let body = response.into_body().collect().await.unwrap().to_bytes();
    let payload: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(payload["dimensions"]["width"], 3);
    assert_eq!(payload["dimensions"]["height"], 2);
    assert_eq!(payload["pixel_matrix"], sample_export_payload()["pixel_matrix"]);
}

#[tokio::test]
async fn index_route_serves_v9_markup() {
    let app = backend_rs::app::build_app().await;
    let response = app
        .oneshot(
            axum::http::Request::builder()
                .uri("/")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let html = String::from_utf8(body.to_vec()).unwrap();
    assert!(html.contains("v9"));
}
