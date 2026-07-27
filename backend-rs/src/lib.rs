use std::path::{Path, PathBuf};

pub mod app;
pub mod color;
pub mod device;
pub mod engine;
pub mod export;
pub mod palette;
pub mod types;

pub fn repo_root() -> PathBuf {
    if let Ok(path) = std::env::var("APP_ROOT") {
        let root = PathBuf::from(path);
        if root.join("templates").exists() && root.join("static").exists() {
            return root;
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        if cwd.join("templates").exists() && cwd.join("static").exists() {
            return cwd;
        }
    }

    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("backend-rs should live under repo root")
        .to_path_buf()
}
