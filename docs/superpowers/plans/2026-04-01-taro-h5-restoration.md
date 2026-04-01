# PixelDoodle Taro H5 原版前端恢复实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让 `frontend-taro` 的 H5 首页及其相关弹层在视觉、DOM 语义、运行态和功能上与 `main.py` 启动的原版前端保持一致，并在每个检查点保留截图证据。

**架构：** 保留 Taro 的状态层、服务层和多端工程结构，只对 H5 建立原版语义恢复层。通过 H5 专用 DOM、原版 class、浏览器原生能力和从 `static/app.js` 迁移出的运行时辅助函数，恢复首屏、画布、颜色面板和弹层。样式层优先解决 Taro H5 的尺寸换算问题，再恢复运行态。

**技术栈：** Taro H5、React 18、TypeScript、Sass、Zustand、FastAPI、Chrome DevTools MCP、Playwright MCP

---

## 文件结构

### 新建文件

- `frontend-taro/src/pages/home/h5-runtime.ts`：恢复首页运行态，包含上传区文案、工具栏 chip、区域显隐和按钮状态的纯函数。
- `frontend-taro/src/pages/home/h5-canvas.ts`：恢复原版 `renderCanvas` 的尺寸计算、透明棋盘格、高亮遮罩和网格绘制。
- `frontend-taro/src/pages/home/__tests__/h5-runtime.test.ts`：校验首页运行态映射。
- `frontend-taro/src/pages/home/__tests__/h5-canvas.test.ts`：校验画布尺寸和高亮绘制输入模型。
- `frontend-taro/src/components/settings-sheet/index.h5.tsx`：H5 专用设置弹层，DOM 与原版设置弹层一致。
- `frontend-taro/src/components/settings-sheet/index.h5.scss`：H5 专用设置弹层样式。
- `frontend-taro/src/components/pair-sheet/index.h5.tsx`：H5 专用扫码/WiFi 弹层，DOM 与原版一致。
- `frontend-taro/src/components/pair-sheet/index.h5.scss`：H5 专用扫码/WiFi 弹层样式。
- `frontend-taro/src/components/crop-dialog/index.h5.tsx`：H5 专用裁剪弹层。
- `frontend-taro/src/components/crop-dialog/index.h5.scss`：H5 专用裁剪弹层样式。
- `frontend-taro/src/components/ble-quick-connect/index.h5.tsx`：H5 专用蓝牙快速连接弹层。
- `frontend-taro/src/components/ble-quick-connect/index.h5.scss`：H5 专用蓝牙快速连接弹层样式。
- `docs/superpowers/plans/2026-04-01-taro-h5-restoration.md`：当前实现计划。

### 修改文件

- `frontend-taro/config/index.ts`：调整 H5 样式构建，避免原版样式继续被 `px -> rem` 缩放。
- `frontend-taro/src/app.scss`：去掉会干扰 H5 原版恢复层的全局样式。
- `frontend-taro/src/index.html`：确保 H5 页面外壳与原版容器、标题和静态注入兼容。
- `frontend-taro/src/pages/home/index.h5.tsx`：H5 首页主视图，按原版 DOM 结构恢复首屏、画布、示例区和颜色区。
- `frontend-taro/src/styles/template-h5.scss`：承载原版 H5 恢复样式，保留原始像素尺寸。
- `frontend-taro/src/services/pattern-service.ts`：补齐 H5 上传与导出在浏览器原生链路下的细节，保证功能和原版一致。
- `frontend-taro/src/store/pattern-store.ts`：为 H5 恢复层补足生成态、示例图和画布所需状态。
- `frontend-taro/src/components/pair-sheet/index.tsx`：保留非 H5 端实现，补平台分发。
- `frontend-taro/src/components/settings-sheet/index.tsx`：保留非 H5 端实现，补平台分发。

### 截图产物

- `D:/Workspace/PixelDoodle/.codex-artifacts/original-home.png`：原版首页基线。
- `D:/Workspace/PixelDoodle/.codex-artifacts/taro-home-current.png`：当前 H5 基线。
- `D:/Workspace/PixelDoodle/.codex-artifacts/*.png`：每个任务的对比截图输出目录。

---

