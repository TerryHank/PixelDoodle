# Rust Axum 后端替换实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 用 Rust + Axum 替换当前 FastAPI 主服务，保持前端协议兼容，并以 `v9` 形式完成验证、发布与部署。

**架构：** 新增 `backend-rs/` 作为主服务，复用现有 `static/`、`templates/`、`docs/examples/` 与 `data/` 资源；Python 代码保留为基线与差分工具。通过先写差分测试再迁实现，逐步替换 `/api/generate`、导出接口和设备接口。

**技术栈：** Rust、Axum、Tokio、Serde、image、raqote/printpdf、serialport、btleplug、Python 基线脚本、现有前端静态资源

---

## 文件结构

- 创建：`backend-rs/Cargo.toml`
- 创建：`backend-rs/src/main.rs`
- 创建：`backend-rs/src/app.rs`
- 创建：`backend-rs/src/error.rs`
- 创建：`backend-rs/src/http/generate.rs`
- 创建：`backend-rs/src/http/export.rs`
- 创建：`backend-rs/src/http/palette.rs`
- 创建：`backend-rs/src/http/device.rs`
- 创建：`backend-rs/src/http/mod.rs`
- 创建：`backend-rs/src/core/palette.rs`
- 创建：`backend-rs/src/core/color_match.rs`
- 创建：`backend-rs/src/core/quantizer.rs`
- 创建：`backend-rs/src/core/session.rs`
- 创建：`backend-rs/src/core/mod.rs`
- 创建：`backend-rs/src/export/png.rs`
- 创建：`backend-rs/src/export/pdf.rs`
- 创建：`backend-rs/src/export/json.rs`
- 创建：`backend-rs/src/export/mod.rs`
- 创建：`backend-rs/src/io/serial.rs`
- 创建：`backend-rs/src/io/ble.rs`
- 创建：`backend-rs/src/io/mod.rs`
- 创建：`backend-rs/tests/api_smoke.rs`
- 创建：`backend-rs/tests/generate_parity.rs`
- 创建：`backend-rs/tests/export_parity.rs`
- 创建：`tools/parity/generate_baseline.py`
- 创建：`tools/parity/export_baseline.py`
- 修改：`templates/index.html`
- 修改：`README.md`
- 修改：`render.yaml`
- 修改：`requirements.txt`

### 任务 1：建立 Rust 服务骨架与差分基线

**文件：**
- 创建：`backend-rs/Cargo.toml`
- 创建：`backend-rs/src/main.rs`
- 创建：`backend-rs/src/app.rs`
- 创建：`backend-rs/src/error.rs`
- 创建：`backend-rs/src/http/mod.rs`
- 创建：`backend-rs/src/http/palette.rs`
- 创建：`backend-rs/tests/api_smoke.rs`
- 创建：`tools/parity/generate_baseline.py`

- [ ] **步骤 1：先写失败的 API 冒烟测试**

```rust
#[tokio::test]
async fn palette_route_returns_colors_and_presets() {
    let app = backend_rs::app::build_app().await;
    let response = app
        .oneshot(
            http::Request::builder()
                .uri("/api/palette")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), http::StatusCode::OK);
}
```

- [ ] **步骤 2：运行测试验证失败**

运行：`cargo test --manifest-path backend-rs/Cargo.toml api_smoke -- --nocapture`  
预期：失败，提示 `backend-rs` 或 `build_app` 尚不存在

- [ ] **步骤 3：编写最小 Rust 服务骨架**

```rust
pub async fn build_app() -> Router {
    Router::new().route("/api/palette", get(palette::get_palette))
}
```

- [ ] **步骤 4：增加 Python 基线脚本**

```python
from main import palette
print(json.dumps({"colors": palette.colors, "presets": palette.presets}, ensure_ascii=False))
```

- [ ] **步骤 5：运行测试验证通过**

运行：`cargo test --manifest-path backend-rs/Cargo.toml api_smoke -- --nocapture`  
预期：PASS

- [ ] **步骤 6：Commit**

