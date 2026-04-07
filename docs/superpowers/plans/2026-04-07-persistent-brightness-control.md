# 持久化亮度调节实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为网页端增加实时亮度滑杆，并通过 BLE/WiFi 同步到设备，且设备重启后保持上次亮度。

**架构：** 前端在现有设置弹窗内维护 `brightnessPercent` 状态，拖动滑杆时节流发送到当前连接模式对应的设备链路。固件由 `main.cpp` 统一持有亮度状态与 `Preferences` 持久化，`BLEImageReceiver` 只负责亮度命令解析、通知和 WiFi `/brightness` 接口转发。

**技术栈：** FastAPI、原生前端 JavaScript、ESP32 Arduino、Preferences/NVS、NimBLE

---

### 任务 1：补齐亮度回归测试

**文件：**
- 创建：`firmware/test/test_native/test_brightness_feature.py`
- 测试：`firmware/test/test_native/test_brightness_feature.py`

- [ ] **步骤 1：编写失败的测试**

```python
def test_frontend_exposes_brightness_slider():
    html = INDEX_HTML.read_text(encoding="utf-8")
    self.assertIn('id="brightness-slider"', html)
```

- [ ] **步骤 2：运行测试验证失败**

运行：`d:\Workspace\PixelDoodle-web\.venv\Scripts\python.exe -m unittest firmware.test.test_native.test_brightness_feature -v`
预期：FAIL，提示缺少亮度滑杆、协议常量或固件持久化符号。

- [ ] **步骤 3：补充测试覆盖**

```python
self.assertIn("const BLE_PKT_SET_BRIGHTNESS = 0x09;", app_js)
self.assertIn("@app.post(\"/api/wifi/brightness\")", main_py)
self.assertIn("Preferences", firmware_main)
```

- [ ] **步骤 4：再次运行测试确认仍为红灯**

运行：`d:\Workspace\PixelDoodle-web\.venv\Scripts\python.exe -m unittest firmware.test.test_native.test_brightness_feature -v`
预期：FAIL，且失败原因只剩亮度功能尚未实现。

### 任务 2：前端增加亮度滑杆与 BLE/WiFi 同步逻辑

**文件：**
- 修改：`templates/index.html`
- 修改：`static/app.js`
- 修改：`static/i18n.js`
- 测试：`firmware/test/test_native/test_brightness_feature.py`

- [ ] **步骤 1：在设置弹窗中加入亮度控件**

```html
<div class="form-group">
  <label class="form-label" for="brightness-slider">屏幕亮度：</label>
  <div class="brightness-control">
    <input type="range" id="brightness-slider" min="10" max="100" value="25">
    <span id="brightness-value">25%</span>
  </div>
  <div id="brightness-hint" class="form-hint">请先连接设备后再同步亮度</div>
</div>
```

- [ ] **步骤 2：补充前端状态与换算函数**

```javascript
window.appState.brightnessPercent = 25;
window.appState.deviceBrightnessLoaded = false;
window.appState.brightnessSyncTimer = null;
window.appState.isSyncingBrightness = false;
```

- [ ] **步骤 3：增加 BLE/WiFi 亮度读写方法**

```javascript
const BLE_PKT_SET_BRIGHTNESS = 0x09;
const BLE_PKT_GET_BRIGHTNESS = 0x0A;
const BLE_NTF_BRIGHTNESS = 0x26;
```

- [ ] **步骤 4：在 BLE 连接成功、打开设置和切换到可用 WiFi 设备时读取亮度**

运行路径：

```text
connectBLEDevice() -> syncBrightnessFromCurrentDevice()
showSerialSettings() -> syncBrightnessFromCurrentDevice()
refreshWiFiDevices() -> updateBrightnessAvailability()
```

- [ ] **步骤 5：运行前端语法与测试验证**

运行：

```bash
node --check static/app.js
d:\Workspace\PixelDoodle-web\.venv\Scripts\python.exe -m unittest firmware.test.test_native.test_brightness_feature -v
```

预期：JS 语法通过，亮度测试中的前端断言转绿。

### 任务 3：服务端与固件补齐亮度协议和持久化

**文件：**
- 修改：`main.py`
- 修改：`firmware/src/main.cpp`
- 修改：`firmware/lib/ble-receiver/BLEImageReceiver.h`
- 测试：`firmware/test/test_native/test_brightness_feature.py`

- [ ] **步骤 1：在 FastAPI 中增加 WiFi 亮度转发接口**

```python
@app.get("/api/wifi/brightness")
async def get_wifi_brightness(device_uuid: str = Query(...)):
    ...

@app.post("/api/wifi/brightness")
async def set_wifi_brightness(data: dict):
    ...
```

- [ ] **步骤 2：在 `main.cpp` 中加入亮度状态与 Preferences 持久化**

```cpp
Preferences g_preferences;
uint8_t g_brightness = 64;

uint8_t loadBrightness();
void applyBrightness(uint8_t value, bool persist);
uint8_t getBrightness();
```

- [ ] **步骤 3：在 BLE 接收器中增加亮度命令和通知**

```cpp
#define PKT_SET_BRIGHTNESS 0x09
#define PKT_GET_BRIGHTNESS 0x0A
#define NTF_BRIGHTNESS 0x26
```

- [ ] **步骤 4：在 WiFi 图片服务器中增加 `/brightness` GET/POST**

```text
GET /brightness -> 返回 JSON 当前亮度
POST /brightness -> 读取 1 字节亮度并立即应用
```

- [ ] **步骤 5：运行固件与后端验证**

运行：

```bash
d:\Workspace\PixelDoodle-web\.venv\Scripts\python.exe -m py_compile main.py
cd firmware; ..\.venv\Scripts\python.exe -m platformio run
d:\Workspace\PixelDoodle-web\.venv\Scripts\python.exe -m unittest firmware.test.test_native.test_brightness_feature -v
```

预期：三项全部通过。

### 任务 4：联调整体行为并回归现有链路

**文件：**
- 修改：`templates/index.html`
- 修改：`static/app.js`
- 修改：`static/i18n.js`
- 修改：`main.py`
- 修改：`firmware/src/main.cpp`
- 修改：`firmware/lib/ble-receiver/BLEImageReceiver.h`
- 测试：`firmware/test/test_native/test_brightness_feature.py`
- 测试：`firmware/test/test_native/test_hub75_reference.py`
- 测试：`firmware/test/test_native/test_highlight_regressions.py`

- [ ] **步骤 1：运行 Python 回归**

运行：`d:\Workspace\PixelDoodle-web\.venv\Scripts\python.exe -m unittest firmware.test.test_native.test_hub75_reference firmware.test.test_native.test_highlight_regressions firmware.test.test_native.test_brightness_feature -v`
预期：全部通过。

- [ ] **步骤 2：运行代码检查**

运行：

```bash
d:\Workspace\PixelDoodle-web\.venv\Scripts\python.exe -m py_compile main.py core/serial_export.py core/ble_export.py
node --check static/app.js
git diff --check
```

预期：编译与语法通过，`git diff --check` 无新增空白错误。

- [ ] **步骤 3：运行浏览器联调**

验证：

```text
1. 打开设置后能看到亮度滑杆与百分比
2. 未连接设备时滑杆禁用
3. BLE 已连接时拖动滑杆会立即触发亮度包发送
4. 切到 WiFi 且已有记住设备时，亮度请求走 /api/wifi/brightness
```

- [ ] **步骤 4：必要时重新编译并烧录固件**

运行：`cd firmware; ..\.venv\Scripts\python.exe -m platformio run -t upload --upload-port COM13`
预期：上传成功。
