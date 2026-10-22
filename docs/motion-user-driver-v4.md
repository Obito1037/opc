# v0.4 用户自带动作视频：本地推理契约与验证

用户可提供自己拍摄或有使用权的动作视频，作为本人照片的驱动；产品不需要再分发第三方研究驱动。这个输入方式解决示例素材来源问题，**不自动证明人物身份一致、动作质量或服装真实性**。当前目标是固定镜头、正面全身、小幅重心或轻抬臂，不能宣称走秀或背面衣服还原。

本文件覆盖本地 Python 适配。HTTP/UI 由其他模块接入，不能把本文件的建议当作其已通过端到端验收。

## 已实现的 Python 行为

- `scripts/motion-v4/infer.py` 新增 `--validate-only` 和 `--normalize-driving`；原有 CLI 保留。
- `scripts/motion-v4/driver_media.py` 只依赖 PyAV、Pillow 和标准库，不导入 Torch。
- 校验实际 MP4 文件头或 WebM EBML `DocType=webm`，不相信扩展名；拒绝伪装成 WebM 的一般 MKV。
- 输入限制：12 MiB、15秒、最短边至少128、长边至多1920、短边至多1080、至多2,073,600像素、60fps、900解码帧。输出8fps时输入至少8fps，不能靠重复帧补足。
- MP4支持 H.264/H.265，WebM支持 VP8/VP9；只允许一个视频流，输入音轨不进入输出；HDR/非方形像素暂不接受。
- 通过 Python 本地文件对象提供输入，禁用 MOV 外部引用；没有任意 URL、播放列表或远程视频下载路径。
- 完整解码原视频再加载模型，拒绝损坏、截断、重复/倒序时间戳、严重跳帧、尺寸/旋转中途变化和工作量超限。
- 按真实帧时间采样24帧，不补重复帧。持续至少3秒，建议录制4–6秒；边缘不足一帧的文件可能需再多录一小段。
- 应用实际 `DISPLAYMATRIX` 0/90/180度旋转，并保比例缩放到256×256。填边色取第一采样帧角点，整个片段保持同色，避免填边本身闪动。
- 抽样帧存在至少极小像素变化才接受完全静止视频之外的输入；这个检查不能区分人体动作、镜头移动或光照变化，不能视为动作识别。
- 输出为无声H.264/MP4，256×256，24帧，8fps，3秒。用户路径固定 `--motion-strength 0.25`，每一帧仍经过学习到的关键点、稠密运动与神经修复网络。
- 第一帧预览应在浏览器本地完成；Python不写人像预览PNG。只有显式研究 `--diagnostics` 会保存对照拼图，正常API不要传该标志。

