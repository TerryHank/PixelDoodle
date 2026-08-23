# 万相 CloudBase 接入说明（v12）

## 1. 跨端链路与默认行为

微信小程序、H5 和 Tauri Android 共用两个 CloudBase 云函数及同一份万相任务契约：

```text
前端裁剪参考图
  -> CloudBase 云存储临时输入
  -> submitStyleTransfer 提交 DashScope 异步任务
  -> queryStyleTransfer 轮询并保存结果
  -> 前端下载结果并在本地完成拼豆量化
```

- 微信小程序使用 `Taro.cloud`；H5 使用 `@cloudbase/js-sdk`；Tauri Android 内嵌同一份
  H5，因此也走 Web SDK。万相链路不依赖 FastAPI。
- 图片生成方式默认是“本地像素化”，不会上传图片、调用万相或产生模型费用。
- 只有用户显式选择“万相 · <风格>”后才调用云端。CloudBase 未配置或调用失败时应明确
  报错，不会静默伪装成本地生成成功。

`DASHSCOPE_API_KEY` 只允许存在于两个云函数的环境变量中，禁止写入 `.env`、任何
`TARO_APP_*` 变量、前端代码、H5/小程序/APK 包或 Git。

## 2. H5 与 Tauri Android 配置、构建

复制示例配置并填写 CloudBase 环境：

```powershell
cd D:\Workspace\PixelDoodle\frontend-taro
Copy-Item .env.example .env
```

| 变量 | 要求 |
| --- | --- |
| `TARO_APP_CLOUDBASE_ENV_ID` | H5/Tauri 使用万相时必填 |
| `TARO_APP_CLOUDBASE_REGION` | 必须与环境地域一致；默认 `ap-shanghai` |
| `TARO_APP_CLOUDBASE_ACCESS_KEY` | 可选；只能填 CloudBase Web Publishable Key，且仅用于匿名测试 |

这些值会在构建时进入 H5/APK，均不能作为服务端秘密。修改后必须重新构建。

```powershell
npm ci --legacy-peer-deps
npm run dev:h5
npm run build:h5
npm run apk:tauri:debug
# 配好正式签名后再执行：
npm run apk:tauri:release
```

Tauri 命令会先重建 H5 再嵌入 APK。Android 工具链、产物位置和签名边界见
[`ANDROID_TAURI_BUILD.md`](./ANDROID_TAURI_BUILD.md)。微信小程序使用微信开发者工具选择
CloudBase 环境后执行 `npm run build:weapp`，不读取上述 H5 环境 ID 来替代小程序云环境。

## 3. 云函数契约

函数目录：

- `cloudfunctions/submitStyleTransfer`
- `cloudfunctions/queryStyleTransfer`

提交：

```json
{ "fileID": "cloud://...", "styleIndex": 34 }
```

允许的 `styleIndex`：`0-9`、`14`、`15`、`30-40`。成功返回
`{ "success": true, "status": "PENDING", "taskId": "...", "requestId": "..." }`。

查询：

```json
{ "taskId": "..." }
```

- 处理中：`{ "success": true, "status": "PENDING|RUNNING" }`
- 完成：`{ "success": true, "status": "SUCCEEDED", "fileID": "cloud://...", "mediaType": "image/..." }`
- 失败：`{ "success": false, "status": "FAILED", "code": "...", "message": "..." }`

`requestId` 为可选追踪字段。

## 4. 云端部署与控制台配置

1. 创建独立的开发/测试 CloudBase 环境，启用云函数、云存储和所需登录方式。
2. 在两个函数中分别配置：
   - `DASHSCOPE_API_KEY`：必填，只能配置在云函数环境。
   - `DASHSCOPE_API_BASE_URL`：可选，默认
     `https://dashscope.aliyuncs.com/api/v1`。北京地域业务空间可使用
     `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1`；API Key 必须属于同一地域。
3. 安装并部署两个函数：

   ```powershell
   cd frontend-taro/cloudfunctions/submitStyleTransfer
   npm install --omit=dev
   cd ../queryStyleTransfer
   npm install --omit=dev
   ```

   在微信开发者工具中依次选择“上传并部署：云端安装依赖”。修改函数代码、依赖或环境变量
   后，重新部署对应函数。
