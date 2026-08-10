# PixelDoodle Taro RN Android 扩展实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在保留当前 `H5 + 微信小程序` 版本的前提下，为 `frontend-taro/` 新增 `Taro React Native -> Android` 产线，使项目可以被 Android Studio 打开调试，并具备 APK 构建能力。

**架构：** 继续以 `frontend-taro/` 作为唯一前端工程，新增 `rn` 构建配置、`android/` 原生工程和 `src/adapters/*/rn.ts` 端适配层。页面层、状态层、服务层尽量复用现有实现，首轮优先打通 Android 工程、首页、图片生成、导出与 APK 主链路，再逐步补齐 BLE / 扫码等 RN 原生能力。

**技术栈：** Taro React Native、React 18、TypeScript、Sass、Zustand、React Native Android、Gradle、Android Studio

---

## 文件结构

### 新建文件

- `frontend-taro/config/rn.ts`：RN 端构建配置。
- `frontend-taro/rn-cli.config.js`：RN CLI 与 Android 工程协同配置。
- `frontend-taro/babel.config.js`：补充 RN 所需 Babel 配置（如需调整）。
- `frontend-taro/metro.config.js`：Metro 打包配置。
- `frontend-taro/index.js`：RN 入口。
- `frontend-taro/src/adapters/ble/rn.ts`：RN 端 BLE 适配器。
- `frontend-taro/src/adapters/scan/rn.ts`：RN 端扫码适配器。
- `frontend-taro/src/adapters/file/rn.ts`：RN 端文件保存适配器。
- `frontend-taro/src/adapters/__tests__/rn-adapter-selection.test.ts`：适配器分发测试。
- `frontend-taro/src/utils/__tests__/rn-env.test.ts`：RN 环境辅助测试。
- `frontend-taro/android/`：Android 原生工程目录及其 Gradle 文件。
- `docs/superpowers/plans/2026-04-01-taro-rn-android-extension.md`：当前实现计划。

### 修改文件

- `frontend-taro/package.json`：新增 RN 依赖与脚本。
- `frontend-taro/package-lock.json`：依赖锁文件。
- `frontend-taro/config/index.ts`：加入 RN 端配置合并。
- `frontend-taro/src/adapters/ble/index.ts`：增加 `rn` 端分发。
- `frontend-taro/src/adapters/scan/index.ts`：增加 `rn` 端分发。
- `frontend-taro/src/adapters/file/index.ts`：增加 `rn` 端分发。
- `frontend-taro/src/pages/home/index.tsx`：对 RN 端进行最小兼容处理与显式降级提示。
- `frontend-taro/src/components/pair-sheet/index.tsx`：RN 端能力差异提示。
- `frontend-taro/src/components/settings-sheet/index.tsx`：RN 端导出/发送按钮的兼容处理。
- `frontend-taro/src/services/env.ts`：识别 RN 端环境与 API 基础地址。
- `README.md`：新增 RN Android 开发、Android Studio 与 APK 构建说明。
- `.gitignore`：新增 Android / RN 构建缓存忽略项。

### 测试文件

- `frontend-taro/src/adapters/__tests__/rn-adapter-selection.test.ts`
- `frontend-taro/src/utils/__tests__/rn-env.test.ts`

---

### 任务 1：为 `frontend-taro` 补齐 RN 构建脚本与基础配置

**文件：**
- 修改：`frontend-taro/package.json`
- 修改：`frontend-taro/package-lock.json`
- 修改：`frontend-taro/config/index.ts`
- 创建：`frontend-taro/config/rn.ts`
- 创建：`frontend-taro/index.js`

- [ ] **步骤 1：编写 RN 环境辅助失败测试**

```ts
// frontend-taro/src/utils/__tests__/rn-env.test.ts
import { describe, expect, it } from 'vitest'
import { isRnEnv } from '../rn-env'

describe('rn env utils', () => {
  it('detects rn environment', () => {
    expect(isRnEnv('rn')).toBe(true)
  })

  it('rejects h5 environment', () => {
    expect(isRnEnv('h5')).toBe(false)
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npm run test -- src/utils/__tests__/rn-env.test.ts`

