# Rust Axum 后端替换设计

**日期：** 2026-04-08  
**目标版本：** `v9`

## 1. 目标

将当前基于 FastAPI 的服务替换为基于 Rust + Axum 的主服务，保持前端 API
协议不变，现有网页无需改请求格式即可继续工作。生产流量全部切到 Rust。
Python 代码继续保留在仓库中，但职责调整为：

- 作为结果真值基线
- 作为差分测试与问题回溯工具
- 不再作为默认线上 HTTP 服务入口

本次替换必须覆盖当前用户可见功能：

- `/` 首页与静态资源
- `/api/palette`
- `/api/generate`
- `/api/export/png`
- `/api/export/pdf`
- `/api/export/json`
- `/api/serial/ports`
- `/api/serial/send`
- `/api/serial/highlight`
- `/api/ble/devices`
- `/api/ble/send`

## 2. 非目标

- 不修复当前前端隐藏但本就未接通的旧接口，例如 `/api/update_cell`
- 不改变现有前端协议、字段命名、表单参数名、下载文件名格式
- 不改动当前固件 BLE 协议
- 不在本次替换中引入数据库、队列或外部缓存服务

## 3. 设计原则

### 3.1 接口兼容优先

Rust 服务对外维持与 `main.py` 相同的路由和响应形状。前端不需要修改 fetch
路径、字段名或上传方式。

### 3.2 结果一致性优先于实现形式

对以下结果执行严格一致约束：

- `/api/generate`
  - `pixel_matrix`
  - `grid_size`
  - `color_summary`
  - `total_beads`
- `/api/export/png`
  - 输出 PNG 像素级一致
- `/api/export/json`
  - 导出内容字段级一致，时间戳字段允许仅格式一致

对 `/api/export/pdf` 采用视觉等价约束，不要求字节完全一致，但要求：

- 版式一致
- 色块、坐标、色号、统计信息一致
- 页数与页面内容结构一致

### 3.3 分层替换

Rust 服务拆分为以下模块：

- `backend-rs/src/main.rs`
  - 启动 Axum 服务，挂载路由、静态资源、模板入口
- `backend-rs/src/http/*`
  - 各接口 handler、请求解析、错误映射
- `backend-rs/src/core/palette.rs`
  - 调色板 JSON / 预设加载、索引结构
- `backend-rs/src/core/color_match.rs`
  - RGB/Lab 转换、距离计算、批量匹配
- `backend-rs/src/core/quantizer.rs`
  - 图像预处理、下采样、聚类、后处理、结果汇总
- `backend-rs/src/core/session.rs`
  - 与 Python 当前行为兼容的内存 session
- `backend-rs/src/export/png.rs`
  - PNG 导出与 preview 生成
- `backend-rs/src/export/pdf.rs`
  - PDF 导出
- `backend-rs/src/export/json.rs`
  - JSON 导出
- `backend-rs/src/io/serial.rs`
  - 串口枚举与发送
- `backend-rs/src/io/ble.rs`
  - BLE 扫描与发送
- `backend-rs/tests/*`
  - Rust 单测、API 集成测试、与 Python 的差分测试

Python 保留：

- `main.py`
  - 改为兼容入口 / 仅开发用途说明
- `core/*.py`
  - 保留为差分基线，不删除
- `tools/parity/*.py`
  - 为 Rust 测试输出标准结果

## 4. 图像引擎方案

### 4.1 数据输入

Rust 端保持与当前 `/api/generate` 一致的表单字段：

- `file`
- `mode`
- `grid_width`
- `grid_height`
- `led_size`
- `pixel_size`
- `use_dithering`
- `palette_preset`
- `max_colors`
- `similarity_threshold`
- `remove_bg`
- `contrast`
- `saturation`
- `sharpness`

### 4.2 核心处理链

Rust 图像引擎沿用当前 Python 语义：

1. RGB 统一
2. 根据 `mode` 计算目标网格
3. 图像预处理
4. 极暗 / 极亮区域合并
5. 按预设选择候选子调色板
6. 中间分辨率量化
7. block mode-pooling 到目标网格
8. RGB -> 色号矩阵
9. 稀有色清理
10. 相似色合并
11. 最大色数限制
12. 边缘平滑
13. 可选背景移除
14. 汇总色表与 bead 统计

