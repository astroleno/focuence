# Taste review · 插件形态

2026-10-22。按用户要求仅做一轮实施前评审；实施后的截图属于功能与视觉验收，不增加评审轮次。评审人即本任务执行者，未启动独立评审 agent。

使用 `design-taste-frontend` 的截图观察、层级、字体、留白与视觉纠错方法。该 skill 的适用范围原为展示网站，本轮按浏览器插件调整：不要求营销大图、夸张标题或八处入场动效。原生表单、数据表、导航与真实分组卡允许保留功能性边界。

```text
ROUND 1
Seen in one second: 弹窗里的浏览时长；完整页里的大标题与统计，实际操作退居其次。
Idea (one sentence): 从当前页面接回下一步，让分组、任务和回顾形成连续路径。
Live thing: 当前窗口的页面、可应用的分组、可接回的任务。
Layout words by section: popup=概况/页面列表/跳转；workspace=侧导航/大页头/统计/双栏列表。
Scores: design 6.0 · usability 5.5 · creativity 6.0 · content 7.0 → overall 6.0
Caps applied: 真实小文字与对比度问题；不套用营销网站的图片、影片和入场动效上限。
Top three problems (most visible first), each with the screenshot it shows in and the fix:
1. 弹窗最大动作是「打开任务工作台」，快速整理自身也需要跳转。改为在弹窗预览并应用分组、保存与恢复任务，侧栏作可选持续入口。
2. 390px 完整页中，导航、示例说明、页头和统计占用约 760px，第一条页面仅在底部露出。新增独立侧栏 shell，缩减重复说明，优先显示任务和路径。
3. 辅助文字集中在 8–11px，域名、隐私说明等对比约 2:1–2.6:1。统一为可读字号和深色辅助文字，采用中性底与深绿强调，明确唯一主动作。
```

## 本轮证据

当前代码未改动时，使用隔离的 Chrome for Testing 156 运行 skill 的 lint 与 inspector。截图覆盖弹窗 390px、完整页 1440/768/390px，并实际查看了各宽度首屏和完整页接续截图。

- 弹窗 inspector：4 FAIL、2 WARN。实际问题包括小文字、低对比度；将数据字段名判为营销 eyebrow、将功能分隔判为装饰的结果，仅作适用性说明。
- 完整页 inspector：9 FAIL、5 WARN。小文字、对比度、窄屏层级问题采纳；图片数量、视频、大标题占比、八处动效与插件职责无关。
- 源码 lint：29 FAIL、14 WARN，主要为边框、阴影、背景纹理等营销风格规则。实施时删减重复边框与背景纹理，保留必要的表单/弹层语义。
- 示例截图只证明渲染与交互布局，不证明原生扩展接口可用。原生插件流程在实施后的隔离浏览器验证中另列。

截图与完整自动检查输出随本轮交付保存在评审附件中。实施范围、接口和验收见 [V2_EXTENSION_SURFACES.md](V2_EXTENSION_SURFACES.md)。
