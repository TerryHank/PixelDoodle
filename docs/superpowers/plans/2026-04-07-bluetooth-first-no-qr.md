# 蓝牙优先无扫码改造实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在不重做现有视觉风格的前提下，移除网页扫码与串口路径，改为蓝牙主连接 + WiFi 备选，并同步调整固件待机页与高亮显示。

**架构：** 网页端以 `targetDeviceUuid` 作为唯一设备标识来源，蓝牙连接成功后负责写入该值，WiFi 模式只消费该值。固件端保留高亮颜色匹配，但命中后统一输出固定蓝色，而不是原像素色。

**技术栈：** FastAPI 模板页、原生前端 JavaScript、ESP32 Arduino / HUB75 面板

---

### 任务 1：落盘设计文档与忽略本地视觉稿

**文件：**
- 创建：`docs/superpowers/specs/2026-04-07-bluetooth-first-no-qr-design.md`
- 创建：`docs/superpowers/plans/2026-04-07-bluetooth-first-no-qr.md`
- 修改：`.gitignore`

- [ ] **步骤 1：补充设计文档并保存**

将已确认的范围、连接模型、固件变化与验证策略写入设计文档。

- [ ] **步骤 2：将本地视觉稿目录加入忽略**

在 `.gitignore` 中加入：

```gitignore
.superpowers/
```

- [ ] **步骤 3：验证文档文件存在**

运行：`Get-ChildItem docs\\superpowers\\specs,docs\\superpowers\\plans`

预期：能看到本次新增的设计文档与实现计划文件

- [ ] **步骤 4：提交文档变更**

运行：

```bash
git add .gitignore docs/superpowers/specs/2026-04-07-bluetooth-first-no-qr-design.md docs/superpowers/plans/2026-04-07-bluetooth-first-no-qr.md
git commit -m "docs(设计): 补充蓝牙优先无扫码改造规格"
```

### 任务 2：前端移除扫码与串口，保留蓝牙主路径和 WiFi 备选

**文件：**
- 修改：`templates/index.html`
- 修改：`static/app.js`
- 修改：`static/i18n.js`
- 修改：`static/style.css`

- [ ] **步骤 1：先编写一个最小失败验证脚本**

运行一个检查 DOM 关键入口是否存在的脚本，目标是让当前页面先失败：

```powershell
@'
const fs = require('fs');
const html = fs.readFileSync('templates/index.html', 'utf8');
if (html.includes('scan-btn') || html.includes('qr-scanner-dialog') || html.includes('serial-settings')) {
  process.exit(1);
}
'@ | node -
```

预期：当前返回非 0，因为页面里仍有扫码与串口结构

- [ ] **步骤 2：修改模板，移除扫码与串口 UI**

具体改动：

```text
1. 删除顶部扫码按钮
2. 将首页 upload-area 的 onclick 改为文件上传
3. 删除扫码弹窗整块 DOM
4. 删除串口设置区与串口模式按钮
5. WiFi 设置区改为显示“当前已记住设备”
```

- [ ] **步骤 3：修改前端状态流转**

在 `static/app.js` 中完成：

```text
1. 连接模式改为只支持 ble / wifi
2. 初始化不再读取扫码输入与串口扫描
3. upload-area 始终作为上传入口
4. 蓝牙连接成功后解析并保存 targetDeviceUuid
5. WiFi 模式只依赖 targetDeviceUuid
6. 删除对 openQrScanner() 与 serial 的主流程调用
```

- [ ] **步骤 4：修改文案与样式**

```text
1. 删除扫码相关文案
2. 删除串口相关文案
3. 删除扫码弹窗样式
4. 保留上传区、设置区原有视觉节奏
```

- [ ] **步骤 5：运行前端语法与结构验证**

运行：

```bash
node --check static/app.js
@'
const fs = require('fs');
const html = fs.readFileSync('templates/index.html', 'utf8');
if (html.includes('scan-btn') || html.includes('qr-scanner-dialog') || html.includes('serial-settings')) {
  process.exit(1);
}
'@ | node -
```

预期：全部返回 0

- [ ] **步骤 6：浏览器验证连接模式与首页入口**

运行：打开本地页面并确认以下结果

