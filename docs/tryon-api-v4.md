# v0.4 真实换装本机 API

2026-10-21。生产服务复用 `server/tryon-provider.mjs` 的 FASHN v1.6 API / FASHN v1.5 Gradio 适配器，并接入 `server/local-vton.mjs` 的独立 CPU CatVTON 进程。生产 API 没有演示结果、假任务进度或未配置时的假成功回退。当前服务是否配置及本进程是否真实生成成功，以 `/api/capabilities` 为准；安装权重、协议测试通过均不等于画质验收。

## 接口契约

所有接口同源 `/api/`，响应 `Cache-Control: no-store`。错误统一为 `{ "error": { "code": "…", "message": "…" } }`，输入与结果不暴露本机系统路径。时间戳为 Unix 毫秒。

| 方法及路径 | 行为 |
| --- | --- |
| `GET /api/capabilities` | 返回 `tryOn`、`limits`、`privacy`。`configured` 表示配置完整；`verifiedGeneration` 要求本进程实际生成且结果通过结构校验；`available` 还要求上游未报告后续错误。配置完整但尚未验证时可以提交首个真实任务。 |
| `GET /api/tryon/jobs` | 本机未过期任务列表 `{jobs:[…]}`，按创建时间倒序；不返回上传图片。 |
| `POST /api/tryon/jobs` | JSON `{personImage,garmentImage,category,garmentPhotoType}`，两张图均为完整 `data:image/png|jpeg|webp;base64,…`。返回 202 `{job}`。拒绝路径、URL、任意多余字段、其他图片类型。 |
| `GET /api/tryon/jobs/:id` | 返回 `{job}`，真实状态为 `queued / running / succeeded / failed / cancelled`，`stage` 与 `message` 记录真实适配器阶段，不合成百分比。 |
| `GET /api/tryon/jobs/:id/result` | 仅成功任务返回经过结构校验的图片；`?download=1` 为附件下载，支持 HEAD。 |
| `DELETE /api/tryon/jobs/:id` | 活动任务停止本机等待并删除本机输入；结束任务删除本机结果。返回 `{deleted:true,cancelled,remoteMayContinue}`，后续查询 404。无法保证上游已开始的生成停止或退款，响应不声称已远程取消。 |

`category`: `tops / bottoms / one-pieces`；通用 `garmentPhotoType`: `flat-lay / model`，受 provider 的 `tryOn.garmentPhotoTypes` 限制。本机 CatVTON 当前仅公开 `['flat-lay']` 并拒绝模特商品图，支持平铺或白底商品图。默认上衣和平铺图。当前适配器不支持鞋履、饰品和化妆品的生成式替换，前端不得将这些类别映射为服装生成成功。

成功 `job.result` 为 `{url,mimeType,generated:true,width,height,provider}`。其余状态没有结果字段。输入文件删除完成后才发布终结状态。`queuePosition`、`estimatedSeconds` 仅在上游实际提供有限数值时出现；不代表承诺完成时间。

主要错误：503 `NOT_CONFIGURED`、429 `BUSY` / `STORAGE_LIMIT`、400 `INVALID_IMAGE` / `INVALID_CATEGORY` / `INVALID_REQUEST`、413 `BODY_TOO_LARGE`、415 `INVALID_CONTENT_TYPE`、409 `RESULT_NOT_READY`、404 `NOT_FOUND` / `RESULT_MISSING`。上游额度或认证错误作为失败任务错误保留，绝不会用本地改色结果替代。

## 云端告知与配置

前端在生成按钮附近直接展示 `/api/capabilities.privacy.notice`，用户点击生成即发送两张当前选中的图片。无需重复确认或勾选。是否上传远程由服务器实际配置决定，用户请求不能注入上游地址。默认未配置时，不发起网络请求。

服务器启动时读取本机 `runtime/config.json`，环境变量优先于对应配置字段。配置和密钥不通过 HTTP 暴露；没有远程写配置接口。修改配置后重启服务。示例只包含空占位，不含真实密钥：

```json
{
  "tryOn": {
    "provider": "fashn-api",
    "fashnApiKey": ""
  }
}
```

本地或自有 FASHN v1.5 Gradio 服务：

```json
{
  "tryOn": {
    "provider": "gradio",
    "gradioUrl": "http://127.0.0.1:7860",
    "hfToken": ""
  }
}
```

