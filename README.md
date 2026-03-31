# PixelDoodle

PixelDoodle（像素豆绘）是一个“图片转拼豆图 + ESP32 点阵显示”的完整项目，包含：

**Version: 5.26.41**

- Web 前端（上传、裁剪、生成、导出、扫码）
- Taro 多端前端（`frontend-taro/`，支持 H5 / 微信小程序）
- Python/FastAPI 后端（调色、量化、导出、串口接口）
- ESP32 固件（BLE 接收图像、设备 UUID、二维码配对页）

---

## 1. 当前能力概览

- 图片生成拼豆图（颜色统计、坐标、导出 PNG/PDF/JSON）
- ESP32 64x64 点阵 BLE 显示
- 每台 ESP32 有唯一设备码（UUID，12 位 HEX）
- 启动页后显示二维码，二维码参数为 `?u=<UUID>`
- 前端支持：
  - 扫码识别二维码
  - 手动输入 UUID
  - 自动锁定目标设备并尝试 BLE 连接
  - 浏览器拦截自动连接时弹出“点一下连接这台设备”

---

## 2. 目录结构

```text
PixelDoodle/
├─ main.py                    # FastAPI 入口
├─ frontend-taro/             # Taro 多端前端（H5 / 微信小程序）
├─ requirements.txt
├─ core/                      # 图像处理、串口/BLE 后端能力
├─ static/                    # 前端 JS/CSS
├─ templates/                 # HTML 模板
├─ data/                      # 颜色数据
├─ certs/                     # 本地 HTTPS 证书（可选）
├─ docs/
└─ firmware/                  # ESP32 固件（PlatformIO）
   ├─ src/main.cpp
   ├─ lib/beadcraft-receiver/
   ├─ lib/ble-receiver/
   └─ platformio.ini
```

---

## 3. 环境要求

### 后端

- Python 3.8+
- Windows/macOS/Linux

### Taro 前端

- Node.js 18+
- npm 9+
- 微信开发者工具（调试小程序时）

### 固件

- PlatformIO（CLI）
- ESP32 开发板（当前配置：`esp32doit-devkit-v1`）
- HUB75 64x64 LED 点阵

### 浏览器（Web Bluetooth）

- 推荐：Chrome / Edge（桌面）
- 需 `HTTPS` 或 `localhost`
- Safari/iOS 对 Web Bluetooth 支持受限

---

## 4. Taro 前端开发

在项目根目录执行：

```bash
cd frontend-taro
npm install
npm run dev:h5
# 或
npm run dev:weapp
```

构建命令：

```bash
cd frontend-taro
npm run build:h5
npm run build:weapp
```

说明：

- `frontend-taro/` 是当前主线前端，目标端为 H5 和微信小程序。
- 项目根目录下 `static/` 与 `templates/` 中的旧网页前端可作为迁移对照，但不再是新的主开发入口。
- Taro 前端依赖项目根目录的 FastAPI 服务提供 `/api/palette`、`/api/generate`、`/api/export/*`、`/api/wifi/*` 等接口。

## 5. 本地启动（FastAPI）

在项目根目录执行：

```bash
pip install -r requirements.txt
python main.py
```

FastAPI 仍运行在项目根目录，供 Taro H5 和微信小程序共用：

```bash
pip install -r requirements.txt
python main.py
```

默认监听：

- `https://0.0.0.0:8765`（如果检测到 `certs/localhost-cert.pem` 和 `certs/localhost-key.pem`）
- 否则回退为 HTTP

可选环境变量：

- `PORT`（默认 `8765`）
- `HOST`（默认 `0.0.0.0`）
- `SSL_CERTFILE`
- `SSL_KEYFILE`

---

## 6. 固件编译与烧录

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

## 7. 配对与发送流程（推荐）

1. ESP32 上电，显示二维码和设备 UUID。
2. 前端点击扫码，或手动输入 UUID。
3. 页面锁定目标设备（`?u=...`）。
4. 前端立即尝试 BLE 连接该设备。
5. 连接成功后，生成图案并发送到 ESP32。

说明：

- 浏览器安全策略下，`requestDevice()` 可能需要用户手势。
- 若自动连接被拦截，前端会弹出简化确认层，让用户“一键连接当前设备”。

---

## 8. API 速览

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
- `POST /api/wifi/register`
- `POST /api/wifi/send`
- `POST /api/wifi/highlight`

备注：当前主流程已改为浏览器 Web Bluetooth 直连，`/api/ble/*` 主要用于兼容旧方案。

---

## 9. 常见问题

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

## 10. 开发建议

- 前端调试：Taro H5 优先桌面 Chrome/Edge，小程序请使用微信开发者工具
- BLE 联调：先确认设备名、再确认 GATT UUID
- 固件改动后：务必重新烧录并观察串口日志

---

## 11. License

MIT
