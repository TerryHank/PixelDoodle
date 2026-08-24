# PixelDoodle Tauri 2 Android 构建

## 当前交付

- APK：`dist-apk/PixelDoodle-13.0.0-debug-universal.apk`
- 包名：`com.terry.pixeldoodle.debug`
- 版本：`13.0.0`（versionCode `130000`）
- Android：minSdk 24，targetSdk 36
- ABI：`arm64-v8a`、`armeabi-v7a`、`x86`、`x86_64`
- 大小：`117,317,446` 字节
- SHA-256：`e651fce0c3ae976ccc7f12494f0239f4d7e099d634aec4f24fbe662b10804584`
- 签名：Android Debug，APK Signature Scheme v2

这是安装测试包，不是应用商店发布包。

## 一键重建

```powershell
cd D:\Workspace\PixelDoodle\frontend-taro
npm run apk:tauri:debug
```

脚本依次同步 `tauri.conf.json` 中的 Android 版本，在独立 `dist-h5-apk` 目录完成 Taro H5
构建，刷新 Tauri Android 插件 Gradle 配置，完成四个 Android Rust target 编译、JNI 库复制
与调试段裁剪、Gradle universal APK 封装和调试签名。Windows 未开启开发者模式时也不依赖
符号链接，其他进程占用普通 `dist-h5` 时仍可打包。

## 已安装工具链

- Node.js 24.14.0 / npm 11.9.0
- Tauri CLI 2.11.4 / Tauri 2.11.5
- Rust 1.98.0；四个 Android target 已安装
- Microsoft OpenJDK 17.0.20.1
- Android SDK API 36 / Build Tools 36.1.0
- Android NDK 29.0.13846066
- Gradle 8.14.3

大型缓存和工具链均放在 `D:\ProgramData`。

## 正式发布边界

正式发布前必须创建并妥善保存自己的 JKS keystore，在 Gradle/Tauri 中配置 release signing；不能使用本次 Android Debug 证书。发布命令入口保留为：

```powershell
npm run apk:tauri:release
```

## 当前运行边界

- APK 内已嵌入 V13 H5、JS、本地 WASM 和 1,200 条离线素材；完整母库共 64,268 条，
  同源素材 API 可用时优先使用完整在线库，不可用时自动切到离线库。
- PNG、PDF、JSON 导出已接入 Tauri 官方 dialog/fs 插件；Android 会打开系统“另存为”并在
  用户选择位置后写入，不再依赖 WebView 的 `<a download>`。
- 万相 CloudBase Web SDK 适配器仍保留；默认为本地像素化，只有显式选择万相风格才调用云端。
  本期按要求暂不部署或验收 CloudBase。将来启用前必须配置 `TARO_APP_CLOUDBASE_*`，并完成
  云函数、安全来源和登录规则部署。详见
  [`WANXIANG_CLOUDBASE.md`](./WANXIANG_CLOUDBASE.md)。
- 云保存、支付、分润等接口仍需接入线上 API 后再做真机验收。
- BLE 的 H5 实现使用 `navigator.bluetooth`，本次没有 Android 原生 BLE 桥接，也没有连接真机验证。
- 本机构建时 `adb devices` 无设备，因此已完成构建、结构和签名验证，未完成真机启动验证。