```bash
git add backend-rs/Cargo.toml backend-rs/src backend-rs/tests/api_smoke.rs tools/parity/generate_baseline.py
git commit -m "feat(后端): 初始化 Rust Axum 服务骨架（任务 1/5）"
```

### 任务 2：用 TDD 迁移 `/api/generate` 与调色板核心

**文件：**
- 创建：`backend-rs/src/core/palette.rs`
- 创建：`backend-rs/src/core/color_match.rs`
- 创建：`backend-rs/src/core/quantizer.rs`
- 创建：`backend-rs/src/core/session.rs`
- 创建：`backend-rs/src/http/generate.rs`
- 创建：`backend-rs/tests/generate_parity.rs`
- 创建：`tools/parity/generate_baseline.py`

- [ ] **步骤 1：写生成结果差分测试**

```rust
#[tokio::test]
async fn generate_matches_python_baseline_for_example_image() {
    let rust = run_rust_generate_fixture("docs/examples/luoxiaohei_original.jpg").await;
    let py = run_python_generate_fixture("docs/examples/luoxiaohei_original.jpg").await;
    assert_eq!(rust.pixel_matrix, py.pixel_matrix);
    assert_eq!(rust.color_summary, py.color_summary);
    assert_eq!(rust.grid_size, py.grid_size);
}
```

- [ ] **步骤 2：运行测试验证失败**

运行：`cargo test --manifest-path backend-rs/Cargo.toml generate_matches_python_baseline_for_example_image -- --nocapture`  
预期：失败，提示 `/api/generate` 或量化逻辑未实现

- [ ] **步骤 3：实现调色板、Lab、量化和会话逻辑**

```rust
pub struct GenerateResult {
    pub pixel_matrix: Vec<Vec<Option<String>>>,
    pub color_summary: Vec<ColorSummaryItem>,
    pub grid_size: GridSize,
    pub total_beads: usize,
}
```

- [ ] **步骤 4：实现 `/api/generate` 表单接口与 preview 输出**

```rust
#[derive(Debug, Deserialize)]
pub struct GenerateForm {
    pub mode: Option<String>,
    pub grid_width: Option<u32>,
    pub grid_height: Option<u32>,
    pub led_size: Option<u32>,
    pub pixel_size: Option<u32>,
    pub use_dithering: Option<String>,
    pub palette_preset: Option<String>,
    pub max_colors: Option<u32>,
    pub similarity_threshold: Option<u32>,
    pub remove_bg: Option<String>,
    pub contrast: Option<f32>,
    pub saturation: Option<f32>,
    pub sharpness: Option<f32>,
}
```

- [ ] **步骤 5：运行生成差分测试**

运行：`cargo test --manifest-path backend-rs/Cargo.toml generate_parity -- --nocapture`  
预期：PASS

- [ ] **步骤 6：Commit**

```bash
git add backend-rs/src/core backend-rs/src/http/generate.rs backend-rs/tests/generate_parity.rs tools/parity/generate_baseline.py
git commit -m "feat(后端): 完成 generate 核心与差分测试（任务 2/5）"
```

### 任务 3：迁移导出接口与首页静态资源服务

**文件：**
- 创建：`backend-rs/src/export/png.rs`
- 创建：`backend-rs/src/export/pdf.rs`
- 创建：`backend-rs/src/export/json.rs`
- 创建：`backend-rs/src/export/mod.rs`
- 创建：`backend-rs/src/http/export.rs`
- 创建：`backend-rs/tests/export_parity.rs`
- 创建：`tools/parity/export_baseline.py`
- 修改：`templates/index.html`

- [ ] **步骤 1：写导出接口失败测试**

```rust
#[tokio::test]
async fn export_json_matches_expected_shape() {
    let response = post_json_export(sample_payload()).await;
    assert_eq!(response.status(), http::StatusCode::OK);
    assert_eq!(response.headers()["content-type"], "application/json");
}
```

- [ ] **步骤 2：运行测试验证失败**

运行：`cargo test --manifest-path backend-rs/Cargo.toml export_parity -- --nocapture`  
预期：失败，提示导出 handler 未实现

- [ ] **步骤 3：实现 PNG/PDF/JSON 导出模块**

