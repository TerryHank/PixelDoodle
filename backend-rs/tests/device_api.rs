use axum::http::StatusCode;
use http_body_util::BodyExt;
use serde_json::Value;
use tower::ServiceExt;

#[tokio::test]
async fn serial_ports_route_returns_ports_array() {
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
    assert_eq!(
        status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&body)
    );
    let payload: Value = serde_json::from_slice(&body).unwrap();
    assert!(payload.get("ports").and_then(|ports| ports.as_array()).is_some());
}
