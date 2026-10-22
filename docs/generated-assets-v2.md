# v0.2 生成素材记录

- 资产：`public/demo/studio-model-v2.png`。
- 生成工具：OpenAI imagegen，2026-10-21；本次会话内生成并复制到项目。
- 内容：虚构成年东亚女性，白色短袖、深色长裤、白鞋，清晰正面全身工作室照片风格。
- 用途：测试衣物分割、原衣改色和面部识别。入口显示「AI 示例」。这张图本身不是应用的试衣生成结果。
- 原始工具输出：`C:/Users/20665/.codex/generated_images/01a15a3b-ebc0-7211-8a08-68b33fb860be/exec-4c538225-5ae6-408a-be60-536fe02f1537.png`。
- 回归测试仍保留 CC0 真实走秀照片；不以生成样片代替真人样本质量验证。

最终发送的提示：

```text
Use case: photorealistic-natural. Asset type: clearly labelled synthetic demo model for a local virtual clothing colour / makeup try-on application (label will be in app, no text in image). Generate one ultra-realistic full-body commercial studio fashion photograph, head to shoes entirely inside frame with 6% top and bottom margins. Fictional adult East Asian woman age about 28, natural proportions and natural face, shoulder-length dark straight hair tucked behind ears, friendly restrained neutral expression, front-facing straight relaxed standing pose. Arms slightly separated from waist, both arms straight with hands open relaxed, all fingers anatomically normal, legs separated hip-width, knees straight, both feet front-facing fully visible. Clothing: plain light-ivory crew-neck fitted cotton short-sleeve T-shirt untucked ending at hips with visible natural fabric knit and subtle folds; plain dark charcoal straight-leg tailored trousers, white clean minimal sneakers. No jewelry, no bag, no logos, no jacket. Studio seamless warm light gray background and subtle real floor contact shadow, large softbox diffuse neutral daylight, no dramatic shadows, no colour cast, no skin smoothing or overly perfect CGI skin. Fine photographic skin texture and subtle face detail, crisp clothing weave. Portrait aspect ratio 4:5, body centered, no crop, no perspective distortion, no collage, no inset, no watermark or text.
```

`test-results/v2/synthetic-tracking-fixture.webm` 是自动化测试将此图移动裁切后录成的视频，仅验证视频解码、连续帧、人脸跟踪和导出流程，不属于真人转头测试，也不对外展示为照片生视频能力。
