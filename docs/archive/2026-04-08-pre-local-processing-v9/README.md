# Pre-Local-Processing Archive

Date: 2026-04-08

This archive records the repository state before introducing browser-local image generation
experiments.

Archived scheme:

- Rust + Axum server remains the production generation path.
- `/api/generate`, `/api/export/*`, `/api/serial/*`, `/api/ble/*` are served by `backend-rs`.
- Frontend uses HTTP generation from `static/app.js`.
- Rust parity scripts remain under `tools/parity/`.

Relevant production files at archive time:

- `backend-rs/src/app.rs`
- `backend-rs/src/engine.rs`
- `backend-rs/src/export.rs`
- `static/app.js`
- `render.yaml`
- `README.md`

Benchmark goal after this archive:

1. Build a browser-local `TypeScript + Web Worker` generation experiment.
2. Build a browser-local `Rust -> WebAssembly + Web Worker` generation experiment.
3. Compare them against the existing Rust HTTP path using the same image and options.
