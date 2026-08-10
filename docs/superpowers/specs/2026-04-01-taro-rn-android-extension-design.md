# PixelDoodle Taro RN Android 扩展设计

## 1. 背景

当前 `PixelDoodle` 已完成以下前端重构成果：

- 新前端主线位于 `frontend-taro/`。
- 已支持 `H5 + 微信小程序`。
- 当前外显版本已提升到 `v5.26.41`。
- 页面结构、图像生成、BLE 发送、WiFi 配网和导出链路已在现有双端范围内打通。

用户新增目标是在**保留当前版本和现有双端产线**的前提下，为同一套 Taro 工程补充 `React Native -> Android` 能力，使其满足以下要求：

- Android 工程可以运行起来。
- Android 工程可以被 Android Studio 打开并调试。
- 项目最终可以产出 APK。

这意味着本次不是新建第二套 App 前端，而是在既有 `frontend-taro/` 中新增一条 `RN Android` 产线。

## 2. 目标

- 保留当前 `H5 + 微信小程序` 版本，不回退、不替换、不拆分为第二套前端工程。
- 在 `frontend-taro/` 中新增 `RN` 构建能力。
- 生成真实的 Android 原生工程目录，用于 Android Studio 打开与调试。
- 形成可执行的 Android 打包链路，支持调试包和发布包构建。
- 尽量复用已有页面层、状态层、服务层与样式资产。
- 将新的端差异收敛在适配层和 RN 专属配置中，避免污染现有 `H5` / `微信小程序` 代码路径。

## 3. 非目标

- 不废弃 `H5` 与 `微信小程序` 构建脚本。
- 不创建独立的 `frontend-taro-rn/` 第二工程。
- 不在本阶段重写现有页面结构。
- 不要求首轮 `RN Android` 端所有能力都与 `H5` / `微信小程序` 100% 对齐。
- 不在本阶段同时覆盖 iOS。

## 4. 范围边界

### 4.1 保留范围

- `frontend-taro/` 继续作为唯一前端主工程。
- 当前版本 `v5.26.41` 保留并继续演进。
- 现有 `H5` 与 `微信小程序` 构建链路保持可用。
- 现有 `FastAPI` 和 `firmware` 协议边界保持不变。

### 4.2 新增范围

- `RN` 构建脚本和依赖。
- `android/` 原生工程。
- `RN` 端适配器实现。
- Android Studio 调试入口。
- APK 构建命令和文档说明。

## 5. 总体方案

本次采用 **Taro React Native 集成模式**，在现有 `frontend-taro/` 内新增 `RN Android` 产线。

该方案的基本思路如下：

1. 继续保留现有 `src/pages`、`src/components`、`src/store`、`src/services`。
2. 在 `config` 中扩展 `rn` 端配置。
3. 在 `package.json` 中先新增 `dev:rn`、`build:rn`。
4. 在 `src/adapters` 下新增 `rn.ts` 实现，承接 BLE、扫码和文件保存的端差异。
5. 在 `frontend-taro/android/` 下生成 Android 原生工程。
6. 后续通过 Android Studio 或 Gradle 构建 `debug/release APK`。

## 6. 目录设计

推荐目录结构如下：

```text
frontend-taro/
├─ android/                     # 新增，Android 原生工程
├─ config/
│  ├─ index.ts
│  ├─ dev.ts
│  ├─ prod.ts
│  └─ rn.ts                     # 新增，RN 端配置
├─ src/
│  ├─ adapters/
│  │  ├─ ble/
│  │  │  ├─ h5.ts
│  │  │  ├─ weapp.ts
│  │  │  └─ rn.ts               # 新增
│  │  ├─ scan/
│  │  │  ├─ h5.ts
│  │  │  ├─ weapp.ts
│  │  │  └─ rn.ts               # 新增
│  │  └─ file/
│  │     ├─ h5.ts
│  │     ├─ weapp.ts
│  │     └─ rn.ts               # 新增
│  ├─ components/
│  ├─ pages/
│  ├─ services/
│  ├─ store/
│  └─ utils/
├─ package.json
└─ ...
```

