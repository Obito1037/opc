# 自己的商品图片试搭 · v0.4 技术与验收记录

2026-10-21。此模块为浏览器本地二维商品叠加；不调用 CatVTON、TPS 或云端生成，不提供商品尺寸推断、视角重建、服装替换或遮挡生成。商品窗口已通过 11 组真实本地识别与交互检查，0 页面异常；检测未被模拟，人物为已标注 AI 示例、商品为程序透明图形，不能外推为真实商品的贴合质量。

## 实现与来源

- `src/product-overlay.js` 为本项目的关键点校验、几何变换与透明绘制代码，没有引入外部商品贴图包。
- `src/photo-engine.js` 复用已安装的 MediaPipe Pose / Face Landmarker 本地模型及其检测结果；模型来源和许可沿用 [第三方声明](../THIRD_PARTY_NOTICES.md)。本模块不将检测器宣称为原创。
- `src/product-studio.js` / `.css` 实现本地商品上传、裁剪、白底去除、调整、色卡取色和导出。去白仅删除与图片边缘连通的近中性白色区域，不是神经分割，白色商品与白底相连时可能误删，应关闭去白并使用透明素材。
- 商品由用户提供。当前自动测试使用程序生成的纯色 / 透明图形，不借用品牌商品，不算真实商品视觉质量样本。实际照片检测可使用本项目标注的 AI 人物示例或已声明来源的复杂走秀照片，证据必须说明来源。

## 锚点与绘制约定

| 类型 | 检测条件 | 绘制 |
| --- | --- | --- |
| 眼镜 `glasses` | 两眼内外角有效，眼距及左右眼宽比例可靠 | 双眼中心线方向，单件正面眼镜图 |
| 耳饰 `earrings` | Pose 7 / 8 双耳点可信 | 单只耳饰放两侧，另一侧镜像；不用 FaceMesh 脸颊点冒充耳点 |
| 项链 `necklace` | Pose 11 / 12 双肩可信 | 双肩中点与肩线方向，单件正面项链图 |
| 鞋履 `shoe` | 双脚踝 / 跟 / 趾六点全部可信，跟趾方向非退化 | 单只侧面、鞋头朝右素材，依据每只脚方向旋转与镜像 |

所有点需在照片内、有限数值；人体点 visibility / presence 至少 0.65。鞋部缺失时整双停用，不用肩宽估计脚的位置。脸 / 双肩 / 耳点可以单独使用，不要求照片包含完整髋部。模型仍可能误检；坐姿、侧脸、遮挡和人物过小等情形需要更多真人样本验证。

真实浏览器初测发现 FaceLandmarker 的双眼点带 `visibility:0`，不能套用 Pose 的逐点置信门槛；现眼镜使用已经检测出的脸部坐标与双眼几何检查，人体点门槛不变。MediaPipe 的 [原始 landmark 协议](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/framework/formats/landmark.proto) 将 visibility / presence 声明为可选字段，不支持时不应设置。实际输入诊断保留于 `test-results/product-v4/ui-real/historical-face-visibility-failure-diagnostic.json`，回归 fixture 明确包含零值，修复后完整 UI 检查已通过。

接口：

```js
engine.setProductOverlay({
  image: preparedCanvas, type: 'glasses',
  scale: 1, rotation: 0, offsetX: 0, offsetY: 0,
  opacity: 1, mirror: false,
});
engine.getProductAnchorStatus('glasses'); // {available, message}
engine.clearProductOverlay();
engine.getProductPreviewCanvas(); // 刷新后的全尺寸 composite，或 null
```

旋转单位为度；偏移沿照片 XY 方向，以未缩放锚宽为单位、范围 -1..1；保留商品图片原始宽高比。只有一件当前商品，鞋 / 耳饰按双侧放置。商品鞋层停用旧示意鞋，配饰层停用旧示意配饰，防止重复绘制；不移除人物原照里的实物。透明 PNG 直接使用 alpha。

滑条只标记合成失效，同一帧内合并更新；颜色 / 服装缓存独立，商品微调不会重新计算衣物像素。原图与分屏的原图侧不包含商品；商品窗口导出总是取全尺寸合成图，不受当前“查看原图”状态影响。原有 `capture()` 仍表示舞台截图，保留原图对比的历史行为。新人物照片和引擎销毁释放当前商品引用。

## 已完成证据与边界

