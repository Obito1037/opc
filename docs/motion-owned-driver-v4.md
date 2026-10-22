# 自有默认动作驱动：轻微姿态 · 实验

本方案把项目已有的通用人台渲染成动作驱动，用于“仅上传一张照片也能生成小幅动作”的实验路线。**3D驱动本身不是用户照片的动作结果**；照片输出仍实际经过TPS神经网络。主代理对v2驱动、motion-strength=0.5的生成接触表与24帧脸部放大图完成了人工复核，仅批准为“轻微姿态 · 实验”单个默认预设。验收仅有一例AI生成模特的换衣图，不能外推到真人普适、身份保持或高质量全身动作。

`runtime/motion-v4/presets.json` 顶层`verified=true`，且只有`owned-subtle`预设为`verified=true`；其含义是允许上述受限实验配置，并非模型总体质量认证。3秒、8fps、256×256、strength=0.5、relative、contain、normalizeDriving=true为固定条件；所有TaiChi/Fashion研究视频预设仍为false。当前进程是否完成真实生成由服务端`verifiedGeneration`另行报告，配置文件开启本身不代表新进程已经生成。

## 来源与可复现文件

- 人台：`public/models/avatar-v2/atelier-body.glb`。来源为MakeHuman官方CC0基础人体、骨骼和权重，加本项目服装适配；来源链及完整许可保留在模型目录的README和LICENSE.ASSETS.md。
- [MakeHuman官方说明](https://github.com/makehumancommunity/makehuman/blob/master/LICENSE.md)将图形资产与程序源码分开，列出随附人体、服装、姿态等资产为CC0；并明确渲染、截图与模型导出属于用户输出。[资产许可全文](https://github.com/makehumancommunity/makehuman/blob/master/LICENSE.ASSETS.md)为CC0 1.0 Universal。本候选没有引入第三方社区服装、真人视频、下载动作或动作捕捉数据。
- 骨骼动作曲线为本项目原创，采用现有骨骼约定，与`src/avatar.js`共享人体资产，但未修改该文件。未采样TaiChi/Fashion研究视频。
- 独立渲染脚本：`scripts/motion-v4/render-owned-driver.cjs`及同名HTML；编码：`scripts/motion-v4/encode-owned-driver.py`。
- 资产目录：`asset-sources/tps-v4/owned-driver-v1/`和`owned-driver-v2/`。各自包含MP4、24张原始帧、首帧、接触表、HTML源快照、完整manifest。manifest记录模型和渲染源哈希、每帧相机与整个人台变换、各骨骼姿态。v1为失败历史证据；v2只在上述半强度条件下允许实验使用。驱动不在public中，由受控本地任务读取。

```powershell
node scripts/motion-v4/render-owned-driver.cjs
```

脚本临时启动仅本机可访问的静态服务，使用独立Edge无头进程渲染24帧；每次只渲染一个256²画面，主动间隔100ms。完成后关闭浏览器/服务，再使用隔离Python中的PyAV单线程编码。不会启动TPS或扩散模型。

## 动作与视频规格

固定正面正交相机；整个人台根节点的坐标、旋转不变；没有相机旋转、推拉、字幕、UI、水印或音轨。动画周期3秒，8fps、24帧、256×256，H.264/YUV420p。脊柱左右微倾，胸部反向补偿，手肘及膝盖轻微弯曲，头部做小幅反向保持。不是对整张画面作平移。

相对首帧，脊柱局部旋转最大约2.005°、前臂2.668°、膝关节0.917°；相机和整个人台变换逐帧相等。幅度刻意较小，渲染本身不模拟真实重心、接触力或服装动力学。

首次成功渲染耗时3.645秒（含主动间隔；不是性能基准），MP4为17,769字节，完整解码24帧均不同。已有严格driver验证器通过：3秒、8fps、24帧、尺寸256²、无音轨，`torchImported=false`。这只证明文件和渲染输出有效，不证明跨域驱动真人时画质合格。

## 实际真人推理

使用最新静态换衣结果 `test-results/generation-v4/final-production/tryon-api-result.png`，通过真实TPS TaiChi神经网络生成24帧、8fps、motion-strength=0.25。结果保留于 `test-results/motion-v4/tps-owned-driver-quarter-24.*`。实际耗时64.953秒，神经推理57.617秒，峰值RSS907.27MiB。

**v1没有通过有效动作验收。** 人脸、衣服和背景没有出现此前研究驱动的大幅重影/撕裂，但输出肉眼接近静止：24个解码帧只有20帧不同，平均相邻像素MAE仅0.003045/255、最大0.012899/255，局部梯度位移估计基本为0。模型学到的驱动关键点最大平均位移仅0.002513，再乘0.25后不足以产生可见动作。不能以“运行了真实模型”掩盖实际动态效果不足。

Edge完整播放3秒、24帧解码、22次帧回调、1次掉帧，结束事件正常；这只能证明播放流程完成。视频编码/播放通过不能替代动作和画质验收。v1候选的`verified`仍为false。

## v2扩大骨骼动作候选

将所有动态骨骼曲线扩大4倍，保持原始起始站姿、固定相机与根节点；追加本项目原创几何发帽/眼部细节，无外部贴图或真人素材。脊柱侧倾约±8°、前臂变化约10.7°，仍是正面轻微摆重心及屈肘屈膝，没有转身。候选在 `asset-sources/tps-v4/owned-driver-v2/`；v1及其HTML源快照保留。

```powershell
node scripts/motion-v4/render-owned-driver.cjs --name owned-driver-v2 --amplitude 4 --appearance hair
```

v2渲染5.876秒（包含主动间隔和同机负载），MP4为26,481字节、3秒、8fps、256²、24个唯一解码帧；已人工查看接触表，骨骼动作可见且没有相机运动。严格视频验证通过，`torchImported=false`。

随后使用 `test-results/vton-v4/quality-sleeve-v4/result.png` 的换衣人物，以motion-strength=1实际运行TPS：65.921秒、峰值906.28MiB，24帧均不同，平均相邻MAE1.008/255。**确有动作，但未通过画质**：第4/8/17/21帧的脸和颈肩出现明显重影/模糊，脸部手工ROI最大相邻MAE18.94/255；身体主体和腿较稳。证据为 `test-results/motion-v4/tps-owned-driver-v2-full-24.*`，其中quality-review.json明确拒绝，preview.gif只是原MP4逐帧导出的限色预览，未插帧或修补。

同一输入人物另存 `test-results/motion-v4/tps-owned-driver-v2-source.png`。之后只改变strength=0.5，原v2驱动文件保持不变，实测69.457秒、峰值907.09MiB、24帧均不同，平均相邻MAE0.589/255；完整Edge播放3秒结束正常，24帧解码、22次回调、1次掉帧（短样本，不代表整体性能）。证据为 `test-results/motion-v4/tps-owned-driver-v2-half-24.*`。

半强度的人脸重影比1.0减轻，主要可见位移为头部左右约±2像素，肩部/衣服有微小变形，腿部基本静止。24帧脸部放大接触表仍显示低分辨率柔化和局部形变，不能宣称高质量全身动作已完成。`.face-study.png` 使用3倍最近邻放大诊断，`.preview.gif` 为原帧限色循环预览，均没有插帧、增强人脸或补造新动作。主代理人工复核后批准受限实验用途，quality-review.json记录`acceptedAsExperimental=true`、`generalQualityPassed=false`以及一例AI模特的验证边界；历史全强度失败记录不被覆盖。

不直接盖回静态人脸：当前主要位移就在头部，硬贴回会消掉动作，也可能在移动颈肩处产生接缝。若后续保护原脸，应在每帧真实头部位移/角度约束下对齐再融合，并明确混合合成的适用范围；当前候选没有实施该处理。

该路线仍存在域差异：人台比例、光照、脸部与衣物特征不同于真人；即使驱动视频完全自有，也不能解决模型原本的身份漂移、衣物扭曲和背面信息缺失。只有经过实际生成及完整播放审查的具体组合才能作为实验预设，不把该样本的结果泛化为任意用户图片可靠。