### 任务 1：消除 H5 样式缩放，恢复原始像素尺寸

**文件：**
- 修改：`frontend-taro/config/index.ts`
- 修改：`frontend-taro/src/app.scss`
- 修改：`frontend-taro/src/styles/template-h5.scss`
- 修改：`frontend-taro/src/pages/home/index.h5.tsx`

- [ ] **步骤 1：先证明当前构建产物仍在错误缩放**

运行：

```bash
cd D:\Workspace\PixelDoodle\.worktrees\taro-app-refactor\frontend-taro
npm run build:h5
Select-String -Path dist\css\*.css -Pattern "width:\s*15rem|padding:\s*0\.6rem"
```

预期：能在构建产物里看到 `.canvas-toolbar`、`.main-container` 等规则被转换成 `15rem`、`0.6rem` 一类值，说明当前 H5 仍在缩放。

- [ ] **步骤 2：将原版恢复样式移出 px transform 链路**

在 `frontend-taro/src/styles/template-h5.scss` 顶部加入禁用注释，并保证原版关键尺寸只在该文件中定义：

```scss
/*postcss-pxtransform disable*/

.main-container {
  padding: 24px;
}

.canvas-toolbar {
  width: 600px;
  max-width: 600px;
  gap: 8px;
}

#result-area {
  max-width: 640px;
}
```

要求：

- 不再把这类关键尺寸写进会被 Taro 全局样式换算的共享样式文件。
- `frontend-taro/src/app.scss` 中保留通用变量，但移除会覆盖 H5 原版布局的通用 `.section`、`.section-title` 和容器尺寸规则。

- [ ] **步骤 3：确保 H5 首页使用原版恢复根节点**

在 `frontend-taro/src/pages/home/index.h5.tsx` 中维持原版容器类名：

```tsx
return (
  <div className="template-home-page">
    <div className="main-container">
      <div id="result-area">
        {/* 原版首页内容 */}
      </div>
    </div>
  </div>
)
```

- [ ] **步骤 4：重新构建并验证关键尺寸回到像素值**

运行：

```bash
cd D:\Workspace\PixelDoodle\.worktrees\taro-app-refactor\frontend-taro
npm run build:h5
Select-String -Path dist\css\*.css -Pattern "width:\s*600px|padding:\s*24px|max-width:\s*640px"
```

预期：构建产物中出现 `600px`、`24px`、`640px`，不再出现同位置的 `15rem`、`0.6rem`。

- [ ] **步骤 5：截图核对首屏尺寸是否回到原版**

使用 Chrome DevTools MCP 分别打开：

- `http://127.0.0.1:8765/`
- `http://127.0.0.1:10086/#/pages/home/index`

保存截图：

- `D:/Workspace/PixelDoodle/.codex-artifacts/task1-original-home.png`
- `D:/Workspace/PixelDoodle/.codex-artifacts/task1-taro-home.png`

预期：工具栏、上传区、示例区不再整体缩成原版的 `0.4` 倍。

- [ ] **步骤 6：Commit**

```bash
git add frontend-taro/config/index.ts frontend-taro/src/app.scss frontend-taro/src/styles/template-h5.scss frontend-taro/src/pages/home/index.h5.tsx
git commit -m "fix(H5还原): 消除首页样式缩放"
```

### 任务 2：恢复首页首屏 DOM、字体、图标和工具栏节奏

**文件：**
- 创建：`frontend-taro/src/pages/home/h5-runtime.ts`
- 创建：`frontend-taro/src/pages/home/__tests__/h5-runtime.test.ts`
- 修改：`frontend-taro/src/pages/home/index.h5.tsx`
- 修改：`frontend-taro/src/styles/template-h5.scss`
- 修改：`frontend-taro/src/index.html`

- [ ] **步骤 1：为首页运行态映射编写失败测试**

