# PixelDoodle Taro 多端 App 重构设计

## 1. 背景

当前 `PixelDoodle` 项目由以下部分组成：

- `main.py`：基于 FastAPI 的服务端入口。
- `templates/index.html` + `static/*`：现有 Web 前端，负责上传、扫码、生成、设备连接与导出。
- `firmware/`：ESP32 固件，负责 BLE 通信、WiFi 配网与图像接收。

当前前端以浏览器页面为中心，存在以下问题：

- 页面逻辑集中在 `static/app.js` 中，状态、平台能力和 UI 强耦合。
- 蓝牙能力依赖浏览器 `Web Bluetooth`，不适合直接迁移到小程序端。
- 串口、单点改色、DOM 直连等能力会放大小程序迁移成本。
- 现有模板页不利于后续扩展为微信小程序 + H5 的统一前端体系。

本次重构目标是在**尽量保留原有 UI 排版和视觉风格**的前提下，将前端重构为一个独立的 Taro 多端项目。

## 2. 目标

- 新建一个独立子目录中的 Taro 项目，作为新的前端主线。
- 首期支持 `微信小程序 + H5` 两端。
- 保留现有首页单页式布局和蓝白极简风格。
- 保留以下核心能力：
  - 扫码或手动输入设备 UUID。
  - BLE 配对与图像发送。
  - 通过 BLE 触发 WiFi 热点扫描与联网。
  - 通过 FastAPI 的 WiFi 接口完成设备注册、图像发送与颜色高亮。
  - 调用 FastAPI 完成拼豆图生成与 PNG/PDF/JSON 导出。
- 删除以下能力：
  - 串口扫描、串口发送、串口高亮。
  - `/api/update_cell` 相关能力。
  - 单点改色、编辑模式、颜色弹出选择器。

## 3. 非目标

- 不重写 Python 图像处理逻辑。
- 不重写 ESP32 固件协议。
- 不在本阶段调整调色算法、量化算法和导出格式。
- 不将当前 Web 模板页直接升级为长期双端架构。
- 不引入新的多步骤向导式 UI，避免偏离现有交互心智。

## 4. 范围边界

### 4.1 保留的系统边界

- `FastAPI` 继续作为图像处理与导出服务层。
- `firmware` 继续作为设备能力层，尽量保持 BLE 包格式与 WiFi 配网流程不变。
- 新的 `Taro` 前端接管原有模板页前端职责。

### 4.2 新的目录边界

Taro 工程固定放在新的子目录 `frontend-taro/` 中，不直接占用项目根目录。

推荐目录结构如下：

```text
PixelDoodle/
├─ frontend-taro/             # 新增，Taro 多端前端
├─ main.py                    # 保留，FastAPI 服务
├─ core/                      # 保留，图像处理与设备服务
├─ templates/                 # 迁移期保留，后续可下线
├─ static/                    # 迁移期保留，后续可下线
├─ firmware/                  # 保留，ESP32 固件
└─ docs/
   └─ superpowers/
      └─ specs/
```

## 5. 目标架构

重构后的前端架构分为 3 层：

### 5.1 页面与组件层（Taro UI Layer）

负责页面结构、视觉排版、交互状态和组件组合，不直接调用平台原生 API。

### 5.2 服务与适配层（Service / Adapter Layer）

负责统一封装接口请求与平台能力：

- 图像生成服务。
- BLE 设备连接与发送。
- WiFi 热点扫描与配网。
- 扫码能力。
- 文件导出与保存。

页面层只调用统一方法，不关心当前运行在小程序还是 H5。

### 5.3 现有服务与设备层（Backend / Firmware Layer）

- `FastAPI` 保留 `/api/palette`、`/api/generate`、`/api/export/*`、`/api/wifi/*`。
- `firmware` 保留 BLE 服务 UUID、图像发送协议和 WiFi 配网协议。

## 6. 页面与组件设计

### 6.1 主页面：`pages/home/index`

主页面延续现有首页的结构，仍以单页为中心：

- 顶部轻量工具栏。
- 中央主画布区。
- 配对前的扫码引导态。
- 示例图片区域。
- 颜色统计面板。

该页面负责聚合以下组件：

- `Toolbar`
- `CanvasPanel`
- `ExampleGallery`
- `ColorPanel`
- `PairSheet`
- `SettingsSheet`
- `ToastHost`

### 6.2 `Toolbar`

保留当前页面的核心按钮布局和语义：

- 背景去除开关。
- 清空当前图案。
- 上传图片。
- 扫描二维码。
- 难度选择。
- LED 尺寸选择。
- 连接模式快速切换（仅 `蓝牙 / WiFi`）。
- 设置按钮。

视觉上保持当前按钮尺寸、边框风格和蓝白配色。

