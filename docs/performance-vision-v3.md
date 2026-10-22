# v0.3 照片与动态视觉性能记录

日期：2026-10-21。测试环境为本机 Windows、Headless Microsoft Edge、MediaPipe Tasks Vision 0.10.32，使用本地模型。测试期间其他程序负载未固定，因此下列短样本仅解释已实现的工作量变化，不代表整站帧率、所有设备或物理摄像头体验。

## 实现

- `PhotoEngine.setLook()` 合并同一帧内的输入。衣物基础层与妆容层分离；只改妆容不会重新逐像素计算衣服。捕获、对比和暂停都在读取前刷新待合成的最新设置，不会导出旧色彩。
- `photo-recolor.js` 一次性缓存有效衣物像素索引、原布料亮度、褶皱系数及输出缓冲。算法的语义分割与复杂印花质量门槛保持不变。
- `PhotoEngine.setSplitComparison(value|null)`：0..1，左侧原图、右侧效果；分屏时使用相同的固定相机变换，避免对齐误差。`setPresentationMotion(false)` 停止轻微运镜，静止状态不持续重绘图像。
- `LiveMirror` 优先使用本地 module Worker 执行同步的人脸推理。主线程只缩小输入、传递 ImageBitmap 和绘制妆容；最多一个请求正在处理，不积压视频帧。退出时终止 Worker 并关闭视频轨道、释放 Blob URL。切换来源使用递增标识，过期结果不会覆盖新来源。
- Worker 不可用时回退 CPU 主线程，推理间隔至少 170 ms；不将回退标为 Worker 成功。真实播放故障继续通过 `onEnded` 通知界面清理预览。
- `LiveMirror.setQuality('auto'|'balanced'|'quality')`：推理输入长边上限分别为 384 / 480 / 640；目标间隔 100 / 83 / 56 ms，auto 会随推理开销增加间隔。这些是预算参数，不是设备实际达到的帧率承诺。渲染采用至多约 30 Hz 的节奏并跳过未改变的视频帧；后台页面不持续推理。
- `LiveMirror.setSplitComparison(value|null)` 与照片模式一致。两引擎提供 `getPerformanceStats()`，用于诊断而非产品效果评分。

## 观察值

照片使用明确标记的 AI 示例图，处理尺寸 1024 × 1280。v0.2 基线在修改前采集，保留在 `test-results/vision-v3/photo-baseline.json`；当前脚本禁止用新代码覆盖该基线。

| 照片短测 | v0.2 | v0.3 |
| --- | ---: | ---: |
| 同一调用中连续 60 次妆容输入的提交耗时 | 575.2 ms | 0.3 ms |
| 上述输入引起的完整合成次数 | 60 | 1 |
| 20 次更改后立即 capture，总耗时（含 PNG 编码） | 542.9 ms | 300.3 ms |

输入提交耗时不包括等待下一动画帧显示，也不代表 1900 倍整站加速。实际降低的是重复合成次数和服装像素处理。基线日志中有一条测试页 favicon 404；新测试页已提供空 favicon，后续测试浏览器异常为零。

对新缓存路径与旧版调色公式做整图逐像素比较：该样片最大通道差为 0，语义衣物区域外变化像素通道数为 0（关闭妆容/配饰）。仅妆容变化时服装缓存计数不增加。分屏 0 / 1 分别与全效果 / 全原图完全一致；减少动态时连续等待不增加重绘数。

动态测试使用 `test-results/v2/synthetic-tracking-fixture.webm`：它是 AI 示例照片的移动裁剪测试视频，**不是实拍人物动作，也不是生成式动作成果**。未打开物理摄像头或麦克风。

| 隔离生产构建，约 3 秒计时窗口 | Worker 路径 | 强制 Worker 不可用的 v0.3 回退 |
| --- | ---: | ---: |
| 总检测次数（包括就绪前的首次检测） | 31 | 19 |
| 累计模型推理耗时 | 555.8 ms（Worker） | 339.8 ms（主线程） |
| 主线程模型推理耗时 | 0 ms | 339.8 ms |
| 16 ms 定时器最大观察间隔 | 17.6 ms | 30.5 ms |

这不是严格的前后版本 benchmark：两种路径采用不同推理频率、只测一段合成视频，定时器间隔不是屏幕 FPS；Worker 路径的 Canvas 绘制和帧复制仍占用主线程。它验证模型推理确实移出了主线程。开发构建及隔离生产构建均成功加载真实本地模型，而不是替身或空结果。标准 MediaPipe 原生警告保留在 JSON，浏览器运行时异常为零。

分屏端点、分屏中间值、暂停稳定、恢复后视频帧变化、三档输入尺寸和 dispose 资源清理均通过。复杂高对比印花回归仍拒绝不可靠改色且原图像素不变；空白图片不会伪造人体、人脸或服装检测。

## 复现与证据

- 开发服务 5175 下：`node tests/vision-performance-v3.cjs`、`node tests/live-worker-v3.cjs`。
- 隔离构建：`node node_modules/vite/bin/vite.js build --outDir test-results/vision-v3/build`；仅测试目录，未覆盖正式 `dist/`。
- 暂停开发服务后：`node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5175 --strictPort --outDir test-results/vision-v3/build`。
- 隔离生产验证：`node tests/live-worker-v3.cjs --built`、`node tests/live-worker-v3.cjs --built --fallback`、`node tests/vision-quality-v3.cjs`。
- 证据：`test-results/vision-v3/photo-after.json`、`photo-after.png`、`live-worker.json`、`live-worker-built.json`、`live-fallback-built.json`、`quality-regression.json`。

## 参考与限制

复用 [Google MediaPipe](https://github.com/google-ai-edge/mediapipe) 已安装的 Apache-2.0 实现。官方 Web 文档说明同步检测会阻塞 UI，并建议 [使用 Web Worker](https://developers.google.cn/edge/mediapipe/solutions/vision/face_detector/web_js)。module Worker 的导入兼容性参照上游 [issue #5257](https://github.com/google-ai-edge/mediapipe/issues/5257) 与 [issue #5527](https://github.com/google-ai-edge/mediapipe/issues/5527) 理解，实际兼容桥按本地 0.10.32 运行时代码实现：仅允许同源 `/mediapipe/`，不使用 eval，不修改第三方 WASM 文件。依赖升级后需要再次验证 Worker 加载。

单张照片仍只支持上装保真改色和二维妆饰预览，不是生成式换款或真人动作生成。照片首次识别仍在主线程分阶段执行；这轮优化解决了反复调节和连续视频推理，未声称首次模型初始化完全无阻塞。不同浏览器的 Worker/OffscreenCanvas 支持与真实视频快速遮挡、低光照、侧脸跟踪还需更多设备样本验证。