```ts
// frontend-taro/src/pages/home/__tests__/h5-runtime.test.ts
import { describe, expect, it } from 'vitest'
import { deriveH5HomeViewState } from '../h5-runtime'

describe('deriveH5HomeViewState', () => {
  it('shows scan guide when no target device and no pattern exists', () => {
    expect(
      deriveH5HomeViewState({
        targetDeviceUuid: null,
        bleConnectedUuid: null,
        hasPattern: false,
        connectionMode: 'ble'
      })
    ).toMatchObject({
      showUploadArea: true,
      showExamples: true,
      showCanvas: false,
      uploadAreaMode: 'scan'
    })
  })

  it('shows upload prompt when ble target is connected', () => {
    expect(
      deriveH5HomeViewState({
        targetDeviceUuid: 'ABCD',
        bleConnectedUuid: 'ABCD',
        hasPattern: false,
        connectionMode: 'ble'
      })
    ).toMatchObject({
      uploadAreaMode: 'upload',
      toolbarChipText: '设备已连接：ABCD'
    })
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：

```bash
cd D:\Workspace\PixelDoodle\.worktrees\taro-app-refactor\frontend-taro
npm run test -- src/pages/home/__tests__/h5-runtime.test.ts
```

预期：失败，提示 `../h5-runtime` 或 `deriveH5HomeViewState` 尚未实现。

- [ ] **步骤 3：实现首页运行态辅助函数**

```ts
// frontend-taro/src/pages/home/h5-runtime.ts
type UploadAreaMode = 'scan' | 'locked' | 'upload'

export function deriveH5HomeViewState(input: {
  targetDeviceUuid: string | null
  bleConnectedUuid: string | null
  hasPattern: boolean
  connectionMode: 'ble' | 'wifi'
}) {
  const isConnected =
    Boolean(input.targetDeviceUuid) &&
    Boolean(input.bleConnectedUuid) &&
    input.targetDeviceUuid === input.bleConnectedUuid

  const uploadAreaMode: UploadAreaMode = isConnected
    ? 'upload'
    : input.targetDeviceUuid
      ? 'locked'
      : 'scan'

  return {
    showUploadArea: !input.hasPattern,
    showExamples: !input.hasPattern,
    showCanvas: input.hasPattern,
    showColorPanel: input.hasPattern,
    uploadAreaMode,
    toolbarChipText: isConnected
      ? `设备已连接：${input.bleConnectedUuid}`
      : input.targetDeviceUuid
        ? `目标设备：${input.targetDeviceUuid}`
        : ''
  }
}
```

- [ ] **步骤 4：用原版 DOM 逐项替换首屏和工具栏**

在 `frontend-taro/src/pages/home/index.h5.tsx` 中按 [templates/index.html](D:/Workspace/PixelDoodle/templates/index.html) 恢复：

```tsx
<div className="canvas-toolbar">
  <div style={{ flex: 1 }} />
  <div id="ble-target-chip" className="toolbar-chip" style={{ display: chipText ? 'inline-flex' : 'none' }}>
    {chipText}
  </div>
  <button id="bg-toggle" className="toolbar-btn" title="自动去除背景">背</button>
  <button id="clear-btn" className="toolbar-btn" title="清除">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  </button>
  <button id="upload-btn" className="toolbar-btn" title="上传">
    <span className="toolbar-btn-icon">+</span>
  </button>
  <button id="scan-btn" className="toolbar-btn" title="扫描二维码">{/* 原版 SVG */}</button>
  <select id="difficulty-select" className="led-size-btn" title="难度">{/* 原版 options */}</select>
  <select id="led-matrix-size" className="led-size-btn">{/* 原版 options */}</select>
  <button id="mode-quick-btn" className="toolbar-btn mode-quick-btn" title="连接模式">蓝牙</button>
  <button className="toolbar-btn" title="设置">{/* 原版设置 SVG */}</button>
