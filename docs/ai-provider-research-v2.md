# 真实 AI 试衣接入：第二版实测

日期：2026-10-21。此记录区分协议联通与真正出图。**本次没有得到真实 VTON 生成结果，界面不得标记“AI 换衣已完成”。**

## 实际结果与选型

| 路线 | 实测/官方状态 | 本项目决定 |
| --- | --- | --- |
| FASHN 官方 v1.5 Hugging Face Space | `/config` 与 `/gradio_api/info` 返回 200；提交内置人物和服装示例获得真实任务 ID；队列返回 `ZeroGPU quota exceeded`，匿名额度不可用 | 不继续换镜像或账号重试。不能将公共试用额度当长期后端 |
| CatVTON 官方 Space | 2026-10-21 官方页面显示 Runtime error，上游 FLUX 权重访问为 401；之前猜测的 `zheng-chong` 子域是错误地址，不构成服务状态证据 | 当前不能作为可运行后端；模型代码与演示的非商业许可也不适合直接许诺 OPC 商用 |
| IDM-VTON 官方 Space | `/config` 返回 200，Gradio 4.24.0，暴露 `tryon` 接口；没有再提交 GPU 任务 | “页面可访问”不等于“可成功出图”；不尝试以同平台其他模型绕过已返回的额度限制 |
| FASHN 商业 API v1.6 | 官方提供提交与轮询协议；本会话未提供账户密钥，未调用付费生成 | 可选适配器实现该协议，保持默认关闭；未作线上成功声明 |
| FASHN v1.5 本地 CPU | 官方实现支持 CPU float32，但实测本机 i5-13500H、约 15.63 GiB 总内存、当时仅约 1.00 GiB 可用，无 CUDA | 本次不下载大模型、不造成内存换页；没有把 GPU 论文耗时当成本机性能 |

最适合后续自主部署的是 FASHN v1.5：代码和权重按官方 Apache-2.0 发布；输入人物与服装图，支持上衣、下装、连体服装。官方 pipeline 的 CPU 分支存在，但仅说明可执行设备路径，不代表本机能达到交互速度。[官方代码与安装说明](https://github.com/fashn-AI/fashn-vton-1.5) · [官方 pipeline](https://github.com/fashn-AI/fashn-vton-1.5/blob/main/src/fashn_vton/pipeline.py)

公共演示与生产 API 是不同服务。FASHN v1.6 API 的鉴权、计费与模型能力不能从开源 v1.5 许可证推导。本适配器使用已核实的 `tryon-v1.6`、`model_image`、`garment_image`、`return_base64` 协议，不把商业接口假称开源自部署。[v1.6 接口](https://docs.fashn.ai/api-reference/tryon-v1-6) · [提交与轮询](https://docs.fashn.ai/api-overview/api-fundamentals)

CatVTON 和 IDM-VTON 可作为非商业研究对照，但不是当前稳定后端。[CatVTON 仓库](https://github.com/Zheng-Chong/CatVTON) · [CatVTON 官方 Space 与错误信息](https://huggingface.co/spaces/zhengchong/CatVTON) · [IDM-VTON 仓库](https://github.com/yisol/IDM-VTON)

## 已实现的可选适配器

文件：`server/tryon-provider.mjs`，Node.js 原生 `fetch`，不增加 npm 依赖，不自动启用、不访问网络、不读取全机凭据、不修改主界面/启动服务。

```js
import { createTryOnProvider } from './server/tryon-provider.mjs';

const provider = createTryOnProvider({
  inputRoot: '/absolute/path/to/accepted-uploads',
  outputRoot: '/absolute/path/to/local-results',
});
const status = provider.getProviderStatus();
// {configured, available, name, kind, busy, verifiedGeneration, remote,
//  message, lastError}

const result = await provider.submitTryOn({
  personPath: '/absolute/path/to/accepted-uploads/person.png',
  garmentPath: '/absolute/path/to/accepted-uploads/garment.png',
  category: 'tops',           // tops | bottoms | one-pieces
  garmentPhotoType: 'flat-lay', // flat-lay | model
  signal: abortController.signal,
  onProgress: event => console.log(event.status),
  allowRemoteUpload: true,    // 产品已告知图片发送至配置的云端时才传 true
});
// {filePath, mimeType, provider, upstreamJobId, elapsedMs, generated: true}
```

模块也导出默认实例的 `getProviderStatus()` / `submitTryOn()`，用于主服务直接调用。**仅在服务端导入**，密钥不得放入 `VITE_*` 环境变量或浏览器代码。

配置方式：

| 环境变量 | 含义 |
| --- | --- |
| `TRYON_PROVIDER=disabled` 或未配置 | 默认，明确返回未连接 |
| `TRYON_PROVIDER=gradio` | 使用与官方 FASHN v1.5 相同八参数 `try_on` 的已部署 Gradio 服务 |
| `TRYON_GRADIO_URL=http://127.0.0.1:7860` | 本地服务；远程只接受 HTTPS，必须是已获授权的服务 |
| `TRYON_HF_TOKEN` | 可选，仅用户主动提供用于其授权 Space 的令牌；本次没有配置 |
| `TRYON_PROVIDER=fashn-api` + `FASHN_API_KEY` | 用户配置的官方商业 API；每次生成可能计费，本次没有执行 |

`configured` 表示配置存在；`available` 只有本进程实际生成成功且最近调用无失败后才为 true。首次尚未验证时可以显示“已配置，待验证”，不要把配置存在标成已成功。首个任务是否可提交依据 `configured && !busy`，不能因为 `available=false` 永久禁用首次验证。

进度来自真实事件，状态为 `uploading / queued / running / completed / failed`；Gradio 还可返回真实队列位置与估计等待时间。没有固定假进度条。只有收到并校验图片后才落盘、返回 `generated: true`。失败或额度不足不会返回预制图片。

适配器只读指定上传目录内的 PNG/JPEG/WebP，限制 12 MB；不接受从 HTTP 请求传入任意系统文件路径。HTTP 层应自己分配上传文件名，传入绝对路径，不直接信任客户端路径。结果使用随机文件名写入本地结果目录；HTTP 层自行映射成同源下载地址，并在业务流程删除已过期输入和结果。

远程传输需传 `allowRemoteUpload: true`，默认不会发送用户照片。商业 API 请求 base64 输出、只提交一个样本、不自动重试生成。客户端取消或 5 分钟超时仅终止等待，远程任务可能仍在执行，不能承诺取消扣费。适配器没有管理账户、付费、创建服务或绕过配额的功能。

## 验证证据

保存在 `test-results/ai-provider-v2/`：

- `fashn-config.json`：官方 Gradio 6.3.0 配置。
- `fashn-api-info.json`：公开 `try_on` 接口真实八参数。
- `request-official-sample.json`：官方自带示例的请求，没有用户照片。
- `fashn-submit.json` / `fashn-sse.txt`：简单 call 接口返回 event ID 后 error。
- `fashn-queue-sse.txt`：读取 queue 协议后取得明确的 `ZeroGPU runs limit` 原因。

`node --test tests/tryon-provider.test.mjs` 共 7 项通过：默认关闭、云端传输门槛、文件目录范围、商业接口提交/轮询、Gradio 分片事件流、真实额度错误回放、失败不重复提交。成功路径由本地可控 mock 验证协议和文件落盘，**这不是远程模型已出图的证明**。后续获得授权 GPU 服务后必须以实际人物/商品输入重新验证身份、纹理、遮挡、质量和耗时。

真实单帧换装成功也不代表已完成人物走动视频、鞋码测量、妆容色准或三维本人重建。动作部分应单独验收。
