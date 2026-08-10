# PixelDoodle Taro H5 原版前端恢复设计

## 1. 背景

当前项目同时存在两套前端入口：

- 原版前端：由 [main.py](D:/Workspace/PixelDoodle/main.py) 启动，页面入口为 [templates/index.html](D:/Workspace/PixelDoodle/templates/index.html)，样式为 [static/style.css](D:/Workspace/PixelDoodle/static/style.css)，运行时行为为 [static/app.js](D:/Workspace/PixelDoodle/static/app.js)。
- 新版前端：位于 [frontend-taro](D:/Workspace/PixelDoodle/.worktrees/taro-app-refactor/frontend-taro)，其中 H5 首页当前由 [index.h5.tsx](D:/Workspace/PixelDoodle/.worktrees/taro-app-refactor/frontend-taro/src/pages/home/index.h5.tsx) 和 [template-h5.scss](D:/Workspace/PixelDoodle/.worktrees/taro-app-refactor/frontend-taro/src/styles/template-h5.scss) 承担。

用户当前要求不是“尽量接近”，而是以下严格目标：

- 新版 Taro H5 前端与原版前端保持一模一样。
- 字体、图标、按钮、间距、组件大小、位置、弹层、状态切换都必须一致。
- 每个功能必须可正常使用。
- 每次检查或版本提交都必须截图审阅。

本规格仅处理 **Taro H5 恢复原版前端** 这一件事，不处理小程序或 RN 端视觉对齐。

## 2. 事实基线

### 2.1 唯一视觉基线

唯一基线是运行 [main.py](D:/Workspace/PixelDoodle/main.py) 后，通过 `http://127.0.0.1:8765/` 打开的原版页面。

不得以设计想象、组件近似实现或旧截图作为替代基线。

### 2.2 已采集的基线截图

- 原版首页截图：[original-home.png](D:/Workspace/PixelDoodle/.codex-artifacts/original-home.png)
- 当前 Taro H5 首页截图：[taro-home-current.png](D:/Workspace/PixelDoodle/.codex-artifacts/taro-home-current.png)

后续所有修复都必须继续沿用这两个地址做并排截图核对：

- 原版：`http://127.0.0.1:8765/`
- Taro H5：`http://127.0.0.1:10086/#/pages/home/index`

### 2.3 已确认的根因

当前新版 H5 与原版不一致，不是单一 CSS 细节问题，而是两类问题叠加：

1. **Taro H5 样式换算影响了原版尺寸。**
   - 证据：原版 `.canvas-toolbar` 宽度为 `600px`，当前页实际渲染为 `240px`。
   - 证据：原版 `.main-container` 的 `padding: 24px`，当前页实际渲染为 `9.6px`。
   - 说明：当前 H5 页面的样式被 Taro 的 `px -> rem` 机制缩放了约 `0.4` 倍。

2. **原版页面最终效果由 HTML、CSS、JS 三者共同决定。**
   - 原版不仅依赖模板结构和样式，还依赖 [static/app.js](D:/Workspace/PixelDoodle/static/app.js) 对 DOM、显示状态、文案、按钮状态和 canvas 的运行时改写。
   - 仅靠复刻模板 DOM 和样式，无法保证运行态一致。

## 3. 目标

本次恢复必须达到以下目标：

- Taro H5 首页首屏与原版首屏完全一致。
- Taro H5 的所有首页相关弹层与原版完全一致。
- Taro H5 的首页运行时状态切换与原版一致。
- Taro H5 的上传、示例图、生成、导出、设备连接入口等关键功能可正常使用。
- 每个检查点都形成截图证据。

## 4. 非目标

- 不要求本次同步恢复微信小程序或 RN 的视觉一致性。
- 不要求本次重构原版 Python 后端或 ESP32 协议。
- 不新增原版不存在的新 UI。
- 不为了共享组件而牺牲 H5 与原版的一致性。

## 5. 恢复范围

### 5.1 页面范围

本次恢复范围覆盖原版首页涉及的全部可见视图：

- 首页首屏
- 工具栏
- 上传引导区
- 生成后的画布区
- 示例图片区
- 颜色面板
- 设置弹层
- 二维码扫描弹层
- 图片裁剪弹层
- 蓝牙快速连接弹层
- Toast 与状态提示

### 5.2 状态范围

至少恢复以下运行态：

- 未配对首屏态
- 已锁定设备但未连接态
- 已连接可上传态
- 示例图加载态
- 图片上传后待生成态
- 图案生成成功态
- 颜色高亮态
- 设置弹层打开态
- 扫码弹层打开态
- WiFi 热点扫描与连接态
- 导出与发送入口可用态

## 6. 方案选择

### 6.1 方案 A：H5 专用原样恢复层（采用）

做法：

