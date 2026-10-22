# v0.4 真实试衣与人物动作：环境验证与执行路线

核查日期：2026-10-21。本文件区分“已在这台机器跑通”“官方源码支持”“尚未完成端到端验证”，不能将设备探测或模型下载当成换衣成功。后续实际安装并跑通了本地 TPS 神经动作推理，详见 [motion-v4.md](motion-v4.md)；三组16帧样片完成，但均未通过服装展示视觉验收。

## 本机实际状态

- CPU：13th Gen Intel Core i5-13500H，16 逻辑核。
- GPU：OpenVINO 2026.4.1 实际枚举到 `Intel(R) Iris(R) Xe Graphics (iGPU)` 和 CPU，均完成真实模型推理。
- RAM：15.631 GiB；工作期间空闲在约 1.0–2.3 GiB 变化。这是共享机器的即时状态，不是仅运行本项目时的上限。
- C 盘当时空闲约 159.9 GiB。磁盘空间充足并不等于运行内存充足。
- 系统 `py -0p` 没有注册 Python。复用工作区 Blender 的 Python 3.11.15，在 `scripts/research-v4/.venv/` 建立隔离环境，未修改 Blender 自带包。
- 初次研究阶段安装 OpenVINO 2026.4.1、NumPy 2.4.6、Pillow 13.0.0；wheel 下载合计约 105 MB。该阶段未安装 CUDA、PyTorch 或多 GB 扩散权重。之后另在 `runtime/motion-v4/.venv` 安装 CPU PyTorch，不能把这条历史记录当成最新环境状态。
- WMI 查询在当前沙箱拒绝访问，RAM 使用 Node `os` / Win32 `GlobalMemoryStatusEx` 核查；GPU 使用 OpenVINO 实际运行结果。没有读取账号、令牌或全机凭据。

## 已经跑通的真实推理

运行现有 `public/models/selfie_multiclass_256x256.tflite`，输入项目中明确标为 AI 示例的全身照。模型是 16,371,837 字节，输入 `[1,256,256,3]`，输出 `[1,256,256,6]`；输出不是随机模型或占位结果。

| 设备 | 首次编译 | 30 次推理中位耗时 | P95 |
| --- | ---: | ---: | ---: |
| CPU，4 线程 | 0.331 秒 | 49.848 ms | 55.139 ms |
| Iris Xe GPU | 5.820 秒 | 73.229 ms | 192.090 ms |

两设备分割标签一致率 99.9512%，输出均为有限数，识别到了衣服类别。GPU 本次较慢，不能宣传“换成 OpenVINO GPU 就能提速”。这是**服装分割**的验证，不是服装生成，也不能据此估计扩散速度、内存或真人视频质量。

证据：`scripts/research-v4/results/openvino-probe.json`、`clothing-segmentation-cpu.png`、`clothing-segmentation-gpu.png`。OpenVINO 遥测组件在沙箱外目录写入失败，并明确输出未发送数据；模型处理本身成功。

复现：在项目根目录运行 `powershell -File scripts/research-v4/probe.ps1`。运行时不会上传照片或下载生成模型。公开权重大小元数据由 `collect_metadata.mjs` 记录到 `results/model-metadata.json`。

## 真正换衣的本地路线

### 首选研究方向：CatVTON + Intel 官方 OpenVINO 转换

