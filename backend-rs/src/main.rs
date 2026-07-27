use std::{env, net::SocketAddr};

use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "beadcraft_server=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let host = env::var("HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
    let port = env::var("PORT")
        .ok()
        .and_then(|raw| raw.parse::<u16>().ok())
        .unwrap_or(8765);
    let addr: SocketAddr = format!("{host}:{port}")
        .parse()
        .expect("HOST and PORT should form a valid socket address");

    let app = backend_rs::app::build_app().await;
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("failed to bind TCP listener");

    tracing::info!(
        "beadcraft-server listening on {}",
        listener.local_addr().unwrap()
    );
    axum::serve(listener, app)
        .await
        .expect("axum server exited unexpectedly");
}
