# PixelDoodle

PixelDoodle（像素豆绘）是一个“图片转拼豆图 + ESP32 点阵显示”的完整项目，包含：

**Version: v10**

- Web 前端（上传、裁剪、浏览器本地生成、导出、BLE 连接）
- Rust/Axum 后端（静态资源分发、生成 fallback、导出、设备接口）
- Python 对照基线（仅用于 parity 测试与问题回溯）
- ESP32 固件（BLE 接收图像、设备 UUID、待机页显示）

---

## 1. 当前能力概览

- 图片生成拼豆图（默认浏览器本地 WASM 处理，保留 Rust fallback）
- ESP32 64x64 点阵 BLE 显示
- 每台 ESP32 有唯一设备码（UUID，12 位 HEX）
- 前端支持：
  - 上传图片 / 示例图生成
  - 浏览器内直接 BLE 连接已授权设备
  - PNG / PDF / JSON 导出
  - 本地生成与 Rust 服务端结果 parity 对照

---

## 2. 目录结构

```text
PixelDoodle/
├─ backend-rs/                # Rust/Axum 主后端
├─ main.py                    # Python 基线入口（不再作为生产入口）
├─ requirements.txt           # Python 基线依赖
├─ core/                      # Python 基线图像处理、串口/BLE 能力
├─ static/                    # 前端 JS/CSS
├─ templates/                 # HTML 模板
├─ data/                      # 颜色数据
├─ certs/                     # 本地 HTTPS 证书（可选）
├─ docs/
├─ tools/parity/              # Rust/Python 一致性对照脚本
└─ firmware/                  # ESP32 固件（PlatformIO）
   ├─ src/main.cpp
   ├─ lib/beadcraft-receiver/
   ├─ lib/ble-receiver/
   └─ platformio.ini
```

---

## 3. 环境要求

### 后端

- Rust stable toolchain
- Windows/macOS/Linux
- Python 3.10+（仅 parity 测试与回溯使用）

### 固件

- PlatformIO（CLI）
- ESP32 开发板（当前配置：`esp32doit-devkit-v1`）
- HUB75 64x64 LED 点阵

### 浏览器（Web Bluetooth）

- 推荐：Chrome / Edge（桌面）
- 需 `HTTPS` 或 `localhost`
- Safari/iOS 对 Web Bluetooth 支持受限

---

## 4. 本地启动（Web）

在项目根目录执行：

```bash
cargo run --manifest-path backend-rs/Cargo.toml --release
```

默认监听：

- `http://0.0.0.0:8765`

可选环境变量：

- `PORT`（默认 `8765`）
- `HOST`（默认 `0.0.0.0`）
- `APP_ROOT`（可选，显式指定仓库根目录）

---

## 4.1 浏览器本地处理实验

仓库中额外提供两条浏览器本地生图实验链：

- `TypeScript + Web Worker`
- `Rust + WebAssembly + Web Worker`

相关文件：

- `frontend-local/src/`
- `wasm-engine/`
- `static/local-processing/benchmark.html`

前端实验产物构建：

```bash
npm install
npm run build:local-processing
```

WASM 产物构建：

```bash
rustup target add wasm32-unknown-unknown --toolchain stable-x86_64-pc-windows-msvc
cargo +stable-x86_64-pc-windows-msvc build --manifest-path wasm-engine/Cargo.toml --target wasm32-unknown-unknown --release
wasm-bindgen --target web --out-dir static/local-processing/wasm wasm-engine/target/wasm32-unknown-unknown/release/beadcraft_wasm.wasm
```

基准页地址：

- `/static/local-processing/benchmark.html`

---

## 5. 固件编译与烧录

进入固件目录：

```bash
cd firmware
pio run -t upload --upload-port COM4
```

串口查看日志：

```bash
pio device monitor -b 115200 -p COM4
```

当前固件内关键配置在 [platformio.ini](./firmware/platformio.ini)：

- `PAIRING_BASE_URL` 已配置为：
  - `https://10.39.251.173:8765/`

设备二维码最终形如：

```text
https://10.39.251.173:8765/?u=F42DC97179B4
```

---

## 6. 配对与发送流程（推荐）

1. ESP32 上电，显示二维码和设备 UUID。
2. 前端点击扫码，或手动输入 UUID。
3. 页面锁定目标设备（`?u=...`）。
4. 前端立即尝试 BLE 连接该设备。
5. 连接成功后，生成图案并发送到 ESP32。

说明：

- 浏览器安全策略下，`requestDevice()` 可能需要用户手势。
- 若自动连接被拦截，前端会弹出简化确认层，让用户“一键连接当前设备”。

---

## 7. API 速览

核心接口在 [main.py](./main.py)：

- `GET /`：主页
- `GET /api/palette`：调色板与预设
- `POST /api/generate`：图像转拼豆图
- `POST /api/export/png`
- `POST /api/export/pdf`
- `POST /api/export/json`
- `GET /api/serial/ports`
- `POST /api/serial/send`
- `POST /api/serial/highlight`
- `GET /api/ble/devices`（旧后端 BLE 扫描）
- `POST /api/ble/send`（旧后端 BLE 发送）

备注：当前主流程已改为浏览器 Web Bluetooth 直连，`/api/ble/*` 主要用于兼容旧方案。

---

## 8. 常见问题

### Q1：浏览器提示“找不到兼容设备”

排查顺序：

1. ESP32 是否已上电并停留在 BLE 等待页
2. 设备名是否为 `BeadCraft-<UUID>`
3. 浏览器蓝牙是否开启、系统权限是否允许
4. 页面是否使用 `HTTPS`

前端已做回退策略：精确设备名匹配失败时，会回退到 `BeadCraft-` 前缀匹配。

### Q2：手机能打开网页但不能实时扫码

- 手机浏览器对摄像头权限要求更严格，优先使用 HTTPS。
- 已支持“拍照/选图识别”兜底。

### Q3：扫码后为什么还要点一次连接

- 受 Web Bluetooth 规范限制，部分浏览器必须用户手势触发配对。
- 项目已将这一步最小化为单次确认按钮。

---

## 9. 开发建议

- 前端调试：优先桌面 Chrome/Edge
- BLE 联调：先确认设备名、再确认 GATT UUID
- 固件改动后：务必重新烧录并观察串口日志

---

## 10. License

MIT
