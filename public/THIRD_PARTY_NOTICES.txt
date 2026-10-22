# 第三方组件、模型与素材声明

项目：映身 YINGSHEN / `yingshen-tryon-studio` 0.4.0
记录日期：2026-10-21

本项目复用软件库和模型，通过它们的公开 API 实现交互。没有把整个官方演示仓库作为本项目 fork，也未将上游模型训练成果标为自研。下表按当前 `package.json`、已安装 npm 包和官方资料记录。

## 软件

| 组件 | 锁定版本 | 作者/权利人 | 许可 | 使用方式与来源 |
| --- | --- | --- | --- | --- |
| Three.js | 0.186.1 | three.js authors，Copyright © 2010–2026 | MIT | 三维渲染和 OrbitControls；[官方仓库](https://github.com/mrdoob/three.js)、[许可](https://github.com/mrdoob/three.js/blob/dev/LICENSE) |
| `@mediapipe/tasks-vision` | 0.10.32 | The MediaPipe Authors / Google | Apache-2.0 | 人体、人脸关键点与 WASM 推理；[官方仓库](https://github.com/google-ai-edge/mediapipe)、[许可](https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE) |
| Vite | 8.0.3 | VoidZero Inc. and Vite contributors，Copyright (c) 2019–present | MIT，另有随构建工具分发的依赖许可 | 开发与打包，不是交付版静态服务器的运行依赖；[官方仓库](https://github.com/vitejs/vite)、[完整许可及随包依赖清单](https://github.com/vitejs/vite/blob/v8.0.3/LICENSE.md) |

npm 锁文件记录实际依赖树。分发开发工具及 `node_modules` 时，应保留各 npm 包自带的 LICENSE/NOTICE；Vite 的完整附带许可位于 `node_modules/vite/LICENSE.md`。下面附有运行库所需的主要许可文本，不能用本文件删除上游包原有声明。

官方 [MediaPipe Web 示例](https://github.com/google-ai-edge/mediapipe-samples-web) 与 [Pose 文档](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js)、[Face 文档](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js) 用作 API 用法参考。文档内容和示例代码的许可由各来源说明；本项目未捆绑其示例照片。

## Google 官方模型

以下 `.task` / `.tflite` 模型由 `scripts/setup-models.mjs` 从 Google 官方地址取得。本项目不修改模型权重，不重新训练模型；本地代码负责输入、调用和结果渲染。

| 本地文件 | 精确下载来源 | 大小 / SHA-256 |
| --- | --- | --- |
| `public/models/pose_landmarker_lite.task` | [Pose Landmarker Lite float16 version 1](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task) | 5,777,746 字节；`59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a` |
| `public/models/face_landmarker.task` | [Face Landmarker float16 version 1](https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task) | 3,758,596 字节；`64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff` |
| `public/models/selfie_multiclass_256x256.tflite` | [Selfie Multiclass float32 version 1](https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite) | 16,371,837 字节；`c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0` |

Google 在对应官方模型卡中明示 **Apache License, Version 2.0**：

- [BlazePose GHUM 3D 模型卡](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf)，第2页许可栏；官方 Pose Landmarker 指南将 Lite/Full/Heavy 关联到此卡。
- [FaceMesh V2 模型卡](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Face%20Mesh%20V2.pdf)，第1页许可栏。
- [BlazeFace Short Range 模型卡](https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20%28Short%20Range%29.pdf)，第1页许可栏。
- [Blendshape V2 模型卡](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Blendshape%20V2.pdf)，第1页许可栏。
- [Multiclass Segmentation 模型卡](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Multiclass%20Segmentation.pdf)，第1页许可栏；作者 Adel Ahmadyan / Google，用于识别衣物类别，不承诺像素完美的边界。

Face Landmarker 官方指南将 FaceDetector、FaceMesh V2、Blendshape 三部分列入该任务包。模型来源与摘要也记录在 `public/models/manifest.json`，构建时复制进 `dist`。框架或模型的 Apache-2.0 许可不代表 Google 任意示例照片也采用同样许可。

## 真人示例素材

| 项目内位置 | 原作品与作者 | 许可及来源 | 本项目处理 |
| --- | --- | --- | --- |
| `public/demo/fashion-runway2.jpg` | 《Fashion runway2.jpg》，Kwaku Berko，摄影日期 2023-08-18 | **CC0 1.0 Universal**；[Wikimedia 原作品/许可页](https://commons.wikimedia.org/wiki/File:Fashion_runway2.jpg)、[原图下载](https://upload.wikimedia.org/wikipedia/commons/c/c4/Fashion_runway2.jpg)、[CC0 许可](https://creativecommons.org/publicdomain/zero/1.0/) | 本地重命名并用于关键点识别、覆盖和动作演示。作者和被摄者不为本项目背书 |

上述 CC0 照片是实际拍摄的时装展示素材。长裙、舞台灯光、背景人物等因素影响识别；v0.2 将它保留为复杂输入回归，不再在默认模式强制绘制服装。用户自行上传的照片不包含在此素材授权中。

新增 `public/demo/studio-model-v2.png` 是本次使用 OpenAI imagegen 生成的虚构成年模特图，用作清晰演示输入；应用明确显示「AI 示例」。它不是用户照片、真人摄影素材或 AI 换衣输出。生成提示与来源记录见 [生成素材记录](docs/generated-assets-v2.md)。

## MakeHuman 人台资产

`public/models/avatar-v2/atelier-body.glb` 基于 MakeHuman 官方 CC0 人体拓扑、骨骼、权重和服装辅助网格，经本项目用 Blender 修改、剪裁、蒙皮及导出。原始资产版权信息为 Data Collection AB、Joel Palmius、Jonas Hauquier；复用图形资产，不包含 MakeHuman 的 AGPL 应用代码。来源文件、处理过程和限制详见 [资产说明](public/models/avatar-v2/README.md)，随包保留 [CC0 全文](public/models/avatar-v2/LICENSE.ASSETS.md)。GLB SHA-256 为 `9ae7cbb509e8c1400d1978734707850248b32eac1da3190bba93b232474a7ad7`。

鞋履、配饰、图标、产品卡片、材质与程序动画由本项目实现。当前未打包 Mixamo、Tripo、Auto-Rig Pro、IDM-VTON、LivePortrait 或 MimicMotion 模型。FASHN 的可选适配器不含上游模型权重；选择远程服务需要单独配置，默认本机推理不会调用它。

## v0.4 本机生成模型与代码

| 项目 | 来源、许可与本项目修改 |
| --- | --- |
| CatVTON | [Zheng-Chong/CatVTON](https://github.com/Zheng-Chong/CatVTON)，Chong Zheng 等作者；代码与权重为 **CC BY-NC-SA 4.0**。[完整许可](/licenses/CatVTON-CC-BY-NC-SA-4.0.txt)。复用 attention 模块、预处理及去噪算法；本项目添加 CPU fp32 分阶段加载、顺序 CFG、人物局部裁切、区域合成、进度与取消。派生脚本 `scripts/vton-v4/infer.py` 采用相同许可。仅用于符合许可的非商业研究演示，不据此承诺商业运营授权。上游文件摘要在 `asset-sources/catvton-v4/source.json`。 |
| Stable Diffusion 1.5 Inpainting | [官方模型卡](https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-inpainting)，CreativeML OpenRAIL-M；[完整许可](/licenses/Stable-Diffusion-CreativeML-OpenRAIL-M.txt)。保留原始安全检查器，无网络生成回退。 |
| SD VAE ft-mse | [Stability AI 模型卡](https://huggingface.co/stabilityai/sd-vae-ft-mse)，模型卡标注 MIT。本地保留模型卡与来源，使用未修改权重。 |
| FASHN Human Parser | [官方模型](https://huggingface.co/fashn-ai/fashn-human-parser)、[代码仓库](https://github.com/fashn-AI/fashn-human-parser)；18 类 SegFormer-B4 人体与服装解析。模型继承 [NVIDIA SegFormer 许可](/licenses/SegFormer-NVIDIA.txt)，仅允许非商业用途。保留 [FASHN 代码许可](/licenses/FASHN-human-parser.txt)。本项目按官方 RGB / INTER_AREA 预处理调用本机模型，再生成遮罩，不用上下身比例猜测上衣边界。 |
| Thin Plate Spline Motion Model | [yoyo-nb 官方仓库](https://github.com/yoyo-nb/Thin-Plate-Spline-Motion-Model)，Copyright (c) 2021 yoyo-nb，MIT；[完整许可](/licenses/TPS-MIT.txt)。复用关键点、稠密运动和神经补全网络；本项目添加 CPU 流式编码、输入校验、相对运动幅度、取消与任务管理。TaiChi checkpoint 的来源和摘要见 `docs/motion-v4.md`。研究驱动视频不分发到 public/dist。 |
| Python 推理依赖 | PyTorch、TorchVision、Diffusers、Transformers、Accelerate、OpenVINO、NumPy、SciPy、Pillow、Safetensors、PyAV 等保留各安装包的原有许可；锁定清单在 `scripts/vton-v4/requirements.txt`、`scripts/motion-v4/requirements.lock.txt`。运行环境位于 `runtime`，不放入网页静态资源。 |

CatVTON、基础模型、VAE、人体分割的精确 revision、文件大小和 SHA-256 记录在 `scripts/vton-v4/models.lock.json`。这些模型不是本项目训练所得。首次换衣模型下载约 3.31 GB，完成摘要核验后才启用；权重、临时输入和用户结果均不作为公共静态文件提供。`asset-sources/catvton-v4/official-test-garment.jpeg` 只用于本地研究验证，不作为产品示例分发。

## Three.js 与 Vite 的 MIT 许可

Three.js:

Copyright © 2010-2026 three.js authors

Vite:

Copyright (c) 2019-present, VoidZero Inc. and Vite contributors

下列 MIT 条款分别适用于上述组件：

```text
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## MediaPipe Apache-2.0 许可

Copyright The MediaPipe Authors.  
模型作者与 Google 的具体署名见上面链接的官方模型卡。

以下保留 MediaPipe 官方仓库的许可文本（含该许可文件中的额外文件声明）。

~~~text
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.

===========================================================================
For files under tasks/cc/text/language_detector/custom_ops/utils/utf/
===========================================================================
/*
 * The authors of this software are Rob Pike and Ken Thompson.
 *              Copyright (c) 2002 by Lucent Technologies.
 * Permission to use, copy, modify, and distribute this software for any
 * purpose without fee is hereby granted, provided that this entire notice
 * is included in all copies of any software which is or includes a copy
 * or modification of this software and in all copies of the supporting
 * documentation for such software.
 * THIS SOFTWARE IS BEING PROVIDED "AS IS", WITHOUT ANY EXPRESS OR IMPLIED
 * WARRANTY.  IN PARTICULAR, NEITHER THE AUTHORS NOR LUCENT TECHNOLOGIES MAKE ANY
 * REPRESENTATION OR WARRANTY OF ANY KIND CONCERNING THE MERCHANTABILITY
 * OF THIS SOFTWARE OR ITS FITNESS FOR ANY PARTICULAR PURPOSE.
 */

~~~