预期：失败，提示 `../rn-env` 或 `isRnEnv` 尚未实现。

- [ ] **步骤 3：补充 `package.json` 的 RN 脚本与依赖**

在 `frontend-taro/package.json` 中新增脚本：

```json
{
  "scripts": {
    "dev:rn": "taro build --type rn --watch",
    "build:rn": "taro build --type rn"
  }
}
```

并补充 RN 相关依赖：

```json
{
  "dependencies": {
    "react-native": "^0.73.1",
    "react-native-device-info": "^14.0.0",
    "react-native-root-siblings": "^5.0.1",
    "react-native-safe-area-context": "4.8.2",
    "react-native-gesture-handler": "~2.14.0",
    "react-native-screens": "~3.29.0"
  },
  "devDependencies": {
    "@react-native/metro-config": "0.73.2"
  }
}
```

要求：

- 依赖版本必须与 `Taro 4.1.11` 的 peer 约束对齐。
- 不提前加入依赖 `frontend-taro/android/` 已存在的脚本。

- [ ] **步骤 4：新增 RN 配置与入口**

```ts
// frontend-taro/config/rn.ts
export default {
  sourceRoot: 'src',
  outputRoot: 'dist-rn'
}
```

```js
// frontend-taro/index.js
import { AppRegistry } from 'react-native'
import App from './src/app'

AppRegistry.registerComponent('PixelDoodle', () => App)
```

并在 `frontend-taro/config/index.ts` 中合并 `rn.ts`：

```ts
import rnConfig from './rn'

// 在 baseConfig 中增加
rn: {
  appName: 'PixelDoodle'
}

// merge 时带入 rnConfig
return merge({}, baseConfig, devConfig, rnConfig)
```

- [ ] **步骤 5：实现最小 RN 环境辅助工具**

```ts
// frontend-taro/src/utils/rn-env.ts
export function isRnEnv(env?: string) {
  return env === 'rn'
}
```

- [ ] **步骤 6：安装依赖并更新锁文件**

运行：`npm install`

预期：`package-lock.json` 更新，RN 相关依赖安装完成。

- [ ] **步骤 7：运行测试验证通过**

运行：`npm run test -- src/utils/__tests__/rn-env.test.ts`

预期：2 个测试通过。

- [ ] **步骤 8：验证 RN 构建命令可解析**

运行：`npm run build:rn`

预期：Taro 能识别 `rn` 目标；若仍缺少后续原生工程，会报告后续缺口，但不应再报未知脚本或未知端类型错误。

- [ ] **步骤 9：验证依赖树处于可接受状态**

运行：`npm ls react-native-root-siblings react-native-device-info react-native-gesture-handler react-native-safe-area-context react-native-screens --depth=0`

预期：以上依赖可正常解析，且版本落在 `Taro 4.1.11` peer 允许范围内。

- [ ] **步骤 10：Commit**

```bash
git add frontend-taro/package.json frontend-taro/package-lock.json frontend-taro/config/index.ts frontend-taro/config/rn.ts frontend-taro/index.js frontend-taro/src/utils
git commit -m "feat(RN基础): 初始化 Taro React Native 构建配置"
```

### 任务 2：生成 Android 原生工程并补齐 RN CLI / Metro 配置

**文件：**
- 创建：`frontend-taro/rn-cli.config.js`
- 创建：`frontend-taro/metro.config.js`
- 修改：`frontend-taro/babel.config.js`
- 创建：`frontend-taro/android/` 下 Gradle 工程文件
- 修改：`frontend-taro/package.json`
- 修改：`frontend-taro/package-lock.json`
- 修改：`.gitignore`

- [ ] **步骤 1：创建 RN 适配选择失败测试**