### 6.3 `CanvasPanel`

负责以下职责：

- 在未配对或未生成图案时显示扫码引导态。
- 在生成完成后展示预览图或像素画布。
- 根据高亮色列表更新画面表现。

明确删除以下职责：

- 编辑模式。
- 单点点击改色。
- 颜色弹出面板。

### 6.4 `ExampleGallery`

保留当前 4 张示例图的展示形式和入口语义：

- 点击示例图后载入原图。
- 自动触发图案生成流程。

### 6.5 `ColorPanel`

负责以下职责：

- 展示 `color_summary`。
- 允许点击颜色进行高亮切换。
- 将高亮状态同步到当前画布与设备。

不再承载像素编辑。

### 6.6 `PairSheet`

配对弹层统一承载以下流程：

- 扫码识别二维码。
- 手动输入 UUID。
- BLE 设备连接。
- 在 WiFi 模式下触发热点扫描。
- 选择热点并输入密码。

虽然内部状态会拆分，但外部交互保持“一个配对弹层完成设备绑定”的体验。

### 6.7 `SettingsSheet`

设置弹层保留以下内容：

- 模式切换：`蓝牙 / WiFi`
- 操作按钮：
  - 发送到 ESP32
  - 导出 PNG
  - 导出 PDF
  - 导出 JSON

明确移除：

- 串口设置区
- 波特率配置
- 串口端口扫描

## 7. 状态模型

当前 `window.appState` 将拆分为多个领域状态，避免单文件巨型状态对象。

### 7.1 `patternState`

负责：

- 原始图片
- 示例图状态
- `pixel_matrix`
- `color_summary`
- `grid_size`
- `total_beads`
- `palette_preset`
- 背景去除开关
- 难度和 LED 尺寸

### 7.2 `deviceState`

负责：

- `targetDeviceUuid`
- 当前连接模式（`ble` / `wifi`）
- BLE 连接状态
- BLE 特征状态
- WiFi 扫描结果
- 当前选中的热点
- 已注册设备 IP
- 当前发送中状态

### 7.3 `uiState`

负责：

- 配对弹层开关
- 设置弹层开关
- Toast 消息
- 加载态
- 当前扫码模式

## 8. 服务与适配设计

### 8.1 图像服务：`patternService`

职责：

- 拉取调色板数据：`GET /api/palette`
- 生成拼豆图：`POST /api/generate`
- 触发导出：`POST /api/export/png|pdf|json`

页面层不直接发请求，统一通过 `patternService` 调用。

### 8.2 BLE 适配层：`bleAdapter`

职责：

- 连接目标设备。
- 发现服务和特征。
- 发送图像数据。
- 发送高亮数据。
- 在 WiFi 模式下发起热点扫描和联网命令。

端差异：

- 微信小程序：调用 Taro 对应的小程序 BLE 能力。
- H5：调用浏览器 `Web Bluetooth`。

约束：

- 页面组件不得直接使用 `navigator.bluetooth` 或平台原生 BLE API。
- 页面层只调用诸如 `connectTargetDevice()`、`sendImage()`、`scanWifiNetworks()` 等统一方法。

### 8.3 WiFi 服务：`wifiService`

职责：

- 调用 `FastAPI` 的设备注册接口。
- 调用 `FastAPI` 的 WiFi 图像发送接口。
- 调用 `FastAPI` 的 WiFi 高亮接口。

接口映射：

- `POST /api/wifi/register`
- `POST /api/wifi/send`
- `POST /api/wifi/highlight`

### 8.4 扫码适配层：`scanAdapter`

职责：

- 提供统一的扫码入口。
- 统一输出二维码中的 UUID 或 URL 参数。

端差异：

- 微信小程序：使用平台扫码能力。
- H5：保留现有摄像头/图片识别思路。

### 8.5 文件导出适配层：`fileAdapter`

职责：

- H5：处理下载文件。
- 微信小程序：处理临时文件、预览或保存逻辑。

原则：

- 不在前端重写导出逻辑。
- 继续以服务端产物为准。

## 9. 核心数据流

### 9.1 图像生成流

```text
用户选择图片/示例图
  -> Taro 页面更新 patternState
  -> patternService 调用 /api/generate
  -> 返回 pixel_matrix / color_summary / preview
  -> 页面渲染画布与颜色面板
```

### 9.2 BLE 图像发送流

```text
用户完成 UUID 锁定
  -> PairSheet 调用 bleAdapter.connectTargetDevice()
  -> 建立 BLE 连接
  -> SettingsSheet 或首页触发发送
  -> bleAdapter.sendImage(pixel_matrix, backgroundColor)
  -> 设备显示图像
```

