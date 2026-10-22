# 映身 v2 立体服装陈列人台

`atelier-body.glb` 为 MakeHuman 官方 CC0 人体基础拓扑、骨骼关节位置、蒙皮权重与服装辅助网格的派生资产。角色是通用陶瓷陈列人台，不是用户照片重建，也不输出真实尺寸或合身结论。

来源：

- [MakeHuman 官方资产许可说明](https://github.com/makehumancommunity/makehuman/blob/master/LICENSE.md)
- [CC0 1.0 Universal 全文](https://github.com/makehumancommunity/makehuman/blob/master/LICENSE.ASSETS.md)，本目录保留 `LICENSE.ASSETS.md`。
- [base.obj 人体与服装辅助拓扑](https://github.com/makehumancommunity/makehuman/blob/master/makehuman/data/3dobjs/base.obj)
- [default.mhskel 官方骨骼](https://github.com/makehumancommunity/makehuman/blob/master/makehuman/data/rigs/default.mhskel)
- [default_weights.mhw 官方蒙皮权重](https://github.com/makehumancommunity/makehuman/blob/master/makehuman/data/rigs/default_weights.mhw)

原始资产版权信息：Data Collection AB、Joel Palmius、Jonas Hauquier。`base.obj` 文件头明确记载 2020 年 9 月发布为 CC0；权重及骨骼文件中也声明 CC0。这里复用的是图形资产，没有复制 MakeHuman 的 AGPL 应用代码。只使用上述官方仓库随附资产，未引入社区第三方服装。

改造内容：使用 Blender 4.5.14 将原始 A 姿态变为自然站姿，合并至 17 根展示骨骼，保留连续人体表面；从服装辅助网格剪裁、放松、细分、加厚并蒙皮得到短袖、长袖外套、连衣裙与长裤。鞋履、配饰、材质及动作逻辑为本项目制作。动作是程序骨骼动画，不宣称动作捕捉或布料物理仿真。关闭服装覆盖仍保留不透明上衣与长裤。

运行时 GLB 约 5.75 MB，身体包含 45,208 个顶点。绑定时最多保留四个骨骼影响并归一化。鞋履及配饰随关节运动；裙装步幅有意减小。上传照片不贴到此人台头部，`setPhoto()` 返回 false。

可复现源文件在项目 `asset-sources/avatar-v2/`，截图及验证报告在 `test-results/avatar-v2/`；QA 页面与脚本在 `tests/avatar-v2/`，不会进入 Vite 的 `public` 资源包。

局限：这是设计搭配示意，服装款式与身体比例为通用示例。没有真人身份保持、服装商品扫描、真实布料解算或经过实机验证的手机帧率保证。
