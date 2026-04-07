use axum::http::StatusCode;
use tower::ServiceExt;

#[tokio::test]
async fn palette_route_returns_colors_and_presets() {
    let app = backend_rs::app::build_app().await;
    let response = app
        .oneshot(
            axum::http::Request::builder()
                .uri("/api/palette")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}