4. 在“环境配置 → 安全来源”添加实际来源，填写域名/主机和端口，不带协议或路径：
   - H5 本地开发：`localhost:10086`；若实际使用 IP，再加 `127.0.0.1:10086`。
   - H5 生产：实际部署域名，例如 `app.example.com`。
   - Tauri Android：以真机 `location.origin` 为准；若输出为
     `http://tauri.localhost`，安全来源填写 `tauri.localhost`。不要添加无关域名或全量通配符。

Tauri WebView 仍按 Web SDK 来源校验。若改用 CloudBase“移动应用安全来源”，应分别登记
正式包名 `com.terry.pixeldoodle` 与调试包名 `com.terry.pixeldoodle.debug`，并实现对应的
`appSign/appSecret` 客户端初始化；移动应用凭证不是
`TARO_APP_CLOUDBASE_ACCESS_KEY`，当前 Web SDK 适配器不能混用它。

### 仅用于隔离测试的匿名登录

1. 只在测试环境的“身份认证 → 登录方式”开启匿名登录，并设置低费用额度和告警。
2. `TARO_APP_CLOUDBASE_ACCESS_KEY` 可留空；当前 H5/Tauri 适配器会调用匿名登录。也可填写
   控制台“API Key 配置”生成的 Web Publishable Key；它可出现在浏览器包中，但仍不具备
   生产付费授权能力。
3. 测试期间将两个函数的调用规则限制为已登录身份（`auth != null`），并仅放行测试所需的
   临时存储前缀。不要把函数或存储设为全网匿名公开。
4. 显式选择一个万相风格，完成上传、提交、轮询、下载和本地量化；用 `taskId` / `requestId`
   核对日志。测试结束后关闭匿名登录、恢复生产规则，并从测试构建配置中移除 Publishable Key。

安全来源只校验调用来源，不等于用户鉴权，更不能替代支付和文件归属校验。

## 5. 生产上线阻断项

当前两个云函数只完成模型调用与文件校验，以下边界尚未全部实现；完成前只能用于受控测试：

- **鉴权**：H5/Tauri 接入手机号、邮箱或自有账号等可验证登录；函数调用规则使用
  `auth.loginType != 'ANONYMOUS' && auth != null`，服务端只信任调用上下文中的用户身份。
- **归属**：校验输入文件的环境、路径和所有者；建立“用户 → 应用 jobId → DashScope taskId
  → 输出”的服务端记录。查询只接受应用 jobId，禁止用 taskId 充当访问凭证。
- **支付与额度**：调用模型前原子校验支付/会员权益、余额和单用户额度；失败不得提交任务，
  成功后应有可审计扣费记录和费用告警。
- **限流**：同时配置 CloudBase 函数限频和业务侧用户/IP/设备频率、并发任务上限；对
  `429` 返回明确的可重试时间。
- **幂等**：提交携带幂等键并绑定输入摘要、风格和用户；重试只能创建一次付费任务。终态
  查询必须缓存，不能重复下载和上传同一结果。
- **清理**：输入、失败任务、超时任务和输出均设置服务端 TTL；定时清理孤儿对象，并按隐私
  与业务留存策略删除结果。长期作品应转存到用户私有作品目录。

生产还应限制 `DASHSCOPE_API_BASE_URL` 为官方 HTTPS 域名，统一错误契约和日志脱敏，监控
调用量、失败率、存储量和费用。客户端公开 Key、安全来源或难猜的 `fileID` 均不能替代上述
服务端控制。

## 6. 当前存储与测试边界

- 临时输入：`wanxiang/input/<timestamp>-<random>.<ext>`。
- 生成输出：`wanxiang/output/<taskId>.<jpg|png|bmp|webp>`。
- 前端在提交后尽力删除输入；异常退出仍可能留下孤儿文件。输出不会由前端自动删除。
- 生产目标应改为包含用户和应用 jobId 的私有路径；现有全局路径不满足多用户隔离。

本地契约测试：

```powershell
cd frontend-taro
npm run test:cloudfunctions
```

该命令不会调用真实 DashScope，也不会产生模型费用。本地测试或成功构建不等于云端上线；
最终验收必须在隔离环境完成一次受控真实付费调用、双用户隔离、会话过期、超时恢复、幂等、
限流、费用告警和存储清理验证。

官方参考：[Web SDK 初始化](https://docs.cloudbase.net/en/api-reference/webv3/initialization)、
[安全来源](https://docs.cloudbase.net/envconfig/security/intro)、
[匿名登录](https://docs.cloudbase.net/authentication-v2/method/anonymous)、
[云函数安全规则](https://docs.cloudbase.net/cloud-function/security-rules)。