对应变量为 `TRYON_PROVIDER`、`FASHN_API_KEY`、`TRYON_GRADIO_URL`、`TRYON_HF_TOKEN`。远程 Gradio 只允许 HTTPS，本机地址可为 HTTP。接口必须兼容现有 FASHN v1.5 的 8 输入 `try_on`；任意 Gradio 应用并不能自动成为换装后端。公开演示 GPU 额度并非生产服务保障。参考 [FASHN 官方仓库](https://github.com/fashn-AI/fashn-vton-1.5) 与现有 `docs/ai-provider-research-v2.md` 的已核查协议和额度记录。

## 本机 CPU CatVTON 接入

已准备 `runtime/config.local-cpu.example.json`；它只是示例，服务只读取 `runtime/config.json`，不会自动启用或启动推理。从项目目录启动服务时，示例中的相对路径有效；也可使用服务器管理员配置的绝对路径。

```json
{
  "tryOn": {
    "provider": "local-catvton",
    "localPython": "runtime/vton-v4/.venv/Scripts/python.exe",
    "localScript": "scripts/vton-v4/infer.py",
    "localModelDir": "runtime/vton-v4/models"
  },
  "motion": { "provider": "disabled", "enabled": false }
}
```

对应变量为 `TRYON_LOCAL_PYTHON`、`TRYON_LOCAL_SCRIPT`、`TRYON_LOCAL_MODEL_DIR`。配置文件不会发送浏览器，路径不能由生成请求覆写。依赖、runner 和模型清单齐全后，能力可报告 `configured:true`；`verifiedGeneration` 与 `available` 仍等待本进程首个真实且有效的输出。配置只在服务启动时读取。

当前 runner 用 PyTorch CPU **FP32** 执行 CatVTON，默认 384 × 512、24 步、4 线程、guidance 2.5，逐阶段加载服装解析、VAE、UNet 与内容检查器。缓存中部分文件名称包含 fp16，但加载后的计算精度由 runner 决定。默认蒙版已改为 FASHN 18 类服装解析，上衣采用 `vitonhd-16k-512` attention；OpenVINO 分割仅保留为备选，不能把此实现描述为完整 OpenVINO 换装推理。人物工作图最长边 1280，商品最长边 1600；裁出服装附近区域生成，再按蒙版合回人物图。正式 HTTP 调用不保存诊断图。上衣 CLI 的 24 步真实样片见 `test-results/vton-v4/quality-semantic-24/`；正式 API/UI 验收另行记录。

步骤只由实际推理上报，API 通过 `progress:{current,total,unit:'step'}` 公开；`elapsedMs` 表示真实经过时间。加载模型期间可能尚无步数，步数结束后还需解码与结果检查；不提供虚构百分比或固定 ETA。最长执行预算 30 分钟，不代表每次都能完成或达到商品细节质量。该研究模型保留上游非商业许可限制。

本机错误仅返回服务器定义的业务码与固定中文文案；文件系统路径、任意 runner 消息、自定义 abort reason 和未知错误码均不外显。`LOCAL_IO_ERROR` 表示本机文件读写失败，`LOCAL_MEMORY_EXHAUSTED` 表示进程报告内存不足，`LOCAL_TIMEOUT` 表示运行超时；这些失败不返回替代图片。

## 限制与数据清理

- 每图最多 12 MiB，两图总请求体约 32 MiB；JSON 接口不接收压缩请求体。尺寸至少 32 × 32，长边最多 16384，总面积最多 4000 万像素。
- 仅接受 PNG / JPEG / 静态 WebP。校验魔数与 MIME 一致性、PNG chunk CRC / 完整结束、JPEG 尺寸 / 标记 / 结束、WebP RIFF 长度 / chunk 边界 / 尺寸；拒绝动画和伪装 SVG。这是有界容器与结构校验，**不是完整像素解码器**；压缩内容最终仍需由模型解码器接受。服务器不会执行图片内容。
- 全服务最多一个正在上传或生成的任务，不自动重试可能计费的请求。最多保留 20 个任务；满额明确要求删除历史结果，不悄悄删除用户尚未导出的结果。
- 输入在任务结束后立即删除。一般活动任务按 15 分钟预算清理；本机 CatVTON 活动任务跟随适配器公开的 `maxDurationMs`，当前为 30 分钟，避免 CPU 推理被通用清理窗口提前中断。实际预算通过 `limits.activeSourceTtlMsByProvider` 返回；孤立结果文件仍按 15 分钟清理。结果最多保留 24 小时；清理每分钟运行，并在启动及列表请求时检查。崩溃重启后将未完成任务标记为中断并删除输入，不重新上传或重复计费。30 分钟是运行上限，不是耗时或效果保证。
- 文件被系统占用或权限阻止时，输入清理失败明确报告 `INPUT_CLEANUP_FAILED` 并继续尝试；删除失败报告 `DELETE_FAILED`，不会错误返回 `deleted:true`。保留时间目标依赖本机文件系统允许清理。
- `runtime/tryon-jobs/<uuid>` 保存任务元数据和短暂输入；`runtime/tryon-results/<uuid>.<ext>` 保存结果。所有删除路径先验证并限制在对应运行目录。启动恢复只接受 UUID 目录；路径不来自用户请求。
- `/api/` 要求本机 Host 与同源 Origin，拒绝跨站请求和 DNS rebinding Host，不放行 CORS。服务仅绑定 127.0.0.1。`runtime/` 不属于静态服务根目录，也应保持在 Git 忽略范围。
- 静态服务继续支持 Three.js、MediaPipe WASM / task、glTF、图片与缓存文件，并补充 MP4/WebM MIME 和单 Range 请求，避免视频回放和拖动回归。

## 验证

`node --test tests/tryon-api.test.mjs`：8 项通过。加入本机进程边界与自带动作视频套件后，本轮 `npm test` 共 49 项通过。覆盖未配置零上传、容器和像素上限、同源与 Host 拒绝、任务状态/单并发/源删除/结果下载删除、取消与远程可能继续语义、上游额度失败、无效结果不能标记 verified、配置保密/环境覆盖、过期与崩溃恢复清理、静态视频 Range。

成功分支使用明确隔离的协议 fixture，验证 HTTP 与存储生命周期，**不是真实 AI 效果验证**。生产 `scripts/serve.mjs` 默认工厂固定为真实适配器，没有选择 fixture 的环境变量或 API 字段。

早期隔离服务 5179 的未配置检查记录保存在 `test-results/tryon-api-v4/local-service-check.json`，这是未接本机模型时的历史状态。2026-10-21 后续用真实本机资产、无密钥、临时 runtime 且不提交任务核查：CatVTON `configured:true / available:false / verifiedGeneration:false`，平铺图限制及 30 分钟预算准确；custom TPS 入口配置完成时同样保持未生成验证状态。5179 已关闭。随后 5176 的真实界面/API 生成已通过，报告 `test-results/generation-v4/real-production/real-generation-report.json` 记录无 mock、0 浏览器异常、换衣 254.458 秒、动作 67.073 秒、刷新恢复、下载一致、24 帧视频播放到结尾及 Range 通过。这是指定样例的一次流程实测，不能外推多用户画质。
