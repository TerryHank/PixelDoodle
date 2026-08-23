# PixelDoodle Tauri 2 Android 构建

## 当前交付

- APK：`dist-apk/PixelDoodle-12.0.1-debug-universal.apk`
- 包名：`com.terry.pixeldoodle.debug`
- 版本：`12.0.1`（versionCode `120001`）
- Android：minSdk 24，targetSdk 36
- ABI：`arm64-v8a`、`armeabi-v7a`、`x86`、`x86_64`
- 大小：`97,947,697` 字节
- SHA-256：`2c23cd40c67afb3b538860f966c67c71f1faae5beacdcf95f5c8f7321e019434`
- 签名：Android Debug，APK Signature Scheme v2

这是安装测试包，不是应用商店发布包。

## 一键重建

```powershell
cd D:\Workspace\PixelDoodle\frontend-taro
npm run apk:tauri:debug
```

脚本依次同步 `tauri.conf.json` 中的 Android 版本、完成 Taro H5 构建、四个 Android Rust target 编译、JNI 库复制与调试段裁剪、Gradle universal APK 封装和调试签名。Windows 未开启开发者模式时也不依赖符号链接。

## 已安装工具链

- Node.js 24.14.0 / npm 11.9.0
- Tauri CLI 2.11.4 / Tauri 2.11.5
- Rust 1.98.0；四个 Android target 已安装
- Microsoft OpenJDK 17.0.20.1
- Android SDK API 36 / Build Tools 36.0.0
- Android NDK 29.0.13846066
- Gradle 8.14.3

大型缓存和工具链均放在 `D:\ProgramData`。

## 正式发布边界

正式发布前必须创建并妥善保存自己的 JKS keystore，在 Gradle/Tauri 中配置 release signing；不能使用本次 Android Debug 证书。发布命令入口保留为：

```powershell
npm run apk:tauri:release
```

## 当前运行边界

- APK 内已嵌入 H5、JS 和本地 WASM 资源。
- v12 的万相 CloudBase 适配器仅在微信小程序环境注册；本 APK 不包含可用的万相生图链路。
- H5 的 API 基址目前返回空字符串，云保存、支付、分润等接口仍需接入线上 API 后再做真机验收。
- BLE 的 H5 实现使用 `navigator.bluetooth`，本次没有 Android 原生 BLE 桥接，也没有连接真机验证。
- 本机构建时 `adb devices` 无设备，因此已完成构建、结构和签名验证，未完成真机启动验证。
