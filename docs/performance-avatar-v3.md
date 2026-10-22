# v0.3 立体陈列：按需绘制与画质设置

本轮只修改 `src/avatar.js` 的调度、渲染设置与圆台色彩，保留 MakeHuman 人台、服装、骨骼和动作设计。没有改变模型资产，也没有增加把照片重建成人体的能力。

## GitHub 参考

- [Three.js r186 官方按需渲染教程](https://github.com/mrdoob/three.js/blob/r186/manual/pages/rendering-on-demand.html)：采用单个待执行 RAF、交互 change 触发重绘的做法。按需绘制适用于暂停后的商品陈列；动作播放时仍逐帧更新。
- [Three.js r186 OrbitControls](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/controls/OrbitControls.js)：保留阻尼更新，拖动停止后继续绘制至相机稳定，随后停止调度。

使用项目现有 Three.js 0.186.1 / MIT 依赖，没有照搬陌生仓库或引入额外运行时。

## 行为变化

- 暂停且相机稳定时不再循环调用 WebGL 渲染，也不继续申请 RAF。
- 暂停中拖动、缩放、修改搭配、重置相机、切换画质和舞台颜色仍能立即更新。
- 容器隐藏、移出视口、页面隐藏时取消待执行帧；恢复可见后按当前暂停状态恢复。恢复时重置时钟，避免一次跳过长时间动作。
- 阴影不再默认自动重算；动作或造型变化时标记重算。暂停后的相机拖动复用阴影。
- 骨骼变换复用 Quaternion、Euler 和脚底定位 Vector3，移除这些数学对象的每帧创建。GLTFLoader 清理过的骨骼名称在加载时建立别名，保留四肢动作。
- 页面缩放和导出继续使用透明画布；舞台主题只调整圆台、边环和投影色。
- ResizeObserver 和画质设置只记录目标尺寸 / DPR；真正修改绘图缓冲和重新绘制在同一回调完成，避免暂停中切换专注模式或设置时短暂清空画布。相同尺寸不会重复清空缓冲。

## 接口

```js
stage.setQuality('auto'); // auto | balanced | quality
stage.setBackdrop('pearl'); // pearl | ink | rose
stage.getPerformanceStats();
```

| 画质 | DPR 上限 | 阴影贴图 | 行为 |
| --- | ---: | ---: | --- |
| auto | 1.5 | 1024² | 持续慢帧时按 0.2 降低 DPR，最低 0.8；本次选择期间不反复升降 |
| balanced | 1.25 | 1024² | 固定上限 |
| quality | 2 | 2048² | 固定上限 |

实际 DPR 同时受设备 DPR 限制。`setQuality()` 会重置自适应统计。无效选项回退 auto / pearl。auto 降档触发条件为预热 90 个动画间隔后，平滑帧间隔持续大于 28 ms 的 90 帧；这是轻量调节策略，不是 GPU 性能预测。

统计包含 quality、backdrop、pixelRatio、shadowMapSize、renderedFrames、averageFrameMs、averageSubmitMs、scheduled、paused、visible、drawCalls、triangles。averageSubmitMs 是 JavaScript 调用 renderer.render 的 CPU 提交时间，不能当作 GPU 完成时间；renderedFrames 不包含主动 capture 调用。

## 实测与范围

2026-10-21，Windows / Intel Iris Xe / Edge headless，同一台多人并行开发的机器；视口 1512×1100、固定舞台 596×650 CSS px、DPR 1，双方实际绘图缓冲均为 596×650。先对生产 v0.2 采样，再对开发 v0.3 采样。各状态只采 4 秒，期间没有用户输入。

| 状态 | v0.2 绘制帧 / draw calls | v0.3 绘制帧 / draw calls |
| --- | ---: | ---: |
| 行走播放 | 493 / 19,720 | 481 / 19,240 |
| 暂停稳定 | 552 / 22,080 | 0 / 0 |
| 切换到试妆模式 | 0 / 0 | 0 / 0 |

最可信的结果是：新版暂停稳定期间没有重复提交绘制；独立行为测试也确认没有待执行的 RAF。旧版隐藏容器已经不提交绘制，但仍保持 RAF 循环；新版连调度也取消。

活动样本渲染频率为旧版 123.13、新版 120.07 帧/秒，不能据此声称帧率提升。主线程 TaskDuration 样本为活动 575.8→384.0 ms、暂停 552.8→0.2 ms、隐藏 109.0→0.5 ms，但这些是短时、共享机器、带计数包装的观测，不能解释为整站速度、GPU 功耗或真实设备性能提升。默认阴影分辨率也由 2048 降至 1024，所以不是等画质的 GPU 基准。

证据保存在 `test-results/performance-v3/`：baseline.json、candidate.json、对应截图，以及 `avatar-v2.baseline.js` 源码快照。`candidate-hmr-invalid.json` 是被并行开发的 Vite 热更新改变画布尺寸的无效历史样本，不纳入上表。正式复测过滤了 Vite 的 update/full-reload 消息，并断言实际画布尺寸。

`tests/avatar-performance-v3.cjs` 可复测：`STUDIO_TEST_URL` 设置服务地址，`AVATAR_PERF_LABEL` 设置结果前缀。

`tests/avatar-behavior-v3.cjs` 独立浏览器测试通过 12 项：DPR 上限、暂停停止调度、暂停改色、拖动阻尼、滚轮缩放、画质设置、三种圆台配色且透明背景、恢复播放的像素与腿部骨骼变化、隐藏/显示容器、visibility 事件、PNG 导出、销毁释放。结果 `behavior.json`。visibility 使用模拟 document.hidden 事件，仅验证处理逻辑，不声称已测试系统级浏览器切换标签。

额外回归 `tests/avatar-dialog-regression-v3.cjs` 复现并修复了尺寸调整清空帧：暂停后开关专注模式、在设置中切换深色 / 流畅画质 / 深空灰 / 减少动态，关闭设置后立刻截图。修复前专注模式恢复瞬间可见像素曾为 0；修复后专注恢复、关闭弹窗和 700 ms 稳定状态均保持约 29,466 个非透明像素，`dialog-dark-immediate.png` 可见完整人台。证据 `dialog-regression.json`。最终性能与 12 项行为检查已在此修复后复跑。

没有执行真实手机测试、长时间压力测试或 GPU 耗电测量；摄像头、照片算法和整站响应速度由其他模块单独验收。
