# 可复现资产与验收

从工作区根目录运行：

```powershell
& 'C:\Users\20665\Desktop\game\tools\blender-4.5.14-windows-x64\blender.exe' --background --factory-startup --python-exit-code 1 --python TryOnStudio/asset-sources/avatar-v2/build_avatar.py
```

输出写到 `TryOnStudio/public/models/avatar-v2/atelier-body.glb`。源 Blender 文件与人体轮廓数据保留在本目录。原始 `base.obj`、`default.mhskel`、`default_weights.mhw` 来自 MakeHuman 官方仓库，CC0 许可与原始链接见公开模型目录中的 README 和 LICENSE.ASSETS.md。

开发测试：在项目目录运行 `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5176 --strictPort`，然后从工作区根目录运行 `node TryOnStudio/tests/avatar-v2/qa.cjs`。QA 脚本使用本机已经安装的 Playwright 与 Edge。正式发布目录无需包含本目录、测试页面或截图。

当前验证覆盖：本地 GLB 完整加载、三款可换上装、长裤、17 骨骼、暂停像素稳定、漫步像素变化、挥手、背面转身、眼镜与靴子，以及关闭服装后保留不透明基础内搭。六张浏览器截图已人工查看，修复过掌骨错误映射、脚趾穿鞋、靴筒穿小腿和连衣裙腰部断开。

原版本界面截图：项目 `test-results/studio-desktop.png`（首次原型证据）；本目录 `avatar-v1-reference.txt` 为原版本渲染器备份。新图在 `test-results/avatar-v2/`。新旧图未采用严格冻结同机位条件，因此用于理解资产变更，不作为定量画质结论。