- 保留 Taro 工程、状态层、服务层与多端能力层。
- 为 H5 单独建立原版视图语义层。
- H5 视图层按原版 DOM 结构、类名、标签语义与状态机恢复。
- 将原版 [static/app.js](D:/Workspace/PixelDoodle/static/app.js) 的首页相关运行逻辑迁入 Taro H5 页面层。

优点：

- 最接近原版效果。
- 保留现有 Taro 工程与接口层成果。
- H5 可以精确恢复，不拖累小程序与 RN。

代价：

- H5 视图层与其他端视图层分平台维护。

### 6.2 方案 B：原版页面直接嵌入 Taro（不采用）

优点：

- 首屏最快接近原版。

缺点：

- 维护边界极差。
- 后续状态、接口和功能联调会形成双套运行逻辑。

### 6.3 方案 C：继续在当前组件树上修补（不采用）

不采用原因：

- 已经被实际渲染结果证伪。
- 当前偏差不是局部样式问题，而是整页尺寸换算与运行态缺失问题。

## 7. 技术设计

### 7.1 H5 视图层策略

H5 首页继续使用 [index.h5.tsx](D:/Workspace/PixelDoodle/.worktrees/taro-app-refactor/frontend-taro/src/pages/home/index.h5.tsx) 作为入口，但其内部必须满足以下要求：

- DOM 层级与原版首页保持一致。
- 标签语义优先沿用原版：`button`、`select`、`input`、`img`、`canvas`。
- class 命名与原版保持一致，避免重新发明一套 class 体系。
- 对原版依赖的 runtime DOM 行为，使用 React 状态和最小必要 DOM 控制恢复，但结果必须与原版一致。

### 7.2 样式策略

H5 样式层必须保证原版像素尺寸原样生效：

- 禁止让首页主样式继续被 Taro 的 `px -> rem` 换算缩放。
- 首页恢复所需的关键尺寸必须保持原值，例如：
  - `result-area` 的 `640px`
  - `canvas-toolbar` 与上传区的 `600px`
  - 工具按钮的 `36px`
  - 页面主容器的 `24px` 内边距
- 字体栈、字号、字重、行高、图标大小必须以原版为准，不允许“近似字体”。

### 7.3 运行逻辑恢复范围

必须从 [static/app.js](D:/Workspace/PixelDoodle/static/app.js) 中恢复以下首页相关运行行为：

- 上传区文案与点击行为切换
- BLE/WiFi 状态文案与 chip 显示
- 示例图区、上传区、画布区、颜色区的显示切换
- `bg-toggle` 的选中外观变化
- 难度切换与自定义滑杆显示
- LED 尺寸切换显示
- 画布绘制逻辑
- 颜色高亮逻辑
- 设置弹层、扫码弹层、裁剪弹层、快速连接弹层的显隐和交互

### 7.4 逻辑复用边界

以下部分继续复用现有 Taro 工程能力，不重新发明一套后端交互：

- 调色板拉取
- 图片上传与图案生成
- 导出 PNG/PDF/JSON
- BLE/WiFi service 层
- 全局状态存储

要求是“结果与原版一致”，而不是“实现方式必须逐行一致”。

## 8. 截图审阅制度

本次任务新增硬性要求：**每个版本或每个检查点都必须截图审阅。**

执行标准如下：

- 每次修改后至少保留两张截图：
  - 原版截图
  - 当前 Taro H5 截图
- 如该轮修改涉及弹层或特定状态，还必须补对应状态截图。
- 在宣称某个页面或状态已恢复之前，必须明确说明：
  - 对比基线是什么
  - 截图路径是什么
  - 当前是否仍有剩余差异

## 9. 验收标准

只有满足以下条件，才可认定 H5 恢复完成：

- 首页首屏截图与原版对齐，无明显尺寸、位置、字体、图标、间距偏差。
- 首页工具栏、上传区、示例区、颜色区与原版一致。
- 设置弹层、扫码弹层、裁剪弹层、快速连接弹层与原版一致。
- 图片上传、示例图加载、图案生成、导出、发送入口都能正常使用。
- 所有已恢复状态都具备对应截图证据。
- 完成说明中必须显式列出仍未恢复的差异；如果没有差异，必须说明“未发现剩余视觉差异”。

## 10. 风险与约束

- H5 原样恢复会进一步强化平台分层，H5 视图层与小程序/RN 视图层将不可避免地产生分叉。
- 若继续把原版样式直接放进 Taro 全局换算链路，视觉恢复将反复失败，因此必须优先解决尺寸换算问题。
- 原版页面的部分行为依赖浏览器原生能力；H5 端应优先使用浏览器原生实现，而不是强行套 Taro 抽象。

## 11. 下一步

规格确认后，进入实现计划阶段。

实现计划必须拆成可核对的阶段，至少包括：

1. 消除 H5 样式换算导致的尺寸缩放。
2. 恢复首页首屏与工具栏。
3. 恢复生成态画布与颜色区。
4. 恢复设置、扫码、裁剪、快速连接弹层。
5. 补齐功能回归与截图核对流程。