```ts
// frontend-taro/src/adapters/__tests__/rn-adapter-selection.test.ts
import { describe, expect, it } from 'vitest'
import { resolveAdapterRuntime } from '../runtime'

describe('adapter runtime selection', () => {
  it('returns rn when env is rn', () => {
    expect(resolveAdapterRuntime('rn')).toBe('rn')
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npm run test -- src/adapters/__tests__/rn-adapter-selection.test.ts`

预期：失败，提示 `../runtime` 或 `resolveAdapterRuntime` 未实现。

- [ ] **步骤 3：补齐 RN CLI / Metro 基础文件**

```js
// frontend-taro/rn-cli.config.js
module.exports = {
  project: {
    android: {}
  }
}
```

```js
// frontend-taro/metro.config.js
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config')

module.exports = mergeConfig(getDefaultConfig(__dirname), {})
```

必要时调整 `babel.config.js`：

```js
module.exports = {
  presets: ['babel-preset-taro', '@react-native/babel-preset']
}
```

并在此任务中补齐 Android 相关脚本：

```json
{
  "scripts": {
    "android": "react-native run-android",
    "apk:debug": "cd android && gradlew assembleDebug",
    "apk:release": "cd android && gradlew assembleRelease"
  }
}
```

- [ ] **步骤 4：生成 Android 原生工程**

运行适合当前 Taro / RN 版本的工程初始化命令，目标是在 `frontend-taro/android/` 下得到可识别的 Android 工程。

最小验证文件包括：

```text
frontend-taro/android/build.gradle
frontend-taro/android/settings.gradle
frontend-taro/android/app/build.gradle
frontend-taro/android/gradlew
```

- [ ] **步骤 5：实现适配器运行时辅助工具**

```ts
// frontend-taro/src/adapters/runtime.ts
export function resolveAdapterRuntime(env?: string) {
  return env === 'rn' ? 'rn' : env === 'weapp' ? 'weapp' : 'h5'
}
```

- [ ] **步骤 6：更新 `.gitignore`**

加入 Android / RN 缓存忽略：

```gitignore
frontend-taro/android/.gradle/
frontend-taro/android/app/build/
frontend-taro/dist-rn/
frontend-taro/.metro/
```

- [ ] **步骤 7：运行测试验证通过**

运行：`npm run test -- src/adapters/__tests__/rn-adapter-selection.test.ts`

预期：测试通过。

- [ ] **步骤 8：验证 Android 工程目录存在**

运行：`Get-ChildItem frontend-taro\\android`

预期：能看到 `app/`、`gradlew`、`settings.gradle` 等原生工程文件。

- [ ] **步骤 9：Commit**

```bash
git add frontend-taro/package.json frontend-taro/package-lock.json frontend-taro/rn-cli.config.js frontend-taro/metro.config.js frontend-taro/babel.config.js frontend-taro/android .gitignore frontend-taro/src/adapters/runtime.ts frontend-taro/src/adapters/__tests__/rn-adapter-selection.test.ts
git commit -m "feat(Android工程): 生成 RN Android 原生工程与打包基础"
```

### 任务 3：补齐 RN 端环境分发与服务层兼容

**文件：**
- 修改：`frontend-taro/src/services/env.ts`
- 修改：`frontend-taro/src/adapters/ble/index.ts`
- 修改：`frontend-taro/src/adapters/scan/index.ts`
- 修改：`frontend-taro/src/adapters/file/index.ts`
- 创建：`frontend-taro/src/adapters/ble/rn.ts`
- 创建：`frontend-taro/src/adapters/scan/rn.ts`
- 创建：`frontend-taro/src/adapters/file/rn.ts`

- [ ] **步骤 1：编写 RN 环境 API 基址失败测试**

