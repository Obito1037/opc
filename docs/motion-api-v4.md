# v0.4 动作生成适配器与任务接口

本模块连接真实图生视频服务或本地 TPS 运行器，不把二维运镜、驱动视频本身或测试 fixture 当作生成结果。当前没有 FASHN 密钥，云端尚未完成真实生成验证；本地 TPS 首个技术样本已跑出 MP4，但视觉评审不合格，因此未擅自启用或写入已验证动作预设。

## 官方云端协议

2026-10-21 核查 [FASHN Image to Video 官方文档](https://docs.fashn.ai/api-reference/image-to-video)：使用通用 `/v1/run` 的 `model_name: image-to-video`，图片可为 data URI。适配器固定提交一次 `duration:5`、`resolution:480p`，随后查询同一任务状态；不自动重试付费提交。按核查时文档，此规格费用为 1 credit；输入至少 301 × 301。动作指导只用简短 prompt，官方说明不能精确保证运动，因此“挥手”等预设是请求意图而非动作一致性保证。该服务标记为 Experimental。

默认关闭。即使有共享 FASHN key，也必须显式设置：

```json
{
  "tryOn": {"provider": "fashn-api", "fashnApiKey": ""},
  "motion": {"provider": "fashn-api", "enabled": true}
}
```

也可由服务器环境 `MOTION_PROVIDER=fashn-api`、`MOTION_ENABLED=true`、`FASHN_API_KEY` 配置。空 key 仍不可用。配置只在本机读取，前端不能修改配置、传 key 或指定任意上游 URL。真实生成按钮旁显示一次费用与图片外发告知；点击按钮提交，取消本机等待不能保证停止远程任务或退款。

视频只允许来自官方示例采用的精确域名 `cdn.fashn.ai`、HTTPS / 443、固定结果路径形状 `/任务id/output_N.mp4`。拒绝凭据、其他主机、私网/回环/链路本地 DNS 解析、重定向。下载将校验后的公网 IP 固定进 TLS lookup，证书仍匹配 CDN 域名；不把 API key 发送给 CDN。下载使用独立直连请求以保留 IP 固定，不继承系统代理；网络阻止直连时明确失败，不降级为任意代理 URL。最多 80 MiB，需通过 MP4 容器结构、视频尺寸和时长检查后才发布结果。浏览器负责实际视频解码。

## 本机 TPS

`server/local-motion.mjs` 通过无 shell 的 `spawn` 调用可信本机 Python。默认路径：

- `runtime/motion-v4/.venv/Scripts/python.exe`
- `scripts/motion-v4/infer.py`
- `runtime/motion-v4/presets.json`

可用 `motion.localPython / localScript / drivingManifest` 或对应 `MOTION_LOCAL_PYTHON / MOTION_LOCAL_SCRIPT / MOTION_DRIVING_MANIFEST` 设置；客户端不能设置执行程序、模型、驱动文件或命令行。只有 manifest 自身和预设均标记 `verified:true`，对应模型、配置、驱动存在，运行器存在并显式启用，才公开预设。标记由实际质量验收后写入，不根据“程序退出 0”自动生成。

```json
{
  "version": 1,
  "verified": true,
  "presets": {
    "tai-chi": {
      "file": "绝对或相对此清单的驱动文件路径",
      "verified": true,
      "label": "太极动作",
      "maxFrames": 16,
      "fps": 8,
      "motionStrength": 0.25,
      "startSeconds": 0.5,
      "mode": "relative",
      "sourceFit": "contain"
    }
  }
}
```

上例只是 schema，**不是已合格预设**。可选 `checkpoint / upstream` 也只来自服务端清单。未提供时使用本项目的 TaiChi 权重和官方结构；不同动作不能复用同一驱动并伪装成不同结果。当前 TPS 输出为 256 × 256，时长取决于真实帧数与 fps；不会套用云端“5 秒 / 480p”标签。

可信预设的可选 `motionStrength` 必须是有限数值，范围为 0.05–1。省略时为 1；显式给出 null、字符串、无穷大或越界值时，该预设不会发布，避免无效参数意外变成满幅动作。参数通过 `--motion-strength` 传给 runner，HTTP 用户不能覆盖。顶层清单与每个条目的 `verified` 都必须严格为 true，数组或异常清单不能启用研究预设；这里仅描述后端契约，没有新增已验收动作。

`motion.presetSpecs[name]` 提供 `{duration:maxFrames/fps,fps,resolution:'256p',motionStrength}`，界面可按所选预设读取规格。custom 仍固定 `{duration:3,fps:8,resolution:'256p',motionStrength:0.25}`，可信清单不能覆盖这个保留名称。是否具备默认动作仍取决于真实质量验收与显式配置。

运行器逐行 JSON 阶段和真实帧计数可用于 UI。进程内 PyAV 编码，不派生 ffmpeg；取消时终止 Python，并额外删除同 UUID 的 `.partial.mp4`，避免 Windows 强制终止跳过 Python 清理。单个本地任务最长 12 分钟，仍受共享任务源过期约束。

## API 增量

`GET /api/capabilities` 新增 `motion`：`configured / available / verifiedGeneration / busy / enabled / kind / name / remote / paid / presets / presetLabels? / acceptsPersonImage / acceptsDrivingVideo / duration / fps / resolution / experimental / drivingVideoLimits / notice / message`。`presets` 是字符串数组，前端仅展示当前返回的项；研究预设未通过质量门槛时不发布。自带视频单独就绪时仅返回 `['custom']`，`acceptsDrivingVideo:true`、`experimental:true`、`duration:3`、`fps:8`、`resolution:'256p'`。`available` 仍要求本进程实际成功且输出校验通过，完整配置不冒充已验证。

- `POST /api/motion/jobs`：云端 `{sourceJobId:成功试穿任务id,motion:预设}`；本地 TPS 还可用 `{personImage:图片dataURI,motion:预设}`，两种源择一。
- 自带视频的同一路径接受 `{personImage:图片dataURI,motion:'custom',drivingVideo:视频dataURI}`，也可把 `personImage` 换成成功的 `sourceJobId`。只有 custom 接受 `drivingVideo`；不接受 URL、系统路径和额外命令参数。
- `GET /api/motion/jobs`：只列动作任务。`GET /api/tryon/jobs` 继续只列换衣任务。
- `GET /api/motion/jobs/:id`：同现有任务 schema，新增 `kind:'motion'`、`motion`、`sourceJobId`、`hasDrivingVideo`。运行中可有 `stage:'validating_driver' / 'normalizing_driver'`。有真实计数才给 `progress:{current,total,unit:'frame'|'step'}`，没有伪百分比。
- 成功 `result` 为本机 MP4 URL、实际 `width / height / durationSeconds`；视频 GET / HEAD 支持单 Range 和 `?download=1`。
- `DELETE /api/motion/jobs/:id`：取消等待或删除结果；本地/云端的 `remoteMayContinue` 如实区分。

原图源会复制进动作任务目录，结束后删除；删除先前试穿任务不会在运行中突然改变动作输入。自带驱动保存为同一任务中的 `driving.mp4 / driving.webm`，与人物图一起清理，列表与状态只返回是否存在驱动的布尔值，不公开上传文件。已过期/删除的源拒绝为 `410 SOURCE_EXPIRED`；未完成源拒绝 `409 SOURCE_NOT_READY`。换衣和动作共享全局一个生成槽，不同时抢 CPU，也不并行提交多个计费请求。原有大小、同源/Host、存储/清理限制继续适用。

## 自带动作视频（实验）

custom 由用户上传自己的驱动片段，不借用尚未通过质量验收的研究预设，也不把上传视频原样当作结果。服务器需显式设置 `motion.acceptsDrivingVideo:true`、`motion.enabled:true`、`motion.provider:'local-tps'`，并备齐 Python、runner、checkpoint 与官方模型结构，才公开入口。`runtime/config.custom-motion.example.json` 是未启用示例；服务只读取 `runtime/config.json`，本次未自动写入配置或开启服务。

新增配置映射为 `MOTION_ACCEPTS_DRIVING_VIDEO`、`MOTION_LOCAL_CHECKPOINT`、`MOTION_LOCAL_UPSTREAM`；后两项对应 `motion.localCheckpoint / localUpstream`，默认使用项目已有 TaiChi 权重及官方源码。所有路径来自服务器配置，客户端只能发送数据 URI。

`drivingVideoLimits` 公开 `maxBytes / minDurationSeconds / maxDurationSeconds / minDimension / maxLongEdge / maxShortEdge / minFps / maxFps / maxFrames / acceptedMimeTypes`。输入限 `data:video/mp4;base64,…` 或 `data:video/webm;base64,…`，至多 12 MiB，3–15 秒，最短边至少 128、最长边最多 1920、另一边最多 1080、8–60fps / 至多 900 帧。前端只预检体积、时长与尺寸，fps 由服务器检查。

Node 检查严格 base64、容器类型和有界结构。runner 在导入 torch 之前用 PyAV 完整解码检查帧数、帧率、时长、尺寸、像素比例和 SDR 编码，拒绝坏视频、多个视频轨、HDR、完全静止片段与外部引用，再去除音轨、保持比例整理为 256 × 256 驱动。像素变化检查不等于识别了人体动作。custom 固定 `24 帧 / 8fps / 约 3 秒 / motion-strength 0.25 / relative / contain`，只选真实帧，不复制凑时长，建议录制 4–6 秒。完整细节见 [Python 用户视频契约](motion-user-driver-v4.md)。

结果仍是小幅正面体态实验，可能有衣物、手臂或鞋部形变，不能保证走秀、挥手或转身效果。`configured:true` 只表示运行条件与入口就绪；`verifiedGeneration` 等待本进程真实有效的输出，结构有效也不代表画质通过。

临时驱动仅使用结果 UUID 派生的 `<uuid>.driver.mp4`、`<uuid>.driver.partial.mp4`，不另存首帧人物图。成功、失败和取消都删除它们与 `.partial.mp4`；清理失败报告固定错误，不发布成功。重启后原始上传立即清理，超过 15 分钟的 UUID 临时文件回收。

## 验证范围

`tests/motion-provider.test.mjs` 8 项覆盖显式启用门槛、一次提交、固定规格、无重试、CDN 防护、驱动预设、任务链、Range 和删除。新增 `tests/driving-motion.test.mjs` 10 项覆盖自带视频类型/大小/尺寸门槛、显式配置、固定 CLI 参数、越界路径拒绝、真实轻量子进程取消、全部临时文件删除、HTTP 生命周期、重启回收，以及实际 MP4/WebM 的完整解码。真实媒体探测返回 `torchImported:false`，没有加载神经模型。本轮完整 `npm test` **49 / 49 通过，0 跳过**。

后续预设契约新增 3 项：下界/上界/默认幅度与规格、异常幅度及伪验证清单拒绝、轻量子进程实际收到已审核参数。两份动作套件现为 **21 / 21 通过，0 跳过**。测试使用明确的协议 fixture，未启用运行清单或加载模型；默认动作的实片验收由另行记录提供。

云端成功分支使用明确的协议 fixture，验证调用契约，**没有云端付费生成，也没有真实 FASHN 动作成果**。另对 TPS 真推理文件 `test-results/motion-v4/tps-taichi-16.mp4` 做结构校验，得到 256 × 256、2 秒、35845 字节；证据 `test-results/motion-api-v4/real-mp4-validation.json` 明确该样本视觉不合格。容器通过不等于观感通过，更不等于比赛作品完成。

本地 CatVTON 工厂也已接入：`TRYON_PROVIDER=local-catvton` 时才加载 `server/local-vton.mjs` 的 `createLocalVtonProvider({env,inputRoot,outputRoot})`，支持 async。`tryOn.localPython / localScript / localModelDir` 映射到对应 `TRYON_LOCAL_*` 变量。它仍按真实 provider 状态区分环境就绪和实际生成成功。