Intel 官方已有 [CatVTON notebook](https://github.com/openvinotoolkit/openvino_notebooks/tree/latest/notebooks/catvton)，其[转换辅助源码](https://raw.githubusercontent.com/openvinotoolkit/openvino_notebooks/latest/notebooks/catvton/ov_catvton_helper.py)明确先在 CPU 加载模型，再转换 VAE、UNet 和自动蒙版模块。不是只支持 CUDA 的设想。

具体路径：使用原人物图、商品图、服装区域蒙版，先跑静态换衣；当前应用的分割可辅助提供蒙版，减少第一轮验证时加载 DensePose/SCHP 的负担。先仅处理正面上衣、单张图，再测复杂衣袖与遮挡。官方 helper 默认构造 1024×768 / 拼接 UNet 输入；降低尺寸需要同步调整转换示例、模型 reshape 和管线，不能只改上传图尺寸。

[CatVTON 官方](https://github.com/Zheng-Chong/CatVTON)给出约 899M 参数、1024×768 bf16 推理约 8 GB 显存。该数字不是此机器的 RAM 实测。仅按参数计算，FP16 参数约 1.8 GB、FP32 约 3.6 GB，还需图转换、激活和辅助模型内存。当前 1–2.3 GiB 空闲不适合直接完整转换。

建议下一次本地重模型试验先留出至少 6–8 GiB 可用 RAM；这是工程预算而非验证过的最低配置。先 CPU 单图、低尺寸、少步数测一次内存与每步耗时，再决定 20–30 步正式生成；目前没有端到端耗时，不承诺秒出图。代码与权重为 CC BY-NC-SA 4.0，参赛研究与商业部署要分别核对授权。

### 可执行但更占内存：FASHN VTON 1.5 CPU

[官方源码](https://github.com/fashn-AI/fashn-vton-1.5)支持 `TryOnPipeline(weights_dir=..., device='cpu')`，CPU 会把 bf16 权重转换为 float32；姿态检测换 CPU 版 ONNX Runtime 即可。公开模型目录实查主权重为 **1,943,668,048 字节**，另需 DWPose 和约 244 MB 人体解析器。

按主权重精度换算，CPU 主模型参数约 3.6 GiB；加载时还可能同时持有 checkpoint 和模型副本，尚未包含激活及解析模型。这是体积推算，不是测得峰值。当前空闲不足，所以本轮没有下载或启动。它是 Apache-2.0 路线，适合未来商业方向，但应保留各第三方组件声明。不要将“有 CPU 分支”解释为“本机已能即时完成”。

### 轻量旧模型：CP-VTON+ / TPS

[CP-VTON+ 官方](https://github.com/minar09/cp-vton-plus)为 MIT、192×256 的 GMM/TPS + TOM 神经融合路线，比扩散轻，但依赖人体解析和 COCO-18 姿态；原始测试代码硬编码 `.cuda()`，需要移植设备管理，且 PyTorch 0.4.1 依赖很旧。仓库已归档。它是真实神经服装迁移，不等于画多边形贴图，但分辨率和复杂遮挡能力不适合作为当前比赛品质的主方案。

[IDM-VTON](https://github.com/yisol/IDM-VTON)采用更重的 SDXL 路线，代码和权重为 CC BY-NC-SA 4.0；本机当前内存状态下优先级低于 CatVTON。没有把下载成功、第三方截图或公开 demo 结果当成本地效果。

## 人物动作：区分全身和头像

### TPS Motion Model：确实有全身 CPU 路线

[作者官方 Thin-Plate-Spline-Motion-Model](https://github.com/yoyo-nb/Thin-Plate-Spline-Motion-Model)提供 TaiChi / TED / Vox 模型；[demo.py](https://raw.githubusercontent.com/yoyo-nb/Thin-Plate-Spline-Motion-Model/main/demo.py)包含 `--cpu`，神经网络学习关键点、运动场和遮挡补全。这不是简单把照片左右平移。

从作者 README 指向的公开 Yandex 目录实查，`taichi.pth.tar`、`ted.pth.tar`、`vox.pth.tar` 各 **350,993,469 字节**。其中 TaiChi 才是全身动作候选，Vox 是头像，TED 常为上半身。默认输入 256×256；需要真实驱动视频，最好人物尺度、首帧姿势和画幅接近。

在隔离环境与权重准备完毕后，官方入口为：

```text
python demo.py --config config/taichi-256.yaml --checkpoint checkpoints/taichi.pth.tar --source_image source.png --driving_video driving.mp4 --result_video result.mp4 --cpu --img_shape 256,256 --mode relative
```

建议先做 8–16 帧挥手的小样。原 demo 一次把驱动视频全部转为 tensor，需改成逐帧读取 / 写入，避免长视频占满内存。预计运行预算应至少留出 3–4 GiB 空闲 RAM供依赖、权重副本和中间张量；此数为保守工程预算，未测峰值。本轮没有运行该权重，CPU 每帧耗时未知。应实测 16 帧后再估算 5 秒，而不伪造 FPS。

许可证为 MIT；需保留模型来源与许可。256² 画面和大姿态变化会损伤衣服图案、手部及身体边界，不能称为高保真布料模拟或任意 360° 展示。作者 README 指向的第三方 ONNX 加速仓库本次返回 404，未采用失效路线。

### LivePortrait：适合面部，不能代替全身动作

[官方参数](https://raw.githubusercontent.com/KlingAIResearch/LivePortrait/main/src/config/argument_config.py)提供 `flag_force_cpu`，注明仍在完善；CPU 试验还应关闭半精度。官方人像模型加 landmark / InsightFace 文件合计约 **659 MB**，公开目录已核查大小，但没有下载或跑完整动画。

它主要生成表情、眨眼、嘴部和头部姿态，可用于妆容展示；不能声称让上传者全身走路。项目代码为 MIT，但[官方许可](https://raw.githubusercontent.com/KlingAIResearch/LivePortrait/main/LICENSE)明确 InsightFace 检测权重仅限非商业研究，商业使用应替换检测器。首轮 CPU 建议预算 3–4 GiB 空闲 RAM、逐帧生成；时间必须实测，不能引用 GPU 宣传值。

## 真实远程推理：能够形成完整链路的选择

优先统一使用 FASHN 官方 API：服装图 + 真人图 → `tryon-v1.6` → 输出图 → `image-to-video`。两者同一个 `POST https://api.fashn.ai/v1/run` 和 prediction 轮询机制，不需要因动作生成再接一个服务商。

| 步骤 | 参数与当前官方信息 | 实际状态 |
| --- | --- | --- |
| [Try-On v1.6](https://docs.fashn.ai/api-reference/tryon-v1-6) | `model_image`, `garment_image`, category；1 credit / 图；官方典型约 5 / 8 / 12–17 秒，按性能 / 均衡 / 品质 | 文档验证，未用授权账号实测 |
| [Image to Video](https://docs.fashn.ai/api-reference/image-to-video) | `image`, `duration:5`, `resolution:'480p'`；可传简短动作提示；目前 5 秒 480p 为 1 credit，支持 10 秒及更高分辨率 | 文档验证，未提交请求 |
| [fal 的 FASHN 托管](https://fal.ai/models/fal-ai/fashn/tryon/v1.6/api) | 需要授权 FAL_KEY、服务端队列；接受 data URI | 备用商业服务，未注册或调用 |
| [作者的 Replicate TPS 入口](https://replicate.com/yoyo-nb/thin-plate-spline-motion-model/api) | 需要授权 Replicate API 凭据，传 source_image / driving_video | 公开入口已查，未调用 |

真正上传远程推理前，界面必须说明媒体会发送至服务商；令牌放服务端，不能嵌入前端产物。本轮没有读取已有凭据、注册账号、购买积分或发起付费生成，也没有换 Hugging Face Space / 镜像规避先前的 GPU 配额限制。公开模型元数据读取与额度规避无关，没有触发远程 GPU 任务。

## 给下一轮实现的明确顺序

1. 有已授权的 FASHN 服务时，先验证单张真实换款的输出，再串接短视频；逐个检查图案、脸部、手部和衣服时序，失败要保留上游原因。
2. 无可用服务时，优先规划 CatVTON + OpenVINO 的独立本地进程；释放足够资源后再做低分辨率单图验证，不占用当前 1–2 GiB 空闲内存直接开始多 GB 转换。
3. 动作研究使用 TaiChi TPS 的小段真实驱动视频，逐帧低内存实现；只有实际样片质量过关才加入产品，明确实验模式。
4. LivePortrait 作为妆容/头像动作的补充，不作为全身动态试衣的替代。

本轮交付的是已验证的 Intel 推理环境、实际服装分割结果、可追溯权重大小和具体实现入口；尚未完成新的静态生成试衣或真人动作生成，不能据此把总目标标为完成。