旋转实现参考 [PyAV VideoStream 源码](https://github.com/PyAV-Org/PyAV/blob/main/av/video/stream.py)；实际已用本机PyAV18.1.0生成带90度显示矩阵的MP4并验证方向处理，未仅依赖文档推断。

## Node 调用

纯视频校验（不需要图片、输出、模型文件）：

```powershell
& './runtime/motion-v4/.venv/Scripts/python.exe' -u scripts/motion-v4/infer.py `
  --validate-only --driving-video '<受控任务目录中的用户视频>' --max-frames 24 --fps 8
```

完成事件：`status=completed`、`stage=validated_driver`、`driver={...}`、`torchImported=false`。`driver.personIdentityVerified` 与 `driver.qualityVerified` 明确为false。校验通过不是模型生成成功，不能据此设置 `verifiedGeneration=true`。

真实生成：

```powershell
& './runtime/motion-v4/.venv/Scripts/python.exe' -u scripts/motion-v4/infer.py `
  --source-image '<受控人物图>' --driving-video '<受控用户视频>' --output '<UUID>.mp4' `
  --normalize-driving --max-frames 24 --fps 8 --motion-strength 0.25 --threads 4
```

标准化会先发送 `validating_driver` / `normalizing_driver` running事件，然后才import Torch。坏视频的失败事件包含 `errorCode=INVALID_DRIVING_VIDEO`；其他模型错误仍为 `LOCAL_GENERATION_FAILED`。stderr只作为本机诊断，不应原样回传文件路径或异常栈。

所有由本任务派生的临时文件规则：

| 最终输出 | 临时文件 |
| --- | --- |
| `<UUID>.mp4` | `<UUID>.partial.mp4` |
| 标准化中间驱动 | `<UUID>.driver.mp4`、`<UUID>.driver.partial.mp4` |

正常完成/可捕获异常在finally清理标准化文件。Windows强杀时Node应清理这三个同UUID临时文件，并按原任务TTL清理上传源。Python不创建外部ffmpeg子进程，也不创建额外随机目录。

## 已完成的纯媒体测试

`scripts/motion-v4/test-driver-media.py` 生成3.333秒、192×320、12fps的非人物移动色块，测试MP4和WebM真实编解码、24帧采样、无音轨、纵横比例、90度显示矩阵，以及坏头/截断/过短/超15秒/静止/低fps拒绝。共10项检查通过，`torchImported=false`。这些是媒体协议测试素材，不能冒充真实人物或模型结果。

文件位于 `test-results/motion-v4/user-driver-contract/`，其中 `portrait.mp4`、`portrait.webm` 可供Node校验层使用，`report.json`保存真实结果。9项的早期报告已被扩展为10项；每次重跑只覆盖这些专用fixture。

## 24帧真实推理与播放检查

实际跑过完整标准化 → 神经推理 → MP4再解码流程：源图为项目AI示例 `studio-model-v2.png`，驱动仍为仅本地研究的TaiChi视频（不同人），稳定起点0.5秒，强度0.25。这不是用户本人视频验收。

- 24帧、8fps、3秒，报告总耗时66.623秒、推理59.790秒、峰值RSS908.27MiB。
- 校验+标准化0.140秒；该轮完成后标准化临时视频已清理。
- 24个解码帧都不同；相邻帧全图MAE均值1.01/255、最大3.34/255。
- 人工ROI的局部梯度匹配估计：末帧相对首帧，脸和上衣约向右2px/向上3px，腿区域约向右3px/向上6px。它只是像素位移估计，不是人体姿态或服装物理测量。
- 首帧与送入模型的256²原图全图MAE1.32/255，脸ROI2.28/255。原图/首帧放大目视未见明显换脸式重绘；后续脸部变软，不能声称身份准确率或无细节损失。
- 两侧背景首末帧MAE约1.43与1.45/255，未见明显背景被整体拖动；这个简单背景结果不能代表复杂用户场景。
- Edge真实连续播放3.005秒达到ended，解码24帧、取得22次videoFrameCallback，浏览器报告丢1帧。共享机器短样本不能宣称零丢帧或普遍流畅；8fps仍是较低帧率。

结果与证据前缀：`test-results/motion-v4/tps-user-pipeline-quarter-24`，包含 `.mp4`、`.contact.png`、`.report.json`、`.identity-review.png`、`.visual-metrics.json`、`.playback.json`、`.playback.png`。后续静止/跳帧检查增加后，纯媒体契约已重跑；上述24帧模型结果没有被改写。

检查脚本 `inspect-result.py`（不加载模型）和 `test-playback.mjs`（独立临时localhost服务与短时Edge，结束后关闭）均可复现。

## 同人真实动作研究例已执行

资源窗口释放后，源图改为同一真实驱动在0.5秒的帧，驱动也从0.5秒开始，完成24帧、8fps、3秒、强度0.25的完整标准化与神经推理。文件前缀 `test-results/motion-v4/tps-same-person-quarter-24`，保留MP4、报告、拼图、原图/脸部比较、像素变化与实际Edge播放证据。

- 总65.373秒，推理58.519秒，峰值RSS907.69MiB；标准化/完整解码0.133秒。
- 24个解码帧都不同；首帧原图全图MAE0.831/255、脸ROI1.327/255；两侧背景首末帧MAE0.459/0.404。
- 实际播放3.002秒达到ended，24解码帧、22次视频呈现回调，浏览器报告丢1帧。
- 目视这例小幅体态变化时，轮廓保持连贯、未出现明显换脸或衣服撕裂；后续脸仍有软化，细节本来就只有低分辨率，不能称高保真。
- 这个例子是**从同一视频取首帧的近似重建测试**，且动作/服装接近TaiChi训练域；不是控制其他因素后的同人/跨人因果对比。它支持“首帧匹配的小幅动作可执行”，不能推出用户随意自拍的普遍质量。没有做服装更换，因此也不能当作换衣后动作链路验收。

源材料仍来自作者公开研究演示，只在本地研究目录保留；未复制到public、未启用研究预设、未将人物当成项目模特。新用户自己的视频入口可以使用其本人/有使用权的素材，与本地研究视频许可分开。

## 尚待验证

尚未使用用户本人新上传的视频与实际换衣结果完成整体质量验收。即便以上同人研究例通过，也不等于所有服饰、肤色、背景、体型和动作都通过。可考虑浏览器按钮“使用视频首帧作为人物照片”，先做换衣，再用同一驱动生成动作，减少首帧构图/站姿不一致；这只是后续产品建议，不能宣称已实现。

界面应让用户在本地预览视频首帧，对齐照片中的人物大小、站姿和方向；提示固定镜头、小幅动作，首先避免转身、遮脸、快速摆手和裁掉脚。上传入口与生成成功状态必须区分“环境能执行”和“效果已验收”。