```ts
// frontend-taro/src/utils/__tests__/rn-env.test.ts
import { describe, expect, it } from 'vitest'
import { getApiBaseUrlByEnv } from '@/services/env'

describe('rn api base url', () => {
  it('returns explicit rn base url', () => {
    expect(getApiBaseUrlByEnv('rn', 'http://10.0.2.2:8765')).toBe('http://10.0.2.2:8765')
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npm run test -- src/utils/__tests__/rn-env.test.ts`

预期：失败，提示 `getApiBaseUrlByEnv` 未实现。

- [ ] **步骤 3：扩展服务环境判断**

```ts
// frontend-taro/src/services/env.ts
export function getApiBaseUrlByEnv(env?: string, explicit?: string) {
  if (env === 'rn') {
    return explicit || process.env.TARO_APP_API_BASE_URL || 'http://10.0.2.2:8765'
  }
  if (env === 'h5') {
    return ''
  }
  return process.env.TARO_APP_API_BASE_URL || ''
}

export function getApiBaseUrl() {
  return getApiBaseUrlByEnv(process.env.TARO_ENV, process.env.TARO_APP_API_BASE_URL)
}
```

- [ ] **步骤 4：补齐三类 RN 适配器骨架**

```ts
// frontend-taro/src/adapters/ble/rn.ts
import type { BleAdapter } from './types'

export const rnBleAdapter: BleAdapter = {
  async connectTargetDevice() {
    throw new Error('RN Android 端 BLE 适配尚未完成，请先使用手输 UUID 与非 BLE 链路验证')
  },
  async sendImage() {
    throw new Error('RN Android 端 BLE 发送尚未完成')
  },
  async sendHighlight() {
    throw new Error('RN Android 端 BLE 高亮尚未完成')
  },
  async scanWifiNetworks() {
    throw new Error('RN Android 端 WiFi 扫描尚未完成')
  },
  async connectWifiNetwork() {
    throw new Error('RN Android 端 WiFi 配网尚未完成')
  }
}
```

```ts
// frontend-taro/src/adapters/scan/rn.ts
export async function scanDevice() {
  throw new Error('RN Android 端扫码尚未完成，请先手动输入 UUID')
}
```

```ts
// frontend-taro/src/adapters/file/rn.ts
export async function saveBinaryFile() {
  throw new Error('RN Android 端文件保存尚未完成')
}
```

- [ ] **步骤 5：修改适配器入口分发**

```ts
// frontend-taro/src/adapters/ble/index.ts
import { resolveAdapterRuntime } from '@/adapters/runtime'
import { rnBleAdapter } from './rn'

const runtime = resolveAdapterRuntime(process.env.TARO_ENV)
export const bleAdapter =
  runtime === 'rn' ? rnBleAdapter : runtime === 'weapp' ? weappBleAdapter : h5BleAdapter
```

`scan/index.ts`、`file/index.ts` 同理。

- [ ] **步骤 6：运行测试验证通过**

运行：`npm run test -- src/utils/__tests__/rn-env.test.ts`

预期：通过。

- [ ] **步骤 7：验证现有双端构建不被破坏**

运行：`npm run build:h5`

预期：构建通过，允许保留既有体积告警。

运行：`npm run build:weapp`

预期：构建通过。

- [ ] **步骤 8：Commit**

```bash
git add frontend-taro/src/services/env.ts frontend-taro/src/adapters/ble frontend-taro/src/adapters/scan frontend-taro/src/adapters/file frontend-taro/src/utils/__tests__/rn-env.test.ts
git commit -m "feat(RN适配层): 接入 Android 端环境分发与基础骨架"
```

### 任务 4：让首页、配对弹层和设置弹层在 RN Android 可运行

**文件：**
- 修改：`frontend-taro/src/pages/home/index.tsx`
- 修改：`frontend-taro/src/components/pair-sheet/index.tsx`
- 修改：`frontend-taro/src/components/settings-sheet/index.tsx`
- 修改：`frontend-taro/src/components/toast-host/index.tsx`

- [ ] **步骤 1：编写 RN 页面可见性失败测试**