原则如下：

- 页面层和状态层尽量不拆。
- 新端差异优先进入 `adapters/*/rn.ts`。
- Android 原生目录固定在 `frontend-taro/android/`，避免在仓库根目录额外扩散。

## 7. 构建与脚本设计

### 7.1 保留脚本

- `dev:h5`
- `build:h5`
- `dev:weapp`
- `build:weapp`
- `test`

### 7.2 新增脚本

脚本分两阶段引入。

第一阶段先补 RN 构建脚本：

```json
{
  "scripts": {
    "dev:rn": "taro build --type rn --watch",
    "build:rn": "taro build --type rn"
  }
}
```

说明：

- `build:rn` 负责生成 RN 侧 JS bundle 和工程依赖产物。

第二阶段在 `frontend-taro/android/` 原生工程生成后，再补：

```json
{
  "scripts": {
    "android": "react-native run-android",
    "apk:debug": "cd android && gradlew assembleDebug",
    "apk:release": "cd android && gradlew assembleRelease"
  }
}
```

- `android` 用于本地调试运行。
- `apk:debug` 与 `apk:release` 用于明确出包路径。

### 7.3 RN 依赖基线

RN 依赖版本必须与 `Taro 4.1.11` 的 peer 约束保持一致，避免靠 `--legacy-peer-deps` 强行落地一个不稳定组合。

推荐以以下基线为准：

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

说明：

- 不以 `0.74.x` 作为首轮基线。
- 如需补齐更完整的 RN peer，优先按照 Taro RN 当前 peer 依赖对齐。
- Android 工程生成前，不提前引入依赖于 `android/` 目录存在的脚本验证。

## 8. 代码分层设计

### 8.1 复用层

以下层尽量直接复用：

- `pages`
- `components`
- `store`
- `services`
- 与后端接口相关的 `utils`

### 8.2 新增 RN 端适配层

#### BLE 适配

新增 `src/adapters/ble/rn.ts`，用于承接 Android BLE 能力。

职责：

- 连接目标设备
- 写入图像数据
- 写入高亮数据
- 扫描 WiFi 热点

要求：

- 保持与现有 `BleAdapter` 接口一致
- 页面层不能感知 `RN` 与其他端的实现差异

#### 扫码适配

新增 `src/adapters/scan/rn.ts`。

职责：

- 调起 Android 扫码
- 返回与现有 `scanAdapter` 一致的 UUID 结果

首轮允许降级：

- 如原生扫码库接入时间过长，可先保留手输 UUID 入口
- 但工程结构中必须预留 `scan/rn.ts`

#### 文件适配

新增 `src/adapters/file/rn.ts`。

职责：

- 处理 RN 端导出文件保存
- 区分图片、PDF、JSON 等不同保存逻辑

原则：

- 继续复用服务端导出产物
- 不在前端重写导出格式生成逻辑

## 9. Android 工程目标

### 9.1 工程形态

`frontend-taro/android/` 中必须具备可被 Android Studio 直接识别的 Gradle 工程。

最低完成态：

- 可以在 Android Studio 中导入
- 可以同步 Gradle
- 可以运行 `debug` 构建
- 可以执行 `assembleRelease`

### 9.2 调试目标

当本机满足 Android 环境前提时，开发流程应为：

1. 启动 Metro / RN 构建监听
2. 启动 Android 模拟器或连接真机
3. 在 Android Studio 中运行 App
4. 页面可以进入首页并完成基础交互验证

### 9.3 出包目标

构建产物至少包括：

- `debug APK`
- `release APK`

路径以 Android Gradle 默认输出目录为准。

## 10. 能力分阶段策略

### 10.1 第一阶段必须完成