```text
1. 首页上传区点击直接打开文件选择
2. 工具栏没有扫码按钮
3. 设置面板只有蓝牙与 WiFi
4. 蓝牙连接成功后显示记住的设备序列号
```

- [ ] **步骤 7：提交前端结构改造**

运行：

```bash
git add templates/index.html static/app.js static/i18n.js static/style.css
git commit -m "refactor(前端): 移除扫码与串口主流程"
```

### 任务 3：恢复黑色按黑色发送，并让 WiFi 使用记住的设备

**文件：**
- 修改：`static/app.js`

- [ ] **步骤 1：先编写失败验证**

用浏览器脚本验证当前高亮发送是否仍带有颜色特殊映射。

```text
断言：选中黑色时，highlight_colors[0] 必须为 [0,0,0]
```

- [ ] **步骤 2：删除黑色转白色的高亮映射**

具体改动：

```text
1. 删除 resolveHighlightSyncRgb 之类的特殊映射 helper
2. sendHighlightToESP32() 直接发送 colorData/code 对应的原始 RGB
3. WiFi 发送目标优先使用记住的 targetDeviceUuid
```

- [ ] **步骤 3：运行行为验证**

验证项：

```text
1. 黑色高亮发送值恢复为 [0,0,0]
2. 非黑色发送值保持原样
3. WiFi 模式没有已记住设备时会明确报错
```

- [ ] **步骤 4：提交高亮与设备记忆逻辑**

运行：

```bash
git add static/app.js
git commit -m "fix(高亮同步): 恢复黑色原样发送"
```

### 任务 4：固件移除二维码待机页并统一蓝灯高亮

**文件：**
- 修改：`firmware/src/main.cpp`
- 修改：`firmware/lib/beadcraft-receiver/BeadCraftReceiver.h`
- 修改：`firmware/lib/ble-receiver/BLEImageReceiver.h`

- [ ] **步骤 1：先编写失败验证**

运行固件源码文本检查，验证当前仍包含二维码待机调用与“命中后显示原色”逻辑：

```powershell
rg -n "displayPairingScreen|esp_qrcode|displayColor = match \\? pixel" firmware/src firmware/lib
```

预期：有命中结果

- [ ] **步骤 2：修改待机页**

具体改动：

```text
1. main.cpp 启动后不再构造 pairingUrl
2. 待机页改为调用新的 displayDeviceCodeScreen(deviceCode)
3. 在 BeadCraftReceiver.h 中删除二维码绘制逻辑
4. 新增居中显示序列号的方法
```

- [ ] **步骤 3：修改高亮蓝灯逻辑**

在串口与 BLE 两条显示链路里统一：

```cpp
const uint16_t highlightBlue = 0x001F;
displayColor = match ? highlightBlue : bgColor;
```

- [ ] **步骤 4：运行固件构建验证**

运行：

```bash
pio run
```

预期：固件编译通过

- [ ] **步骤 5：提交固件改造**

运行：

```bash
git add firmware/src/main.cpp firmware/lib/beadcraft-receiver/BeadCraftReceiver.h firmware/lib/ble-receiver/BLEImageReceiver.h
git commit -m "feat(固件): 去二维码并统一蓝灯高亮"
```

### 任务 5：整体联调与发布

**文件：**
- 修改：所有上一任务涉及文件

- [ ] **步骤 1：运行网页验证**

运行：

```bash
d:\Workspace\PixelDoodle-web\.venv\Scripts\python.exe -m py_compile main.py
node --check static/app.js
```

预期：都通过

- [ ] **步骤 2：运行浏览器回归**

验证项：

```text
1. 首页无扫码入口、无串口入口
2. 蓝牙连接成功后 upload-area、状态卡与 WiFi 备选文案正确
3. 黑色高亮发黑色，固件命中后由固件统一显示蓝灯
```

- [ ] **步骤 3：检查工作区**

运行：

```bash
git status --short --branch
git diff --check
```

预期：只有预期变更，无格式错误

- [ ] **步骤 4：合并发布提交**

运行：

```bash
git add .
git commit -m "feat(连接流程): 切换为蓝牙优先无扫码方案"
git push origin main
```