</div>
```

要求：

- 不再使用自定义的 `toolbar-btn__label` 一类新结构。
- 文本、字体栈、字重、SVG 路径、按钮尺寸和间距全部以原版为准。
- `frontend-taro/src/index.html` 的页面标题改为与原版一致：`BeadCraft - Perler Bead Pattern Generator`。

- [ ] **步骤 5：运行测试验证通过**

运行：

```bash
cd D:\Workspace\PixelDoodle\.worktrees\taro-app-refactor\frontend-taro
npm run test -- src/pages/home/__tests__/h5-runtime.test.ts
```

预期：2 个测试通过。

- [ ] **步骤 6：截图核对首屏和工具栏**

保存截图：

- `D:/Workspace/PixelDoodle/.codex-artifacts/task2-original-home.png`
- `D:/Workspace/PixelDoodle/.codex-artifacts/task2-taro-home.png`

预期：工具栏的字体、图标、按钮宽高、间距和上传框位置与原版一致；如仍有偏差，在提交说明中明确列出。

- [ ] **步骤 7：Commit**

```bash
git add frontend-taro/src/pages/home/h5-runtime.ts frontend-taro/src/pages/home/__tests__/h5-runtime.test.ts frontend-taro/src/pages/home/index.h5.tsx frontend-taro/src/styles/template-h5.scss frontend-taro/src/index.html
git commit -m "fix(H5还原): 恢复首页首屏与工具栏"
```

### 任务 3：恢复原版运行态切换、画布绘制和颜色区

**文件：**
- 创建：`frontend-taro/src/pages/home/h5-canvas.ts`
- 创建：`frontend-taro/src/pages/home/__tests__/h5-canvas.test.ts`
- 修改：`frontend-taro/src/pages/home/index.h5.tsx`
- 修改：`frontend-taro/src/store/pattern-store.ts`
- 修改：`frontend-taro/src/services/pattern-service.ts`
- 修改：`frontend-taro/src/styles/template-h5.scss`

- [ ] **步骤 1：为画布尺寸计算和高亮逻辑编写失败测试**

```ts
// frontend-taro/src/pages/home/__tests__/h5-canvas.test.ts
import { describe, expect, it } from 'vitest'
import { buildCanvasRenderModel } from '../h5-canvas'