- `RN Android` 工程可生成
- Android Studio 可打开
- 首页 UI 可以启动
- 示例图与图片生成链路可运行
- 与 FastAPI 的生成、导出、WiFi 接口可联通
- 可生成 APK

### 10.2 第一阶段允许降级

- BLE 原生接入未完成时，可先保留接口层和显式提示
- 扫码原生接入未完成时，可先用手输 UUID 兜底
- 文件保存可先保证下载/缓存成功，再逐步优化交互

### 10.3 第二阶段再追平

- BLE 图像发送
- BLE 高亮
- WiFi 热点扫描
- 原生扫码
- Android 端导出体验优化

## 11. 环境前提

Android 链路要真正跑通并产出 APK，机器必须具备以下前提：

- JDK
- Android SDK
- `adb`
- Gradle 构建环境
- Android Studio

本机检查结果显示，当前环境尚未发现：

- `java`
- `adb`
- Android SDK 路径
- Android Studio 可执行入口

因此需要明确区分两层结果：

1. **代码结果**
   - RN Android 工程接入完成
   - 项目结构和脚本具备调试与出包能力

2. **环境结果**
   - 只有在本机补齐 Android 工具链后，才能完成真实 APK 构建验证

该限制属于环境前提，不属于前端代码设计缺陷。

## 12. 风险与约束

### 12.1 范围风险

如果首轮要求同时追平 BLE、扫码、WiFi、文件保存的 RN 原生体验，复杂度会显著上升，并影响 APK 主链路交付。

### 12.2 技术风险

- RN 侧原生库与当前 Taro 版本的兼容性
- Android Gradle、JDK 与本机环境版本匹配
- BLE 与扫码原生能力接入成本

### 12.3 约束

- 不允许为了接入 Android 而破坏现有 `H5` / `微信小程序` 构建
- 不允许新建第二套页面逻辑
- 不允许跳过 Android Studio 可打开这一要求，只做“理论上能打包”

## 13. 验证标准

### 13.1 代码验证

- `H5` 构建仍通过
- `微信小程序` 构建仍通过
- `RN` 构建命令可执行
- `android/` 工程存在且结构完整

### 13.2 Android 验证

在环境满足时，必须验证：

1. Android Studio 成功打开 `frontend-taro/android/`
2. Gradle 同步通过
3. Debug 安装运行成功
4. `assembleDebug` 成功
5. `assembleRelease` 成功
6. APK 产物路径可定位

### 13.3 业务验证

首轮至少验证以下业务：

1. 首页正常渲染
2. 示例图生成
3. 图片上传生成
4. 导出请求成功
5. WiFi 接口链路可调用

## 14. 实施建议

建议按以下顺序实施：

1. 为 `frontend-taro` 增加 `RN` 依赖和脚本。
2. 增加 `rn` 端配置并确认 `build:rn` 可执行。
3. 依照 Taro RN peer 约束校准依赖版本。
4. 生成 `android/` 原生工程。
5. 补 `RN` 端适配器骨架。
6. 优先保证首页、图片生成和导出链路在 Android 可运行。
7. 打通 Android Studio 调试。
8. 打通 `debug/release APK` 构建。
9. 第二阶段再继续补 BLE / 扫码 / WiFi 体验追平。

## 15. 结论

本次扩展采用 **在 `frontend-taro/` 内新增 Taro React Native Android 产线** 的方案。

该方案满足以下关键要求：

- 保留当前 `v5.26.41` 和既有双端版本
- 不拆第二套前端工程
- 让 Android Studio 有真实原生工程可打开
- 最终形成可产出 APK 的链路

该方案的核心取舍是：

- 先打通 `RN Android 工程 + Android Studio + APK` 主链路
- 再逐步追平 BLE、扫码与文件保存等原生能力

这比一次性要求所有端能力完全等价更稳妥，也更符合当前项目的迭代目标。
