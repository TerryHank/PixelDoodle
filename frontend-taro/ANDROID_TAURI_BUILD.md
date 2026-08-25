# PixelDoodle Tauri 2 Android 构建

## 当前交付

- APK：`dist-apk/DIY-Pindou-14.0.4-debug-universal.apk`
- 包名：`com.terry.pixeldoodle.debug`
- 应用名称：`DIY拼豆`
- 版本：`14.0.4`（versionCode `140004`）
- Android：minSdk 24，targetSdk 36
- ABI：`arm64-v8a`、`armeabi-v7a`、`x86`、`x86_64`
- 大小：`116,841,742` 字节
- SHA-256：`47AF5B21DC379A7E2189817BBC1C8FDFEC50EA2FBCC8BD08E0B1BD102E9B7836`
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
- 像素图纸导入包含操作指引、选图、网格位置/单格大小微调、裁剪、本地识别进度、结果和色号校对；照片导入直接本地量化。两者都不再显示“高精度/快速”选择。
- 颜色套餐、六种钉板和照片配色直接平铺。豆子数量直接决定分辨率，固定结果画框不随钉板切换改变；导入图片按原图比例居中并保留白边，不强制裁方或拉伸。
- 色号校对支持格子滑选、页内全选、全选、取消选择、反选、批量替换色号和删除，完成后进入编辑器。
- Android 普通与自适应启动图标已替换为 UI 切图中的蓝/粉双兔角色图标。
- 万相 CloudBase Web SDK 适配器源码仍保留，但本期已移除入口和运行时初始化，不会调用云端。
  将来恢复前必须配置 `TARO_APP_CLOUDBASE_*`，并完成
  云函数、安全来源和登录规则部署。详见
  [`WANXIANG_CLOUDBASE.md`](./WANXIANG_CLOUDBASE.md)。
- 云保存、支付、分润等接口仍需接入线上 API 后再做真机验收。
- BLE 的 H5 实现使用 `navigator.bluetooth`，本次没有 Android 原生 BLE 桥接，也没有连接真机验证。
- 本机构建时 `adb devices` 无设备，因此已完成构建、结构和签名验证，未完成真机启动验证。
