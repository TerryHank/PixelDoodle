# PixelDoodle

PixelDoodle（像素豆绘）是一个“图片转拼豆图 + ESP32 点阵显示”的完整项目。

**Version: v9**

- Web 前端：上传、裁剪、生成、导出、浏览器直连蓝牙
- Rust + Axum 主后端：静态页面、生成接口、导出接口、设备兼容接口
- Python 基线层：保留原图像/导出/设备逻辑，用于差分测试和兼容桥
- ESP32 固件：BLE 接收图像、设备 UUID 显示、蓝灯高亮

---

## 1. 当前能力概览

- 图片生成拼豆图（颜色统计、坐标、导出 PNG/PDF/JSON）
- 首页直接上传或选择示例图
- 浏览器 Web Bluetooth 直连 BeadCraft 设备
- ESP32 64x64 点阵 BLE 显示
- 后端兼容接口仍保留：
  - `GET /api/serial/ports`
  - `POST /api/serial/send`
  - `POST /api/serial/highlight`
  - `GET /api/ble/devices`
  - `POST /api/ble/send`

---

## 2. 目录结构

```text
PixelDoodle/
├─ backend-rs/                # Rust + Axum 主服务
├─ main.py                    # Python 基线入口（对照/回溯）
├─ requirements.txt           # Python 基线依赖
├─ core/                      # Python 图像处理、串口/BLE 基线能力
├─ static/                    # 前端 JS/CSS
├─ templates/                 # HTML 模板
├─ data/                      # 颜色数据
├─ tools/parity/              # Rust 调用的 Python 基线脚本
├─ docs/
└─ firmware/                  # ESP32 固件（PlatformIO）
```

---

## 3. 环境要求

### Web 后端

- Rust stable
- Python 3.10+
- Windows/macOS/Linux

### 固件

- PlatformIO（CLI）
- ESP32-S3 开发板
- HUB75 64x64 LED 点阵

### 浏览器（Web Bluetooth）

- 推荐：Chrome / Edge（桌面）
- 需 `HTTPS` 或 `localhost`
- Safari/iOS 对 Web Bluetooth 支持受限

---

## 4. 本地启动（Web）

### 4.1 安装 Python 基线依赖

在项目根目录执行：

```bash
pip install -r requirements.txt
```

### 4.2 启动 Rust 主服务

```bash
cargo run --manifest-path backend-rs/Cargo.toml
```

默认监听：

- `0.0.0.0:8765`

可选环境变量：

- `HOST`（默认 `0.0.0.0`）
- `PORT`（默认 `8765`）
- `PYTHON_EXECUTABLE`
  - 指向带有 `requirements.txt` 依赖的 Python 解释器
  - 未设置时，服务会优先尝试项目内 `.venv`

说明：

- Rust 服务负责对外 HTTP 接口和静态资源
- Python 仅作为兼容桥和差分基线，不再作为默认线上入口

---

## 5. 固件编译与烧录

进入固件目录：

```bash
cd firmware
pio run -t upload --upload-port COM13
```

串口查看日志：

```bash
pio device monitor -b 115200 -p COM13
```

---

## 6. 使用流程

1. 打开首页，上传图片或点击示例图。
2. 页面生成拼豆图并显示色板。
3. 如需发送到设备，点击工具栏蓝牙状态按钮完成连接。
4. 连接成功后可继续高亮、导出和发送。

---

## 7. API 速览

Rust 主服务核心路由：

- `GET /`
- `GET /api/palette`
- `POST /api/generate`
- `POST /api/export/png`
- `POST /api/export/pdf`
- `POST /api/export/json`
- `GET /api/serial/ports`
- `POST /api/serial/send`
- `POST /api/serial/highlight`
- `GET /api/ble/devices`
- `POST /api/ble/send`

说明：

- 这些接口的外部形状保持与历史 FastAPI 版本兼容
- Python `main.py` 保留，仅用于结果对照、调试和回归排查

---

## 8. 常见问题

### Q1：为什么还需要 Python 环境

当前 `v9` 已由 Rust 接管 HTTP 服务，但为了保证结果兼容和设备接口不回退，
仍保留 Python 基线层。`PYTHON_EXECUTABLE` 需指向已安装依赖的解释器。

### Q2：浏览器提示“找不到兼容设备”

排查顺序：

1. ESP32 是否已上电并停留在 BLE 等待页
2. 设备名是否为 `BeadCraft-<UUID>`
3. 浏览器蓝牙是否开启、系统权限是否允许
4. 页面是否使用 `HTTPS`

### Q3：亮度控制在哪里

前端亮度控件已移除。当前版本保留固件亮度能力，但网页不再暴露滑杆入口。

---

## 9. 开发建议

- 前端调试：优先桌面 Chrome/Edge
- 后端调试：优先运行 `cargo test --manifest-path backend-rs/Cargo.toml`
- 差分调试：使用 `tools/parity/` 下脚本对照 Python 基线
- 固件改动后：务必重新烧录并观察串口日志

---

## 10. License

MIT