### 4.3 一致性策略

精度最敏感的地方是：

- resize 过滤器
- 调色板量化
- Lab 转换和距离
- 后处理阈值边界

因此 Rust 侧实现时采用“双轨验证”：

- 路由级差分：对示例图和固定参数，直接对比 JSON 响应
- 核心级差分：对量化后矩阵与颜色汇总逐字段比较

若某一步无法直接做到与 Python 完全一致，则优先调整 Rust 实现，不能以
修改前端或放宽接口要求来规避。

## 5. 前端与静态资源

### 5.1 首页

Rust 服务继续返回当前 `templates/index.html` 对应内容。由于现模板基本为静态
页面，Rust 端不引入重量级模板语法，采用以下策略：

- 首页按文件内容直出
- `/static` 与 `/examples` 继续按现路径暴露

### 5.2 版本标识

当前前端页面需升级为 `v9`，并保持与 Rust 后端入口一致：

- 页面角标
- 缓存 busting 参数
- README / 部署说明

## 6. 设备接口

### 6.1 串口

Rust 端继续提供：

- 可用串口枚举
- 图像数据包发送
- 高亮包发送

数据包格式必须与现固件兼容，不更改 RGB565 编码、居中缩放和边界填充逻辑。

### 6.2 BLE

Rust 端继续提供：

- 扫描 `BeadCraft-` 前缀设备
- 使用当前服务 UUID / characteristic UUID 发图

扫描与发送错误需映射为与当前 Python 近似的 500/400 语义，前端不新增专用
错误分支。

## 7. 错误处理

Rust 端统一定义 API 错误模型：

- 输入错误 -> `400`
- 文件类型 / 文件大小错误 -> `400`
- 图像打开失败 -> `400`
- 处理异常 / 导出异常 / 设备通讯异常 -> `500`

消息文案保持与当前 Python 文案尽量一致，避免前端 toast 出现异常回归。

## 8. 测试与验证

### 8.1 单元测试

- 调色板加载
- Lab 转换
- 最近色匹配
- 后处理函数
- 导出函数
- 串口包构建

### 8.2 差分测试

新增 Python 基线脚本，Rust 测试调用它生成金标准结果，覆盖：

- 示例图 3 张以上
- 固定网格 / pixel_size 两种模式
- 开关 `remove_bg`
- 开关 `similarity_threshold`
- 开关 `max_colors`

### 8.3 HTTP 集成测试

对 Rust 服务跑：

- `/api/palette`
- `/api/generate`
- `/api/export/png`
- `/api/export/pdf`
- `/api/export/json`

并校验状态码、响应头和关键字段。

### 8.4 人工回归

- 本地打开首页并生成示例图
- 导出 PNG / PDF / JSON
- 前端首页、工具栏、导出弹窗正常
- 若环境可用，验证串口/BLE 接口至少不回归构建与基本握手

## 9. 部署

部署入口从 Python 切到 Rust：

- 本地开发默认命令改为 `cargo run --manifest-path backend-rs/Cargo.toml`
- 生产部署脚本改为构建 Rust 二进制并启动
- Python 依赖保留，但不再是服务器主入口

服务器同步目标：

- Git 主分支与 `v9` 标签
- 远端部署目录 `/home/terry/PixelDoodle/`

## 10. 风险

### 10.1 量化一致性风险

风险最高。缓解方案：

- 先写差分测试
- 先以示例图固定结果锁定
- 分步骤 port，逐层验证

### 10.2 BLE Windows 兼容性风险

Rust BLE 生态在 Windows 上比 Python `bleak` 更敏感。缓解方案：

- 优先保持现有 UUID / 分包协议不变
- 先完成扫描与发送的单元/集成层
- 如某平台扫描不稳定，记录为平台限制，不改变 HTTP 形状

### 10.3 PDF 一致性风险

PDF 字节完全一致不现实，因此以视觉等价为验收标准，并通过页面结构和关键文
本内容回归验证。