```rust
pub fn export_json(payload: &ExportJsonPayload) -> Result<Vec<u8>, AppError> {
    serde_json::to_vec_pretty(&export_data).map_err(AppError::from)
}
```

- [ ] **步骤 4：实现 `/`、`/static`、`/examples` 资源服务并升级页面版本到 v9**

```rust
Router::new()
    .route("/", get(index))
    .nest_service("/static", ServeDir::new("static"))
    .nest_service("/examples", ServeDir::new("docs/examples"))
```

- [ ] **步骤 5：运行导出测试**

运行：`cargo test --manifest-path backend-rs/Cargo.toml export_parity -- --nocapture`  
预期：PASS

- [ ] **步骤 6：Commit**

```bash
git add backend-rs/src/export backend-rs/src/http/export.rs backend-rs/tests/export_parity.rs tools/parity/export_baseline.py templates/index.html
git commit -m "feat(导出): 迁移导出接口与首页静态服务（任务 3/5）"
```

### 任务 4：迁移串口与 BLE 接口

**文件：**
- 创建：`backend-rs/src/io/serial.rs`
- 创建：`backend-rs/src/io/ble.rs`
- 创建：`backend-rs/src/http/device.rs`

- [ ] **步骤 1：写设备接口失败测试**

```rust
#[tokio::test]
async fn serial_ports_route_returns_ports_array() {
    let response = get("/api/serial/ports").await;
    assert_eq!(response.status(), http::StatusCode::OK);
}
```

- [ ] **步骤 2：运行测试验证失败**

运行：`cargo test --manifest-path backend-rs/Cargo.toml serial_ports_route_returns_ports_array -- --nocapture`  
预期：失败，提示设备路由未实现

- [ ] **步骤 3：实现串口枚举与发包**

```rust
pub fn list_ports() -> Result<Vec<SerialPortInfoDto>, AppError> {
    Ok(serialport::available_ports()?.into_iter().map(map_port).collect())
}
```

- [ ] **步骤 4：实现 BLE 扫描与发送**

```rust
pub async fn scan_ble_devices() -> Result<Vec<BleDeviceDto>, AppError> {
    // 过滤 BeadCraft- 前缀并返回地址/名称
}
```

- [ ] **步骤 5：运行设备相关测试**

运行：`cargo test --manifest-path backend-rs/Cargo.toml api_smoke -- --nocapture`  
预期：PASS

- [ ] **步骤 6：Commit**

```bash
git add backend-rs/src/io backend-rs/src/http/device.rs
git commit -m "feat(设备): 迁移串口与 BLE 接口（任务 4/5）"
```

### 任务 5：切换启动入口、验证、发布 v9

**文件：**
- 修改：`README.md`
- 修改：`render.yaml`
- 修改：`requirements.txt`

- [ ] **步骤 1：写部署与启动验证清单**

```text
1. cargo test 全通过
2. cargo build --release 成功
3. 本地启动 Rust 服务后首页返回 200
4. Playwright 走示例图生成与导出流程
5. 与 Python 基线差分通过
```

- [ ] **步骤 2：切换部署入口**

```yaml
buildCommand: cargo build --manifest-path backend-rs/Cargo.toml --release
startCommand: ./backend-rs/target/release/beadcraft-server
```

- [ ] **步骤 3：运行完整验证**

运行：
- `cargo test --manifest-path backend-rs/Cargo.toml`
- `cargo build --manifest-path backend-rs/Cargo.toml --release`
- `python -m py_compile main.py core/serial_export.py core/ble_export.py`
- `node --check static/app.js`

预期：全部通过

- [ ] **步骤 4：更新版本为 v9 并提交**

```bash
git add README.md render.yaml requirements.txt templates/index.html static
git commit -m "feat(发布): 发布 v9 Rust Axum 后端替换版（任务 5/5）"
git tag -f v9
```

- [ ] **步骤 5：推送代码与服务器**

```bash
git push origin feature/rust-axum-v9
git push origin HEAD:main
git push origin -f v9
```

服务器同步：

```bash
scp/redeploy 到 terry@10.0.0.99:/home/terry/PixelDoodle/
```
