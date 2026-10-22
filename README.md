# 映身 YINGSHEN · 动态试穿实验室

面向数媒比赛的本地虚拟试搭项目。上传人物照片与服装商品图，生成试穿结果，再尝试轻微动作或继续搭配自己的鞋履、配饰和妆容。界面采用银灰与蓝色工作台，支持移动端、亮暗主题、分屏对比、编辑历史和结果导出。

当前版本 **v0.4**，以 Windows 本地运行为主要验证环境。前端使用原生 JavaScript、Three.js、MediaPipe 与 Vite，Node.js 提供同源任务 API；可选 Python 环境运行 CatVTON 换衣和 TPS 动作模型。

## 功能与边界

| 功能 | 当前实现 | 适用范围 |
| --- | --- | --- |
| AI 服装试穿 | 人物图 + 平铺商品图，本机神经模型生成；含进度、取消、恢复、种子、对比及下载 | 上衣有真实生成样例，细节可能改变；下装、连体衣仍待独立画质验收 |
| 单图轻微姿态 | 自有骨骼动作驱动 TPS，为人物图或试穿结果生成视频 | 3 秒、8 fps、256 × 256 的实验预设；可能柔化脸部或扭曲纹理，不保证走秀及任意转身 |
| 自带动作视频 | 上传自己的短视频，校验与整理后驱动人物图 | 固定小幅动作实验；可在浏览器提取视频首帧作为人物照片 |
| 鞋履与配饰 | 上传商品图，按人体关键点二维叠加；支持去白底、位置、大小及旋转调整 | 属于搭配预览，不生成真实遮挡，不测量尺码，不保证实际贴合 |
| 试妆与改色 | 色卡取色、照片衣物改色，以及摄像头或本地视频的人脸跟踪试妆 | 用于颜色与风格预览，不能代替实物色准、肤质或面料判断 |
| 3D 陈列 | 连续蒙皮人台、服装切换、骨骼动作、旋转与缩放 | 通用人台，并非上传者的三维重建 |

成功换衣后可点击“继续搭配鞋饰”，将结果载入照片工作台。浏览器侧还支持撤销重做、收藏、JSON 导入导出、PNG 导出和受浏览器支持限制的 WebM 录制。

## 安装与运行

安装 Node.js 与 npm。锁定的 Vite 8 要求 Node.js `^20.19.0 || >=22.12.0`；本地开发记录使用 Node.js 24。下载或克隆仓库后，在仓库根目录执行：

```sh
git clone https://github.com/Obito1037/opc.git
cd opc
npm ci
npm run setup:models
npm run build
npm start
```

