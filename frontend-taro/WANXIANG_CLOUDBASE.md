# 万相 CloudBase 接入说明（v12）

## 1. 范围与边界

本链路仅供微信小程序调用 DashScope `wanx-style-repaint-v1`：

```text
小程序上传参考图
  -> submitStyleTransfer 提交异步任务
  -> queryStyleTransfer 轮询任务
  -> 云存储结果 fileID
  -> 小程序下载并继续本地拼豆量化
```

`DASHSCOPE_API_KEY` 只允许存在于 CloudBase 云函数环境变量中，禁止写入前端代码、
小程序包、配置文件或 Git。Android/Tauri 不使用这条链路；v12.0.1 Android 调试 APK
只是现有 H5/Tauri 功能的测试包，不包含可用的万相生图能力。

## 2. 云函数契约

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

## 3. 部署顺序

1. 在微信 CloudBase 创建或选择环境，并启用云函数和云存储。
2. 分别为两个云函数配置环境变量：
   - `DASHSCOPE_API_KEY`：必填。
   - `DASHSCOPE_API_BASE_URL`：可选，默认
     `https://dashscope.aliyuncs.com/api/v1`。
     阿里云当前建议北京地域使用业务空间专属地址
     `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1`；配置时替换实际
     `WorkspaceId`，且 API Key 必须属于同一地域。
3. 安装两个函数的生产依赖：

   ```powershell
   cd frontend-taro/cloudfunctions/submitStyleTransfer
   npm install --omit=dev
   cd ../queryStyleTransfer
   npm install --omit=dev
   ```

4. 在微信开发者工具中打开 `frontend-taro`，选择步骤 1 的 CloudBase 环境。
5. 依次右键 `submitStyleTransfer`、`queryStyleTransfer`，选择“上传并部署：云端安装依赖”。
6. 构建并打开小程序：

   ```powershell
   cd frontend-taro
   npm run build:weapp
   ```

7. 用一张非敏感测试图完成一次提交、轮询、结果下载和本地量化；在 CloudBase 日志中用
   `taskId` / `requestId` 核对调用。

环境变量必须同时配置到两个函数。修改函数代码或依赖后，应重新上传对应函数。

## 4. 云存储规则

- 临时输入：`wanxiang/input/<timestamp>-<random>.<ext>`。
- 生成输出：`wanxiang/output/<taskId>.<jpg|png|bmp|webp>`。
- 小程序在提交完成后立即尽力删除输入对象；异常退出仍可能留下孤儿文件。
- 输出对象由业务侧管理，前端不会自动删除。

建议每天清理超过 24 小时的孤儿输入；输出按隐私和业务留存策略清理，例如保留 7 天。
需要长期保存的作品应转存到用户私有云作品目录，不能把万相临时目录当永久素材库。

当前两个函数只完成模型调用契约，尚未实现 OPENID/会员或支付授权、输入对象归属校验与
单用户配额。公开发布前必须限制函数仅由微信小程序调用，并在服务端完成上述授权和限流；
否则任何可调用函数的用户都可能触发计费。云存储也必须改为私有读写规则，不能依赖
`fileID` 难以猜测来替代权限控制。

## 5. 测试

在 `frontend-taro` 执行：

```powershell
npm run test:cloudfunctions
```

该命令只运行云函数的本地 Node 测试，不会调用真实 DashScope，也不会产生模型费用。

## 6. 上线验收边界

提交代码不等于云端已部署。本地测试通过也只证明参数校验、供应商请求和返回契约；在未配置
真实 CloudBase 环境与 `DASHSCOPE_API_KEY`、未完成一次真实付费调用前，不能宣称万相链路
已上线。生产验收还必须覆盖权限规则、文件大小、超时与轮询、失败重试、并发配额、费用告警、
日志脱敏和存储清理。
