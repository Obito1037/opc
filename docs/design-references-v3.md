# 映身 v0.3 界面设计参考与实现记录

核验日期：2026-10-21。范围仅为 TryOnStudio；没有修改 Unity 游戏资源。

## 方向与实现

这轮采用 Apple 风格的克制界面：银灰底色、白色内容面板、蓝色交互重点、系统字体、22 px 左右的大圆角和细边框。照片、视频与人台是画面的主体，取消旧版绿色侧栏和巨大的英文背景字。设计为原创 CSS 实现，不声称是 Apple 官方组件或原生 Liquid Glass。

桌面使用顶部胶囊导航及三栏工作台，左侧编辑、中央预览、右侧选择单品；左右面板在内容较多时独立滚动。1440 × 900 视口下，顶部和导出按钮均可见。1050 px 以下衣橱改为第二行；760 px 以下采用单栏及底部导航。专注预览保留顶部退出入口。

本轮样式集中于 `src/studio-v3.css`，通过 CSS 自定义属性统一表面、文字、边线、重点色和主题。默认字号根据角色区分，不再依赖大面积装饰文字。操作反馈以 180–220 ms 的背景、边框和小幅位移动画为主，避免为每个卡片添加持续动画。深色主题不自动改变用户选定的陈列背景，预览区域文字根据珍珠白、深空灰、柔雾粉背景变化。

## GitHub 参考

| 项目与核验来源 | 核验结果 | 本项目采纳 | 未采纳 |
| --- | --- | --- | --- |
| [Radix UI Themes](https://github.com/radix-ui/themes)、[Theme overview](https://www.radix-ui.com/themes/docs/theme/overview)、[LICENSE](https://github.com/radix-ui/themes/blob/main/LICENSE) | WorkOS 的组件库；MIT，版权文件列明 2023 WorkOS。官方文档将色彩、圆角、阴影等组织为主题 token，并区分控件视觉层级。 | 采用语义 token 思路、不同按钮层级、分段控件和一致的亮暗主题；焦点与选中状态同时使用轮廓和颜色。 | 没有安装 React/Radix，也没有复制组件源码、图标或完整 CSS；现有项目为原生 JS，新增框架没有必要。 |
| [Vaul](https://github.com/emilkowalski/vaul)、[LICENSE.md](https://github.com/emilkowalski/vaul/blob/main/LICENSE.md) | React 抽屉组件；MIT，版权文件列明 2023 Emil Kowalski。核验时 README 明确标注项目不再维护。 | 参考小屏下将次要操作集中到独立覆盖层的交互思想；本项目仍以浏览器原生 dialog 呈现设置、收藏和指南，控制层有清楚的关闭入口。 | 没有引入 Vaul，没有实现或宣称具有 Vaul 的拖拽抽屉手势；不增加一个已标注停止维护的依赖。 |

以上为设计与架构参考，并非代码再分发。本轮没有把这两个项目打包到产品中，因此不会把它们写成已经安装的运行依赖。其他实际复用的 Three.js、MediaPipe、MakeHuman 等仍见项目第三方声明。

## Apple 官方指导

- [Layout](https://developer.apple.com/design/human-interface-guidelines/layout)：采用内容与控件分层、逻辑分组、对齐、适应屏幕尺寸的原则。衣橱截断的下一行与可见滚动条提示后面还有内容。
- [Motion](https://developer.apple.com/design/human-interface-guidelines/motion)：反馈短促且有目的，持续动态可暂停；减少动态时移除界面缩放和过渡。
- [Materials](https://developer.apple.com/design/human-interface-guidelines/materials)：透明材质只用于导航和对话框背景等有限位置；不以网页 GPU 折射特效仿造 Liquid Glass。

没有下载或分发 SF 字体文件、Apple 图标、Apple 商标或设计资源。字体栈优先使用设备已有字体，在 Windows 仍由本机 Segoe UI / Microsoft YaHei 等字体显示。

## 辅助使用与性能边界

- 支持 `prefers-reduced-motion`、应用内减少动态设置、`prefers-reduced-transparency` 和 `prefers-contrast`；键盘焦点有 3 px 明确轮廓。
- 自定义颜色使用真实的原生 color input；视觉表现为彩环按钮，并保留可访问名称和键盘焦点。
- 明暗模式、设置、分屏滑条、重命名收藏、撤销重做、专注预览的 CSS 已与实际 DOM 对齐。
- 透明效果以 CSS 为主，没有安装大型 UI 库。CSS 外观检查不能证明 3D 帧率提升；实际渲染性能由独立的引擎检查记录说明。
- 900 px 高度的桌面工作台仍需在左右面板内滚动查看全部衣橱和次要说明；较矮屏幕允许页面滚动。没有声称所有控件永远同时显示。
- 浏览器截图属于桌面 Edge 的尺寸模拟，不等于真实 iPhone / Safari 或屏幕阅读器验收。

## 截图证据

`test-results/v3-design/` 中记录开发态真实页面，未用图片生成替换产品截图：

- `desktop-final.png`：1440 × 900 浅色工作台。
- `dark-v3.png`：1440 × 900 深色界面，保持珍珠白陈列背景。
- `settings-v3.png`、`mobile-settings-v3.png`：设置对话框，含亮暗与性能选项。
- `mobile-light-v3.png`、`mobile-v3.png`：390 px 单栏布局；长截图中的底部导航固定在当前屏幕边缘。
- `photo-split-v3.png`：原图与效果分屏控件，使用已标注 AI 示例的本地样片。

早期 `desktop-initial.png` 保留了样式注入时机导致的旧界面，只是排查过程，不作为 v0.3 成品截图。最终发布以主任务重新构建后的生产地址验收为准。