describe('buildCanvasRenderModel', () => {
  it('fits the pattern into a 640x640 canvas like the original page', () => {
    const model = buildCanvasRenderModel({
      gridWidth: 64,
      gridHeight: 64,
      activeCodes: new Set<string>(),
      pixelMatrix: Array.from({ length: 64 }, () => Array.from({ length: 64 }, () => 'A1'))
    })

    expect(model.cellSize).toBe(10)
    expect(model.canvasWidth).toBe(640)
    expect(model.canvasHeight).toBe(640)
  })

  it('marks non-highlighted cells when active colors exist', () => {
    const model = buildCanvasRenderModel({
      gridWidth: 2,
      gridHeight: 1,
      activeCodes: new Set(['A1']),
      pixelMatrix: [['A1', 'B2']]
    })

    expect(model.cells[1].masked).toBe(true)
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：

```bash
cd D:\Workspace\PixelDoodle\.worktrees\taro-app-refactor\frontend-taro
npm run test -- src/pages/home/__tests__/h5-canvas.test.ts
```

预期：失败，提示 `buildCanvasRenderModel` 尚未实现。

- [ ] **步骤 3：实现原版画布模型和绘制函数**

```ts
// frontend-taro/src/pages/home/h5-canvas.ts
export function buildCanvasRenderModel(input: {
  gridWidth: number
  gridHeight: number
  activeCodes: Set<string>
  pixelMatrix: (string | null)[][]
}) {
  const maxPatternDim = 640
  const cellSize = Math.max(
    2,
    Math.min(
      Math.floor(maxPatternDim / input.gridWidth),
      Math.floor(maxPatternDim / input.gridHeight)
    )
  )

  return {
    cellSize,
    canvasWidth: input.gridWidth * cellSize,
    canvasHeight: input.gridHeight * cellSize,
    cells: input.pixelMatrix.flatMap((row, y) =>
      row.map((code, x) => ({
        x,
        y,
        code,
        masked: code !== null && input.activeCodes.size > 0 && !input.activeCodes.has(code)
      }))
    )
  }
}
```

并在 `frontend-taro/src/pages/home/index.h5.tsx` 中用该模型驱动 `canvas` 绘制，恢复原版：

- `640 x 640` 适配逻辑
- 透明棋盘格
- 高亮遮罩
- 网格线
- `clearCanvas()` 对应的 section 显隐切换

- [ ] **步骤 4：把原版运行态切换迁回首页**

在 `frontend-taro/src/pages/home/index.h5.tsx` 中按原版函数行为恢复：

- `renderBleStatus`
- `clearCanvas`
- `loadExampleImage`
- `onDifficultyChange`
- `updateLedSizeDisplay`
- `toggleBackground`
- `toggleColorHighlight`

要求：

- `upload-area` 文案必须随“未配对 / 已锁定 / 已连接”切换。
- `examples-container`、`pattern-canvas`、`color-panel` 的显隐与原版一致。
- 示例图点击后立即隐藏上传区和示例区，再进入生成链路。
- H5 上传继续使用浏览器原生 `fetch + FormData`，不能回退到不稳定的 Taro H5 上传抽象。

- [ ] **步骤 5：运行测试验证通过**

运行：

```bash
cd D:\Workspace\PixelDoodle\.worktrees\taro-app-refactor\frontend-taro
npm run test -- src/pages/home/__tests__/h5-runtime.test.ts src/pages/home/__tests__/h5-canvas.test.ts
```

预期：全部通过。

- [ ] **步骤 6：截图核对生成态和颜色区**

操作路径：

1. 打开原版首页，点击示例图生成图案。
2. 打开 Taro H5 首页，执行同一路径。
3. 分别保存：

- `D:/Workspace/PixelDoodle/.codex-artifacts/task3-original-generated.png`
- `D:/Workspace/PixelDoodle/.codex-artifacts/task3-taro-generated.png`

预期：画布大小、网格、颜色遮罩、颜色区块顺序和总数样式与原版一致。

- [ ] **步骤 7：Commit**

```bash
git add frontend-taro/src/pages/home/h5-canvas.ts frontend-taro/src/pages/home/__tests__/h5-canvas.test.ts frontend-taro/src/pages/home/index.h5.tsx frontend-taro/src/store/pattern-store.ts frontend-taro/src/services/pattern-service.ts frontend-taro/src/styles/template-h5.scss
git commit -m "fix(H5还原): 恢复画布与运行态切换"
```

### 任务 4：恢复设置、扫码、裁剪和蓝牙快速连接弹层

**文件：**
- 创建：`frontend-taro/src/components/settings-sheet/index.h5.tsx`
- 创建：`frontend-taro/src/components/settings-sheet/index.h5.scss`
- 创建：`frontend-taro/src/components/pair-sheet/index.h5.tsx`
- 创建：`frontend-taro/src/components/pair-sheet/index.h5.scss`
- 创建：`frontend-taro/src/components/crop-dialog/index.h5.tsx`
- 创建：`frontend-taro/src/components/crop-dialog/index.h5.scss`
- 创建：`frontend-taro/src/components/ble-quick-connect/index.h5.tsx`
- 创建：`frontend-taro/src/components/ble-quick-connect/index.h5.scss`
- 修改：`frontend-taro/src/pages/home/index.h5.tsx`

- [ ] **步骤 1：用原版弹层 DOM 建立 H5 专用组件**

在 H5 端按原版弹层结构恢复以下容器和 id：

```tsx
// settings-sheet/index.h5.tsx
<div id="serial-settings-dialog" className="modal" style={{ display: open ? 'flex' : 'none' }}>
  <div className="modal-content modal-content-form qr-modal-content">
    {/* 原版 header / body / footer */}
  </div>
</div>
```

```tsx
// pair-sheet/index.h5.tsx
<div id="qr-scanner-dialog" className="modal" style={{ display: open ? 'flex' : 'none' }}>
  <div className="modal-content modal-content-form qr-modal-content">
    {/* 原版蓝牙/WiFi 切换、视频框、手输 UUID、WiFi 热点列表 */}
  </div>
</div>
```

要求：

- H5 专用组件的 DOM 层级、id、class 与原版保持一致。
- 不复用当前简化版弹层结构。

- [ ] **步骤 2：恢复弹层打开/关闭与联动行为**

在 `frontend-taro/src/pages/home/index.h5.tsx` 中恢复对应事件：

- `showSerialSettings`
- `hideSerialSettings`
- `openQrScanner`
- `closeQrScanner`
- `cancelCrop`
- `confirmCrop`
- `triggerQrHotspotScan`
- `connectSelectedQrWifi`

其中关键行为应与原版一致：

- 打开设置时，按连接模式刷新 BLE / WiFi / Serial 面板对应内容。
- 打开扫码弹层时，默认进入原版同样的模式按钮和状态文案。
- 裁剪弹层保留原版按钮布局和标题。
- 蓝牙快速连接弹层保留“稍后 / 连接设备”结构。

- [ ] **步骤 3：截图核对各弹层**

至少保存以下截图：

- `D:/Workspace/PixelDoodle/.codex-artifacts/task4-original-settings.png`
- `D:/Workspace/PixelDoodle/.codex-artifacts/task4-taro-settings.png`
- `D:/Workspace/PixelDoodle/.codex-artifacts/task4-original-qr.png`
- `D:/Workspace/PixelDoodle/.codex-artifacts/task4-taro-qr.png`

如该轮已恢复裁剪或快速连接弹层，再补：

- `task4-original-crop.png`
- `task4-taro-crop.png`
- `task4-original-quick-connect.png`
- `task4-taro-quick-connect.png`

- [ ] **步骤 4：Commit**

```bash
git add frontend-taro/src/components/settings-sheet/index.h5.tsx frontend-taro/src/components/settings-sheet/index.h5.scss frontend-taro/src/components/pair-sheet/index.h5.tsx frontend-taro/src/components/pair-sheet/index.h5.scss frontend-taro/src/components/crop-dialog/index.h5.tsx frontend-taro/src/components/crop-dialog/index.h5.scss frontend-taro/src/components/ble-quick-connect/index.h5.tsx frontend-taro/src/components/ble-quick-connect/index.h5.scss frontend-taro/src/pages/home/index.h5.tsx
git commit -m "fix(H5还原): 恢复首页相关弹层"
```

### 任务 5：功能回归、截图审阅和交付核对

**文件：**
- 修改：`frontend-taro/src/pages/home/index.h5.tsx`（如发现剩余微调）
- 修改：`frontend-taro/src/styles/template-h5.scss`（如发现剩余微调）
- 产物：`D:/Workspace/PixelDoodle/.codex-artifacts/*.png`

- [ ] **步骤 1：运行功能回归命令**

运行：

```bash
cd D:\Workspace\PixelDoodle\.worktrees\taro-app-refactor\frontend-taro
npm run test -- src/pages/home/__tests__/h5-runtime.test.ts src/pages/home/__tests__/h5-canvas.test.ts
npm run build:h5
```

预期：测试通过，H5 构建成功。

- [ ] **步骤 2：按用户路径逐项手工回归**

必须核对以下路径：

1. 首屏未配对态
2. 点击示例图生成图案
3. 上传本地图片生成图案
4. 打开设置弹层
5. 打开扫码弹层
6. 切换难度
7. 切换 LED 尺寸
8. 切换去背按钮
9. 导出 PNG / PDF / JSON

每项都要在原版和 Taro H5 中各走一次。

- [ ] **步骤 3：保存最终对比截图**

至少保存：

- `D:/Workspace/PixelDoodle/.codex-artifacts/final-original-home.png`
- `D:/Workspace/PixelDoodle/.codex-artifacts/final-taro-home.png`
- `D:/Workspace/PixelDoodle/.codex-artifacts/final-original-generated.png`
- `D:/Workspace/PixelDoodle/.codex-artifacts/final-taro-generated.png`
- `D:/Workspace/PixelDoodle/.codex-artifacts/final-original-settings.png`
- `D:/Workspace/PixelDoodle/.codex-artifacts/final-taro-settings.png`
- `D:/Workspace/PixelDoodle/.codex-artifacts/final-original-qr.png`
- `D:/Workspace/PixelDoodle/.codex-artifacts/final-taro-qr.png`

- [ ] **步骤 4：记录剩余差异**

在最终说明中必须明确写出以下两种情况之一：

```text
未发现剩余视觉差异。
```

或

```text
剩余差异：
1. ...
2. ...
```

不允许写“看起来基本一致”或“接近原版”。

- [ ] **步骤 5：Commit**

```bash
git add frontend-taro/src/pages/home/index.h5.tsx frontend-taro/src/styles/template-h5.scss
git commit -m "fix(H5还原): 完成首页功能回归与截图核对"
```