打开 **[http://127.0.0.1:5173](http://127.0.0.1:5173)**。服务仅监听本机，提供页面与 AI 任务 API。`setup:models` 准备浏览器使用的人脸、人体、分割模型及 WASM，首次安装需要访问下载源；它不会安装换衣或动作生成的大模型。

修改前端代码后重新执行 `npm run build` 并刷新页面。仅调试前端可运行 `npm run dev`；Vite 开发服务不提供本项目的 AI 同源 API，且与 `npm start` 默认使用同一端口。程序无需 Unity 或 Blender 即可运行现有工作台。

## 可选：本机 AI 生成

AI 生成功能需要额外安装，未准备好时工作台会显示当前服务状态。下面的安装脚本面向 **Windows PowerShell + Python 3.11**，分别创建隔离虚拟环境。换衣模型下载约 **3.31 GB**，动作 checkpoint 约 **351 MB**，另需 Python 依赖与缓存空间。本地 CPU 推理耗时以分钟计，具体取决于机器与输入。

先确定自己的 Python 3.11 路径。安装了 Windows Python Launcher 时可使用：

```powershell
$studioPython = (py -3.11 -c "import sys; print(sys.executable)").Trim()
```

也可自行给 `$studioPython` 赋值为 Python 3.11 可执行文件的完整路径，通过 `-BasePython` 传入；不需要原开发电脑的目录或 Blender 环境。

**换衣环境：**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/vton-v4/install.ps1 -BasePython $studioPython
```

脚本安装依赖、下载并核验模型；`-SkipModels` 可仅安装依赖。完整安装且 `runtime/config.json` 不存在时，会创建启用本机换衣、关闭动作的初始配置；已有配置不会被覆盖。模型版本和摘要见 [models.lock.json](scripts/vton-v4/models.lock.json)。

**动作环境：**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/motion-v4/install.ps1 -BasePython $studioPython
```

动作安装脚本准备 Python 依赖；还需要恢复官方 TPS 源码并下载 checkpoint。首次准备时执行：

```powershell
git clone https://github.com/yoyo-nb/Thin-Plate-Spline-Motion-Model.git asset-sources/tps-v4/upstream
git -C asset-sources/tps-v4/upstream checkout c616878812c9870ed81ac72561be2676fd7180e2
node scripts/motion-v4/download-weights.mjs
```

若该上游目录已存在，先核对当前提交，无需重复克隆。下载脚本校验权重大小与 SHA-256。源码、权重均不会上传人物素材；首次安装与下载需要网络。

完成上述环境、源码与模型安装后，可从 [服务配置模板](examples/runtime-config.local.json) 与 [自有动作模板](examples/motion-presets.json) 准备本地配置。模板只包含本机模型及自有默认动作：

```powershell
New-Item -ItemType Directory -Force runtime/motion-v4 | Out-Null
if (-not (Test-Path -LiteralPath runtime/config.json)) {
  Copy-Item examples/runtime-config.local.json runtime/config.json
} else {
  Write-Output '已有 runtime/config.json，请手动合并 examples/runtime-config.local.json，保留原有设置。'
}
if (-not (Test-Path -LiteralPath runtime/motion-v4/presets.json)) {
  Copy-Item examples/motion-presets.json runtime/motion-v4/presets.json
} else {
  Write-Output '已有动作清单，请手动合并 examples/motion-presets.json，保留原有设置。'
}
```

换衣安装脚本通常已经创建服务配置，因此此时需要手动合并动作字段。启用自己的视频驱动与自有默认预设所需的服务配置如下；保存后重启 `npm start`：

```json
{
  "tryOn": { "provider": "local-catvton" },
  "motion": {
    "provider": "local-tps",
    "enabled": true,
    "acceptsDrivingVideo": true
  }
}
```

单图默认动作由上述 `runtime/motion-v4/presets.json` 指向仓库内的自有驱动，详见 [自有动作说明](docs/motion-owned-driver-v4.md) 和 [动作接口说明](docs/motion-api-v4.md)。它使用项目的 MakeHuman **CC0** 人台与原创骨骼曲线生成驱动视频，再经过 TPS 推理得到人物输出；没有把人台动画直接当作真人生成结果。研究人物视频不随仓库分发。

上述说明基于已有开发环境和代码检查。**尚未完成独立干净机器上的全量 AI 安装与画质验收**，不能将安装步骤视为所有设备均已验证。可选远程服务需自行配置，默认本机路线不依赖付费 API。

## 测试与证据

```sh
npm test
npm run build
```

`npm test` 包含业务逻辑与 API 协议检查；隔离 fixture 不等同于真实模型生成。部分视频校验测试需要动作 Python 环境，浏览器专项脚本还需单独准备 Playwright 与浏览器，旧脚本保留了开发机工具路径。

开发环境已有换衣 → 动作 → 下载 → 继续搭配的实际界面验收，记录见 [v0.4 验收说明](docs/验收记录-v0.4.zh-CN.md)。原始日志、截图、视频和 `test-results/` **未纳入仓库**，文档中相应路径指向本地历史证据；克隆后不会包含这些文件。已记录样例主要使用明确标注的 AI 虚构成年模特，不能外推为所有真实用户的生成质量或身份保持能力。

## 数据、素材与许可

- 仓库不包含私人上传、个人生成历史、服务密钥、虚拟环境或换衣/动作大模型权重。`runtime/`、`.env`、依赖目录和测试输出已列入忽略规则。
- 浏览器侧照片改色、鞋饰试搭、色卡与试妆在本地处理。点击 AI 生成后，输入提交给配置的推理服务；本机推理路线不外发素材。任务结束清理临时输入，结果有保留期限，用户自行下载的副本不受此清理影响。
- 默认清晰人物图是 AI 生成的虚构成年模特；另一张走秀照片使用 CC0 素材。人台与动作来源见 [资产许可说明](public/models/avatar-v2/README.md) 和 [自有动作说明](docs/motion-owned-driver-v4.md)。
- CatVTON 及其派生推理代码采用 **CC BY-NC-SA 4.0**；人体解析模型继承 NVIDIA SegFormer 的非商业许可；Stable Diffusion 使用 CreativeML OpenRAIL-M；TPS 源码采用 MIT。不同组件和模型各自适用上游条款，项目不宣称已取得商业运营授权。

完整来源、修改记录和许可文本见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 与 [public/licenses](public/licenses)。详细功能记录见 [README.zh-CN.md](README.zh-CN.md)，项目定位见 [比赛说明](docs/项目说明.zh-CN.md)。