### 9.3 WiFi 配网与发送流

```text
用户切换到 WiFi 模式
  -> PairSheet 建立 BLE 连接
  -> bleAdapter.scanWifiNetworks()
  -> 用户选择热点并输入密码
  -> bleAdapter.sendWifiCredentials()
  -> FastAPI /api/wifi/register 注册设备
  -> 后续通过 /api/wifi/send 或 /api/wifi/highlight 发送数据
```

### 9.4 颜色高亮流

```text
用户点击颜色标签
  -> 更新 activeColors
  -> CanvasPanel 局部重绘高亮
  -> 按当前连接模式选择 bleAdapter.sendHighlight() 或 wifiService.highlight()
```

## 10. 删除与裁剪项

以下能力不进入新版本设计：

- `/api/update_cell`
- 前端 `editMode`
- 单点点击改色
- 颜色弹出选择器
- 串口端口扫描
- 串口发送
- 串口高亮
- 依赖 DOM 查询和直接节点操作的逻辑

删除这些能力的原因如下：

- 与首期微信小程序目标无关。
- 显著增加页面逻辑复杂度。
- 会放大平台差异处理成本。
- 不符合本次“保留核心链路、先完成多端迁移”的范围控制原则。

## 11. 与现有后端的契约

### 11.1 保留的 API

- `GET /api/palette`
- `POST /api/generate`
- `POST /api/export/png`
- `POST /api/export/pdf`
- `POST /api/export/json`
- `POST /api/wifi/register`
- `POST /api/wifi/send`
- `POST /api/wifi/highlight`

### 11.2 不再依赖的 API

- `/api/update_cell`（如果未来出现，也不进入 Taro 版本）
- 所有 `/api/serial/*`

### 11.3 协议约束

- BLE 服务 UUID 和特征 UUID 保持不变。
- BLE 图像传输分包协议保持不变。
- WiFi 热点扫描与联网协议保持不变。

如果后续联调发现小程序 BLE 行为与 H5 有差异，应优先在适配层处理，不应反向污染页面组件结构。

## 12. 错误处理设计

### 12.1 图像生成错误

- 图片格式错误：页面提示用户重新选择图片。
- 图片过大：提示超出限制。
- 服务端生成失败：展示 Toast，并保留当前页面状态。

### 12.2 BLE 错误

- 找不到目标设备：提示用户确认 UUID 与设备名称。
- 连接失败：允许重新连接，不清空当前图案。
- 发送中断：提示重试，并保留已生成结果。

### 12.3 WiFi 错误

- 热点扫描失败：允许重新扫描。
- 联网失败：提示密码错误或网络不可达。
- 设备未注册：引导重新扫描设备并完成配网。

### 12.4 导出错误

- 服务端导出失败：显示失败提示。
- 小程序保存失败：提示用户重试或切换预览。

## 13. 测试与验证策略

### 13.1 组件层验证

- 主页面是否保持原有布局层次。
- 配对弹层和设置弹层是否覆盖核心场景。
- 删除单点改色后是否不存在残留入口。

### 13.2 服务层验证

- `patternService` 是否正确对接现有 FastAPI 接口。
- `wifiService` 是否正确对接设备注册与发送接口。
- `bleAdapter` 是否对页面暴露统一方法。

### 13.3 端能力验证

- 微信小程序端：
  - 扫码
  - BLE 连接
  - WiFi 热点扫描
  - 图片发送
  - 导出文件处理
- H5 端：
  - 图片上传
  - `Web Bluetooth`
  - 导出下载

### 13.4 回归重点

- 示例图生成链路。
- UUID 锁定链路。
- BLE 图像发送链路。
- WiFi 配网与发送链路。
- 颜色高亮链路。

## 14. 实施建议

建议按以下顺序实施：

1. 搭建 `frontend-taro/` 基础工程。
2. 还原首页布局和样式骨架。
3. 接入 `patternService`，跑通图片生成链路。
4. 接入 `PairSheet` 和 `bleAdapter`，跑通 BLE 配对与发送。
5. 接入 WiFi 扫描、联网与服务端发送。
6. 接入导出链路。
7. 删除旧前端中不再需要的能力映射与兼容逻辑。

## 15. 结论

本次重构采用“`frontend-taro/` 独立前端工程 + 现有 FastAPI 服务 + 现有 firmware 协议”的方案。

该方案的优势如下：

- 能最大程度保留当前 UI 排版和风格。
- 能控制迁移风险，避免同时重写前端、后端和固件。
- 能通过适配层隔离微信小程序与 H5 的平台差异。
- 能通过主动删减串口与单点改色能力，降低首版复杂度。

该设计完成后，下一步应进入实现计划编写阶段，拆解为可执行的迁移任务。