```ts
// frontend-taro/src/pages/home/__tests__/view-model.test.ts
it('shows rn capability hint in rn env', () => {
  const vm = buildHomeViewModel({ pixelMatrix: [], targetDeviceUuid: '', env: 'rn', colorSummaryCount: 0 })
  expect(vm.showRnCapabilityHint).toBe(true)
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npm run test -- src/pages/home/__tests__/view-model.test.ts`

预期：失败，提示 `showRnCapabilityHint` 未定义。

- [ ] **步骤 3：扩展首页视图模型**

```ts
// frontend-taro/src/pages/home/view-model.ts
export function buildHomeViewModel(input: {
  pixelMatrix: unknown[]
  targetDeviceUuid: string
  colorSummaryCount?: number
  env?: string
}) {
  return {
    showUploadGuide: input.pixelMatrix.length === 0,
    showDeviceChip: Boolean(input.targetDeviceUuid),
    showExampleGallery: true,
    showColorPanel: (input.colorSummaryCount || 0) > 0,
    showRnCapabilityHint: input.env === 'rn'
  }
}
```

- [ ] **步骤 4：在页面层增加 RN 显式提示与降级逻辑**

```tsx
// frontend-taro/src/pages/home/index.tsx
const env = process.env.TARO_ENV

{vm.showRnCapabilityHint ? (
  <View className='home-page__rn-hint'>
    Android 端已启用 RN 工程；BLE、扫码与文件保存能力将逐步补齐。
  </View>
) : null}
```

在配对弹层中：

```tsx
{process.env.TARO_ENV === 'rn' ? (
  <View className='pair-sheet__hint'>RN Android 端当前请优先手动输入 UUID。</View>
) : null}
```

在设置弹层中，对尚未接通的导出保存明确提示失败原因，而不是静默无响应。

- [ ] **步骤 5：运行测试验证通过**

运行：`npm run test -- src/pages/home/__tests__/view-model.test.ts`

预期：通过。

- [ ] **步骤 6：手工验证 RN 页面启动最小可用**

运行：`npm run dev:rn`

预期：RN 构建监听可启动，且首页代码不因 `window` / `document` / Web Bluetooth 之类浏览器 API 直接崩溃。

- [ ] **步骤 7：Commit**

```bash
git add frontend-taro/src/pages/home frontend-taro/src/components/pair-sheet frontend-taro/src/components/settings-sheet frontend-taro/src/components/toast-host
git commit -m "feat(RN页面): 接入 Android 端首页与能力降级提示"
```

### 任务 5：打通 Android Studio 打开与 Debug 运行链路

**文件：**
- 检查：`frontend-taro/android/settings.gradle`
- 检查：`frontend-taro/android/app/build.gradle`
- 检查：`frontend-taro/android/gradle.properties`
- 可能修改：上述 Android 工程配置文件

- [ ] **步骤 1：验证 Android 工程基础文件存在**

运行：`Get-ChildItem frontend-taro\\android -Recurse | Select-Object -First 40`

预期：至少包含 `settings.gradle`、`build.gradle`、`app/build.gradle`、`gradlew`。

- [ ] **步骤 2：补齐 Android 工程最小参数**

如缺失，则在 `app/build.gradle` 中确认：

```gradle
android {
    compileSdkVersion 34
    defaultConfig {
        applicationId "com.pixeldoodle"
        minSdkVersion 24
        targetSdkVersion 34
        versionCode 52641
        versionName "5.26.41"
    }
}
```

要求：

- `applicationId` 固定且明确
- `versionName` 与当前 App 版本一致

- [ ] **步骤 3：验证 Android Studio 可识别的项目结构**

运行：检查以下文件：

```text
frontend-taro/android/settings.gradle
frontend-taro/android/app/src/main/AndroidManifest.xml
frontend-taro/android/app/src/main/java/.../MainActivity.*
frontend-taro/android/app/src/main/java/.../MainApplication.*
```

