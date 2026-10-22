# v0.4 本地 TPS 神经动作推理实测

2026-10-21。**真实 CPU 神经网络推理已跑通，展示质量未通过。** 不把本地研究样片开放成合格动作预设；`runtime/motion-v4/presets.json` 的顶层和每个预设均为 `verified:false`。这次不是纯几何变形、CSS 动画或静态图转视频，但也不是满足比赛要求的成品。

后续新增用户自带动作视频的标准化与校验、24帧小幅推理及实际播放器验证，见 [motion-user-driver-v4.md](motion-user-driver-v4.md)。用户视频入口不依赖再分发这些研究预设，整体效果仍采用实验表述。

## 实际执行内容

- Python 3.11.15 隔离环境：`runtime/motion-v4/.venv`，未向 Blender 原环境安装包。
- CPU PyTorch `2.14.1+cpu`、torchvision `0.29.1+cpu`、PyAV `18.1.0`；完整冻结版本在 `scripts/motion-v4/requirements.lock.txt`。没有安装 CUDA。
- [TPS 作者仓库](https://github.com/yoyo-nb/Thin-Plate-Spline-Motion-Model)，固定提交 `c616878812c9870ed81ac72561be2676fd7180e2`，本地 `asset-sources/tps-v4/upstream`。原仓库代码未修改。
- [作者 README 所链接的 Yandex 检查点](https://disk.yandex.com/d/bWopgbGj1ZUV1w)，`taichi.pth.tar` 为 350,993,469 字节。SHA256：`0aa12db735ed9959b3e70d8c3ad171ee7282d235d2e4bcae2b25b7a8c7e63dca`。
- 实际加载关键点检测器、稠密运动网络和神经修复网络，共 73,906,492 参数，`strict=True` 检查权重。使用作者相对关键点算法，`mmap + meta + assign=True` 避免同时保留随机权重副本。未使用随机模型或训练。
- 逐帧视频解码、神经推理、H.264 编码；未将全部视频转换成大张量，PyAV 不创建 ffmpeg 子进程。
- 输入是项目自带、明确标记 AI 示例的虚构成年模特 `public/demo/studio-model-v2.png`。没有用用户真人上传照验证身份保持率。

## 三轮结果与视觉验收

所有样片都是 16 帧、256×256、4 CPU 线程、完整 MP4 再解码验证。时长是播放时长，不是生成耗时。

| 驱动 | 视频 | 模型调用及编码耗时 | 报告总耗时 | 推理期间进程峰值 RSS | 视觉结论 |
| --- | --- | ---: | ---: | ---: | --- |
| TaiChi 原起点 | 8 fps / 2 秒 | 49.395 秒 | 57.967 秒 | 896.98 MiB | 驱动镜头缩小传入人物，衣服严重重影，拒绝 |
| TaiChi 从 0.5 秒开始 | 4 fps / 4 秒 | 40.868 秒 | 46.618 秒 | 892.31 MiB | 能抬腿和侧移；鞋子重影、手臂扭曲，拒绝 |
| Fashion 真实模特驱动 | 8 fps / 2 秒 | 39.397 秒 | 43.811 秒 | 891.86 MiB | 前向小动作较稳定；转身时正脸粘住、衣服重叠撕裂，拒绝 |

报告总耗时在生成完成时记录，未把最后校验哈希和写报告时间计入；RSS 是该进程在报告采样前的 Windows peak working set，不是整机用量。第一次旧脚本最终哈希曾一次读入 351 MB；随后已改为 1 MiB 分块，不重复大内存读取。实测机器与其他代理共享，绝非独占性能基准。三次时间不能用于声称某驱动更快或总体性能提高。当前 256² 与 4/8 fps 本身也达不到精细服装展示要求。

证据均在 `test-results/motion-v4/`：

- `tps-taichi-16.mp4` / `.contact.png` / `.report.json`
- `tps-taichi-stable-16.mp4` / `.contact.png` / `.report.json`
- `tps-fashion-16.mp4` / `.contact.png` / `.report.json`
- 每张拼图：上排原图，中排真实驱动，下排模型输出；没有挑出成功帧隐藏其余失败帧。

没有扩展到全长视频，因为 16 帧已暴露决定性缺陷。未做升帧、锐化、原图叠加等修饰来掩盖这些缺陷。

### 低幅度补充检查

在以上拒绝结果后，按新要求仅做 **6帧** 检查：TaiChi稳定起点0.5秒、`motion-strength=0.25`、2fps/3秒，完整神经推理总18.936秒，推理阶段13.250秒，报告峰值887.10MiB。证据 `tps-taichi-quarter-6.mp4`、`.contact.png`、`.report.json`。

拼图中衣服、脸部与整体轮廓明显更稳定，未出现前述大幅撕裂；代价是动作缩成很轻的重心变化，驱动中的抬腿几乎消失。这支持继续研究“受限小幅体态展示”，**不能称为走路/转身完成**。6帧、2fps不足以验证平滑度及长序列质量，且驱动素材权利边界未改变，因此仍不把预设标记 `verified:true`。这组没有做原脸/背景融合，所有输出像素仍来自神经网络。

### 最新24帧验证与边界

后续已完成两组24帧/8fps/3秒/.25强度的真正神经推理，均经用户视频标准化路径；详细数据见 [motion-user-driver-v4.md](motion-user-driver-v4.md)。

| 输入 | 报告总耗时 | 峰值RSS | 实际检查结论 |
| --- | ---: | ---: | --- |
| AI示例照片 + 研究TaiChi驱动 | 66.623秒 | 908.27MiB | 24帧均不同，较轻的重心变化，首帧外观接近原图，后续脸部软化 |
| 同一真实人物：驱动0.5秒帧作源图 | 65.373秒 | 907.69MiB | 对齐情况下轮廓连贯、无明显衣服撕裂；是同视频近似重建研究，不能外推任意自拍 |

两段均实际用Edge连续播放到3秒结束，24解码帧、22次呈现回调、浏览器报告丢1帧。不会写成“零丢帧”或“高帧率流畅”。最新同人证据在 `test-results/motion-v4/tps-same-person-quarter-24.*`（视频、拼图、报告、脸部比较、位移估计、播放器记录）；AI示例的对应前缀是 `tps-user-pipeline-quarter-24.*`。

已经实测：模型权重真实加载、每帧神经推理、MP4完整解码、实际浏览器播放、取消中断、用户MP4/WebM格式与旋转/比例处理、同人首帧对齐研究例。尚未实测或不能据此保证：用户新自拍的整体质量、任意衣物与背景、手部精细动作、完整走路/转身、背面布料、换衣后视频的服装一致性、物理尺码、各类人群的身份保持率。CPU小卷积和媒体色块fixture只证明各自技术环节，不属于服装或人物生成成果。

## 本人视频首帧流程：拍摄与演示顺序

推荐先上传本人或有使用权的短视频，在浏览器本地选“使用视频首帧作为人物照片”，再选择商品做换衣，最后用同一个视频驱动小幅动作。这个顺序使源图与驱动首帧的站姿、构图和光线天然接近；具体UI按钮由前端实现与验证，不以本文代替端到端验收。

拍摄要求：

- 录制4–6秒，文件不超过12MiB；最低连续3秒，最长15秒，8–60fps；普通SDR MP4或WebM，推荐720p或1080p。
- 固定手机或相机，单人正面全身，头、双手和鞋均在画面内；保留适量边距。让人物大小与首帧预览一致，不推拉镜头、不突然变焦。
- 均匀照明和简单背景，人与背景有一定区分；避免其他人、镜面反射、遮挡身体的包或家具。
- 从自然站姿开始，做轻微重心转移或小幅抬臂，脸保持朝前；暂时不要转背、走出画面、快速摆动或用手遮脸。录好后先本地预览首帧，不满意则重录。
- 原视频保留在本机任务中，正常输出不包含音轨。首帧预览/选图在浏览器进行，不新增单独的服务器预览PNG。

推荐现场演示顺序：

1. 说明这是本地实验性试穿与小幅动作展示，人物和商品均用已准备且有使用权的素材。
2. 上传本人短视频，检查首帧对齐，使用首帧作为人物图；展示这确实是源视频本人，而不是研究仓库模特。
3. 选择已有实测证据支持的服装类别及平铺商品图，先生成并检查静态换衣图。若脸、手、轮廓或商品细节不合格，明确重做，不继续包装成合格视频。
4. 用同一个视频生成3秒小幅动作，等待实际逐帧进度；预览完整片段，检查脸、手脚、衣服边缘和背景。
5. 清楚展示256×256/8fps与实验限制。失败时展示实际错误或取消流程，不切换成CSS摆动、重复静态帧或研究样片冒充这次生成。

研究TaiChi/Fashion视频只留在本地验证目录；没有发布成用户预设。用户自带视频入口不依赖这些素材的再分发权，但也不会自动验证上传者的身份或素材权利。

## 素材来源与使用边界

1. **实际神经网络源码**使用 TPS 作者 [MIT 许可证](https://github.com/yoyo-nb/Thin-Plate-Spline-Motion-Model/blob/main/LICENSE)，副本保存在 `asset-sources/tps-v4/TPS-LICENSE.txt`。本地 runner 参考作者 `demo.py` 的载入和相对关键点逻辑；底层网络直接导入作者源码。
2. **权重**是作者公开提供的研究检查点；仓库 MIT 不能替代 TaiChi 视频、人物或数据集的独立商业权利确认。未发现额外商用数据授权。
3. TaiChi 驱动来自 [MRAA 作者项目的公开比较视频](https://snap-research.github.io/articulated-animation/videos/taichi-comparison/example1.mp4)，原片 1148×768 / 100 帧 / 10 fps。裁剪 `(124,256,380,512)` 是真实驱动人物列，不是右侧生成结果。来源、裁剪、哈希保存在 `asset-sources/tps-v4/driver-manifest.json`。
4. MRAA 的 [代码许可](https://github.com/snap-research/articulated-animation/blob/main/LICENSE.md) 没有授予普通开源复制/修改/分发权。本项目**没有采用其模型代码**；仅依照本次任务授权下载公开示范片作本地研究，不能把这个视频或其衍生研究素材直接作为比赛/商用可再分发资产。
5. Fashion 驱动来自 [FOMM 作者公开演示 GIF](https://github.com/AliaksandrSiarohin/first-order-model/blob/master/sup-mat/fashion-teaser.gif)，裁剪左侧真实驱动 `(56,56,456,456)`；35 帧、10 fps。[FOMM 代码 MIT](https://github.com/AliaksandrSiarohin/first-order-model/blob/master/LICENSE.md) 也不等于演示模特视频的单独肖像和再分发授权。[原 Fashion 数据集说明](https://vision.cs.ubc.ca/datasets/fashion/) 未在该页给出可直接依赖的商业视频授权。保留本地研究用途。
6. `asset-sources` 的权重、源仓库、GIF、MP4、PNG 已在本目录 `.gitignore` 排除。没有复制到 `public`、没有发布网站，也没有创建付费账户或调用远程 GPU。

## Node 后端调用约定

可从任意 cwd 调用，默认相对脚本位置寻找源码、配置与权重：

```powershell
& './runtime/motion-v4/.venv/Scripts/python.exe' -u scripts/motion-v4/infer.py `
  --source-image public/demo/studio-model-v2.png `
  --driving-video asset-sources/tps-v4/taichi-driver-research.mp4 `
  --output test-results/motion-v4/example.mp4 `
  --max-frames 16 --fps 4 --threads 4 --start-seconds 0.5 --diagnostics
```

- stdout：UTF-8 JSONL，`status=running/completed/failed/cancelled`，`stage=dependencies/load/inference/complete`。逐帧报告 `frame`、`totalFrames`；不造预计完成百分比。
- stderr：第三方弃用警告和异常栈；不混入 JSON。
- 正常返回码 0；异常 1；被 Python 正常捕获的中断 130。Windows `child.kill('SIGTERM')` 可能直接终止进程，由 Node 捕获 signal。
- 写 `<outputstem>.partial.mp4`，完成编码并完整解码验证帧数后原子 rename。强制中断不保证运行 finally，Node 应清理属于该 job 的同名 partial，不能清理其他 job。
- 原尺寸输入经 EXIF 旋转、RGB 转换、保留比例填边后送入 256²网络。`--source-fit stretch` 可复现直接拉伸，但不是质量优化承诺。
- 可选 `--mode relative|standard`、`--checkpoint`、`--upstream`。当前只验证默认 TaiChi / relative / contain，不把其他组合宣称已通过。
- 另加入 `--motion-strength 0.05..1`（默认1）。在完成作者关键点归一化后，使用 `source + strength * (normalized-source)` 控制相对动作幅度，再实际运行稠密运动与神经修复网络。不是平移画面或播放前的几何特效。低幅度样本的验收结果另记；参数存在本身不表示质量已改善。
- 默认 `--max-frames 16 --fps 8 --threads 4`；最大帧数240，限制仅防止无界任务，不代表240帧质量已验证。

## 取消和协议验证

`node scripts/motion-v4/test-cancellation.mjs` 实际启动本地模型，在第二帧成功推理后发送 SIGTERM。进程退出约 **5.1 ms**；没有发布最终 MP4、没有 completed 事件、UTF-8中文 JSON 保真，测试本身通过。该次尚未留下 partial，测试仍会清理自己的目标 partial。运行报告 `test-results/motion-v4/cancellation.json`。没有仅用假模型模拟取消。

后端代理独立验证了真实 MP4 的 ftyp/moov/mdat、256²和2秒时长，证据 `test-results/motion-api-v4/real-mp4-validation.json`，该报告也标记视觉拒绝。

### CPU 精度的实际选择

为诊断另一路换衣模型半精度停滞，运行了不加载权重的小卷积：`Conv2d(320,320,3,padding=1)`，输入 `[1,320,96,32]`，4线程、MKLDNN启用，每种精度只有一次冷调用。PyTorch2.14.1 CPU 实测 float32 **0.04599秒**、float16 **6.47809秒**（约141倍），均输出有限数。本机不能根据半精度内存小就推断其更快，TPS实际样片一直使用float32。这个单算子结果不能外推为整模型141倍。脚本 `scripts/motion-v4/benchmark-conv.py`，记录 `test-results/motion-v4/cpu-conv-dtype.json`。

## 后续可执行方向

TPS 路线证明普通 CPU 能以小于约 1 GiB 的模型工作集完成真实全身照片运动，但对现代服装细节和转身补全不足。要启用界面预设，至少要使用有使用权的固定镜头真人动作，保持首帧体型/姿势/构图匹配，重新验证衣服、手脚、脸部；不能用降低验收标准把当前样片标成成功。单张正面照片没有背面衣服信息，本模型的转身失败也不能用 UI 或插帧修复。

环境重建：`scripts/motion-v4/install.ps1` 只写隔离 venv；源码从固定提交克隆到上述目录；`node scripts/motion-v4/download-weights.mjs` 下载作者权重并验证已知 SHA256。研究驱动不自动作为产品资源安装。

### 原脸与背景保护的可行范围（方案评估，尚未实施）

- **背景**：对于固定相机、小幅身体动作，可以用人物分割与模型预测前景组成新画面，再用原始背景保留静止区域。但人物原位置的遮挡区没有真实背景，直接盖原图会留下双人轮廓；需要可靠的背景修复底板和逐帧前景遮罩。背景稳定不等于动作质量合格。
- **原脸**：仅当头部几乎不动时，低幅度合成可保护原脸细节；必须用逐帧脸部定位/运动对齐与柔边遮罩，限制头部角度，并标明是“保留原脸的动作合成”。未经对齐直接盖原脸会产生漂浮、接缝。若头部转侧或转背，保留正脸会伪造不合理的展示，不能这样处理。
- **衣服与遮挡**：原图融合不能补出背面衣服、抬手后新显露的布料和真实褶皱。大幅原图混合只能减弱动作、掩盖缺陷；应显示其合成限制，不能声称物理试衣或准确背面还原。
- **更长帧序列**：这些融合策略与16/32帧长度无直接保证关系。逐帧遮罩抖动和身份漂移会累积，必须在完整序列检验边缘/遮挡/时间一致性。补帧只增加播放采样数，不会提高已错误的神经姿态或服装真实性。