| 层级 | 实际结果 | 可证明范围 |
| --- | --- | --- |
| 完整 Node 测试 | `npm test`，61 / 61 通过，0 跳过 | API、协议、媒体校验、状态与几何边界；不是 61 次 AI 生成 |
| 商品几何单测 | `tests/product-overlay.test.mjs`，4 项通过 | 合成关键点的四类定位、无效点拒绝、有限参数、宽高比及镜像 |
| Edge Canvas 引擎 | `tests/product-overlay-browser.cjs`，30 项、0 异常 | 合成关键点 / 透明图形的像素合成、原图 / 分屏、PNG 解码、缓存、缺脚停用、生命周期 |
| 商品窗口 / 实际本地识别 | `tests/product-studio-real-v4.cjs`，11 组通过，0 页面异常 | 真实 MediaPipe；透明图形眼镜 / 鞋履、色卡、下载、失败回退、竞态和 390px 窗口；不算真实商品质量评估 |

浏览器记录为 [engine-contract.json](../test-results/product-v4/engine-contract.json)。80 次参数输入合为 1 次 composite 重建，fabric 重建计数不变；这是本机一次受控浏览器检查，不是跨设备 FPS 基准。四类商品均改变对应画面像素，透明区域仍为原照片像素；检测不到完整脚部时不画鞋。测试替换 `initModels` 并明确设置合成关键点，没有隐藏真实推理或生成成功。

独立 UI 记录为 [product-ui-real.json](../test-results/product-v4/ui-real/product-ui-real.json)，实际运行于 5175，时间 `2026-10-21T10:00:56.657Z`。真实检测 face / pose / feet 都成功；红眼镜在面部形成 865 个红像素，双鞋在脚部形成 1644 个红像素，下载 PNG 为 1024×1335、可重新解码并包含商品及底部说明。损坏 PNG、去白后的空图片保留旧商品，旧 decode 不覆盖新选择或销毁状态；比较 / 重置可逆，关闭重开保留当前商品；窄色卡的 object-fit 留白校正及键盘取色通过，390px 布局无横向溢出、对应控件至少 44px。耳饰 / 项链本轮只有几何和合成像素测试，尚无单独真实照片 UI 贴合验收。

成功 AI 结果的“继续搭配鞋饰”入口已通过独立正式发布检查，见 [release-production 报告](../test-results/generation-v4/release-production/real-generation-report.json)：5173 实际换衣 258.206 秒（种子 42）、默认轻微姿态 67.902 秒，之后生成图无需重传即进入主工作台、通过真实本地识别并打开商品窗口；原衣调色停用以保留 AI 服装结果。报告无 mock、页面异常 0，PNG / MP4 下载字节与 API 一致，视频 24 帧、3 秒，实际播放结束且 Range 检查通过。这条连接证据与商品窗口本身的 11 组检查分别记录，不表示真实商品贴合质量已经评估。

## 隐私与生命周期审查

只读检查了 `src/main.js` 的商品入口、照片上传 / 清除 / 重识别、导出和 `src/product-studio.js`：

- 点击商品入口最多触发浏览器本地识别，不调用 AI 生成提交。商品窗口没有 `fetch` / XHR 上传代码，也没有 localStorage、sessionStorage 或 IndexedDB 写入。
- 商品文件使用本地 Object URL 解码，`finally` 撤销 URL；人物图片仍遵循现有页面内存生命周期。文件名通过 `textContent` 展示，未插入未转义 HTML。
- 关闭窗口暂留本页商品，便于回到舞台；移除商品、清除 / 更换人物图及销毁窗口会释放引用，刷新页面不恢复图片。下载只在点击导出时创建文件，Object URL 稍后撤销。
- 取色回调只传十六进制颜色，收藏 / 撤销历史仅保存经过校验的搭配参数。商品 Canvas 和原文件不进入收藏或 JSON 导出。
- AI 工作台本来就可在用户主动打开时继承当前人物 File；点击 AI 生成才上传至配置服务。商品预览本身不会因此自动发送照片。

上述为代码审查结论。此次 UI 专项断言没有生成 API 提交，记录了实际本地模型请求；未单独收集全部 POST / 跨源请求和存储快照，因此不将其称为全网络与持久存储审计。

## 下一步验收

补充耳饰 / 项链真实照片可用性、实际遮挡下的拒绝行为，以及完整请求 / 存储观测。保留标注的合成素材测试，同时增加有授权的真实鞋饰素材和真人照片，并分别记录检测准确性和视觉贴合限制。