预期：原生入口类存在。

- [ ] **步骤 4：在文档中记录 Android Studio 打开路径**

在 `README.md` 预留说明：

```md
Android Studio 打开路径：`frontend-taro/android`
```

- [ ] **步骤 5：验证 Debug 构建命令**

运行：`npm run apk:debug`

预期：
- 如果本机已安装 JDK / Android SDK，则生成 `debug APK`
- 如果本机未安装，则应暴露明确的环境错误，而不是脚本路径错误

- [ ] **步骤 6：Commit**

```bash
git add frontend-taro/android README.md
git commit -m "feat(Android调试): 打通 Android Studio 打开与 Debug 构建链路"
```

### 任务 6：打通 Release APK 产线并补齐文档

**文件：**
- 修改：`frontend-taro/android/app/build.gradle`
- 修改：`frontend-taro/android/gradle.properties`
- 修改：`README.md`

- [ ] **步骤 1：补齐 release 构建配置**

在 `frontend-taro/android/app/build.gradle` 中确认或补充：

```gradle
buildTypes {
    debug {
        signingConfig signingConfigs.debug
    }
    release {
        minifyEnabled false
        signingConfig signingConfigs.debug
        proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro"
    }
}
```

首轮允许使用 `debug` 签名完成 release 构建验证，后续再替换为正式签名。

- [ ] **步骤 2：验证 release 构建命令**

运行：`npm run apk:release`

预期：
- 若环境齐全，生成 `release APK`
- 若环境缺失，错误信息明确定位到 JDK / SDK / Gradle 前提

- [ ] **步骤 3：在 README 中补充 RN Android 使用说明**

追加以下内容：

```md
## Taro RN Android 开发

```bash
cd frontend-taro
npm install
npm run dev:rn
```

Android Studio 打开目录：

```text
frontend-taro/android
```

APK 构建：

```bash
npm run apk:debug
npm run apk:release
```
```

并明确写出环境前提：

- JDK
- Android SDK
- `adb`
- Android Studio

- [ ] **步骤 4：执行完整验证**

运行：`npm run test`

预期：全部测试通过。

运行：`npm run build:h5`

预期：通过，允许既有体积告警。

运行：`npm run build:weapp`

预期：通过。

运行：`npm run build:rn`

预期：RN 构建命令可执行，至少进入正确构建阶段。

- [ ] **步骤 5：Commit**

```bash
git add frontend-taro/android frontend-taro/package.json frontend-taro/package-lock.json README.md
git commit -m "feat(APK产线): 完成 RN Android 出包链路与文档说明"
```

### 任务 7：收尾验证与发布标记

**文件：**
- 检查：`frontend-taro/package.json`
- 检查：`frontend-taro/src/pages/home/index.tsx`
- 检查：`README.md`

- [ ] **步骤 1：确认 App 版本位保持一致**

检查以下文件：

```text
frontend-taro/package.json
frontend-taro/src/pages/home/index.tsx
frontend-taro/android/app/build.gradle
```

要求：

- `frontend-taro/package.json` 为 `5.26.41`
- 首页角标显示 `v5.26.41`
- Android `versionName` 为 `5.26.41`

- [ ] **步骤 2：确认现有双端产线仍可用**

运行：`npm run build:h5`

运行：`npm run build:weapp`

预期：均成功。

- [ ] **步骤 3：确认 Android 目录已纳入版本控制**

运行：`git ls-files frontend-taro/android`

预期：能看到 Android 工程关键文件已进入索引。

- [ ] **步骤 4：如需要，创建 Android 发布标签**

若本轮完成真实 Android 产线接入，可创建如 `app-v5.26.41` 的注释标签。

```bash
git tag -a app-v5.26.41 -m "Android app version 5.26.41"
```

- [ ] **步骤 5：最终提交**

```bash
git add frontend-taro README.md
git commit -m "refactor(RN扩展): 完成 Android 工程接入与 APK 产线"
```
