# Emil：修复后版本 UI/UX 独立复审

2026-10-28 · 源码 `ee6a98a624994e9f37c74383ea7887277a42bb43` · 扩展 2.5.0 · 官网候选 `focuence-site-58b4fca30c86`

**结论：本轮 UI/UX 复审不通过。** 注意力地图与当前聚焦的概念和默认信息结构已基本一致，上一轮的断点、关系证据和单页继续修复有当前证据支持；但核心地图的键盘探索、返回聚焦时的视口、其他编辑器的草稿退出，以及记录设置的生效反馈仍有必修缺口。

本报告记录 **4 项 P2 必修、1 项 P3 改进建议，未发现 P0/P1**。这是界面评审结论，不能作为 Chrome / Edge 商店官方审核结果，也不代表公网已经部署当前候选。

## 方法与独立性

本 agent 单独读取 `emil` 路由及 `emil-design-eng` Skill，按其组件、键盘、状态反馈、层级和交互连续性原则复审。读取了 `PRODUCT.md`、`DESIGN.md`、当前前端及共享组件源码；实际使用图片查看工具检查本次新截图，并以旧修复截图作回归参考。没有读取本次 Lama 报告或汇总，没有修改产品、提交、推送、部署或派发其他 agent。

浏览器由主线程统一操作，我提出具体补证流程后独立核对结果；独立性体现在审阅和判断，不能理解为两人分别操作过原生扩展。新证据见 [browser-observations.json](/Users/aitoshuu/Documents/GitHub/focuence/docs/reviews/ui-ux-2026-10-28/rereview/browser-observations.json)。范围和版本边界见 [CONTEXT.md](/Users/aitoshuu/Documents/GitHub/focuence/docs/reviews/ui-ux-2026-10-28/rereview/CONTEXT.md)。

## Before / After / Why

表中 Before 是本次观察到的当前行为；After 全部是尚未实施的建议。

| Before | After | Why |
| --- | --- | --- |
| E1 / P2：完整地图选中连线后焦点从 SVG 连线退到 `MAIN#main`，下个 Tab 回到时间范围。 | 建议：完成图形重建后把焦点还原到同一关系，或明确进入该关系的证据区，并保持连续的 Tab 顺序。 | 用户在核对同一组访问关系时不应反复从地图顶部重新走一遍。 |
| E2 / P2：断点编辑器会保护改动，新建/编辑任务及资料编辑器按 Esc 则直接退出，再开丢失草稿。 | 建议：这些有文字改动的编辑器沿用“继续编辑 / 放弃更改”的退出契约，或提供可见的草稿恢复入口。 | 目标、任务笔记、摘录和断点都是用户写下的工作线索，退出风险需要一致。 |
| E3 / P2：从滚动后的任务页进入地图，再回当前聚焦，继续沿用文档滚动偏移，当前聚焦区完全在视口上方。 | 建议：主导航进入新视图时展示其标题和当前对象；证据返回继续使用已有的精确对象定位。 | “回到当前聚焦”应让目标重新进入视线，不能只改变导航高亮。 |
| E4 / P2：关闭“记录前台浏览”的开关只改草稿，实际仍记录，未保存提示与保存按钮却在首屏之外。 | 建议：维持现有显式保存接口，把待保存状态和保存动作固定在可见处，并在记录开关旁说明保存后生效。 | 开关的视觉关闭状态容易被理解为已经暂停记录，需要就近区分草稿与实际状态。 |
| E5 / P3：在“已完成”筛选中新建任务，保存成功后仍是“0 个任务”和引导新建的空态。 | 建议：保存后提供“查看刚建任务 / 设为当前聚焦”动作；空态说明是筛选无结果，并可清除筛选。 | 用户需要知道刚才写下的目标去了哪里，避免重复创建或误认为保存失败。 |

## 必修项

### E1 · P2 · 完整地图键盘选边后丢失操作位置

**触发与事实：** 完整地图中聚焦“视觉创作 → 声音与硬件”的 SVG 关系，按 Enter。`map-edge-keyboard-before` 的焦点是该 `g.edge-control`；`map-edge-keyboard-after-enter` 已变成 `MAIN#main`；`map-edge-keyboard-next-tab` 落到 `SELECT#map-range`。关系确实被选中，失败的是随后键盘操作的连续性。

**用户后果：** 每次探索关系都会回到地图工具区，用户要重新穿过筛选、关系和主题才能到达证据。侧栏次数按钮选中后保持焦点，而完整地图没有保持相同行为。它发生在注意力地图的核心操作上，列为本轮过审阻塞项。

**定位：** [app/app.js:1091](/Users/aitoshuu/Documents/GitHub/focuence/app/app.js:1091) 选边后调用 `render()`；[app/app.js:767](/Users/aitoshuu/Documents/GitHub/focuence/app/app.js:767) 尝试同步找回旧 ID，但 [app/app.js:629](/Users/aitoshuu/Documents/GitHub/focuence/app/app.js:629) 要到下一帧才重建 SVG 子元素，随后回退焦点至 main。现有 [app/app.js:596](/Users/aitoshuu/Documents/GitHub/focuence/app/app.js:596) 的重绘保护只能捕获当前 wire 内仍存在的焦点，无法补回这次整块重建前的关系。

**证据：** [选边后截图](/Users/aitoshuu/Documents/GitHub/focuence/docs/reviews/ui-ux-2026-10-28/rereview/screenshots/map-edge-keyboard-after-enter.png)。对照记录 `panel-map-relation-360` 保持次数按钮焦点；`map-path-return-focus` 从路径返回后能聚焦原关系，说明之前修复的返回动作仍有效。

**通过条件：** Enter、Space 选边及后续尺寸重算后，焦点保持在选中关系或明确的证据落点；下个 Tab 不退回时间范围；两端证据和路径返回不回退。Enter 已复现，Space 应纳入修复后的验收。

### E2 · P2 · 目标与材料编辑的退出保护仍不一致

**触发与事实：** 在新建任务写入名称、目标、备注后按 Esc，再次新建，`workbench-task-new-reopen` 的三个字段全空。编辑已有任务再退出，`workbench-task-edit-reopen` 显示的是原保存内容，刚写的目标与备注没有保留。资料库“粘贴摘录”写入标题、来源、原文、笔记后按 Esc 再打开，`library-draft-reopen` 四字段全空，原文及笔记计数从 12 回到 0。没有放弃确认或可见恢复入口。

**用户后果：** 用户刚在断点界面学到“Esc 可安全退出并确认是否放弃”，转到目标或研究笔记时却直接丢失这次输入。已保存内容仍存在，丢失的是尚未保存的编辑线索。这与以目标、笔记和接续为核心的产品用途直接相关。

**定位：** 任务编辑 [app/app.js:803](/Users/aitoshuu/Documents/GitHub/focuence/app/app.js:803) 清除取消钩子，[app/app.js:838](/Users/aitoshuu/Documents/GitHub/focuence/app/app.js:838) 从保存值重建表单，[app/app.js:1180](/Users/aitoshuu/Documents/GitHub/focuence/app/app.js:1180) 在非忙碌状态下允许 Esc 默认关闭，并在 close 清理 editor。资料编辑 [src/library-ui.js:17](/Users/aitoshuu/Documents/GitHub/focuence/src/library-ui.js:17) 只检查 busy，[src/library-ui.js:31](/Users/aitoshuu/Documents/GitHub/focuence/src/library-ui.js:31) 每次打开重置 form。已修断点的可参考行为在 [src/task-memory-ui.js:89](/Users/aitoshuu/Documents/GitHub/focuence/src/task-memory-ui.js:89)。

**证据：** [目标草稿](/Users/aitoshuu/Documents/GitHub/focuence/docs/reviews/ui-ux-2026-10-28/rereview/screenshots/workbench-task-new-draft.png)、[材料退出前](/Users/aitoshuu/Documents/GitHub/focuence/docs/reviews/ui-ux-2026-10-28/rereview/screenshots/library-draft-before-escape.png)、[材料重开](/Users/aitoshuu/Documents/GitHub/focuence/docs/reviews/ui-ux-2026-10-28/rereview/screenshots/library-draft-reopen.png)，字段值见上述同名观察记录。

**通过条件：** 新建与编辑任务、材料在有改动时，Esc 和关闭均提供明确放弃或恢复；无改动可直接退出；继续编辑保持文字和原焦点，保存失败仍可重试。这里要求编辑器内部的退出保护，没有要求新增跨进程持久草稿。

### E3 · P2 · 主导航返回聚焦后，当前目标仍在屏外

**触发与事实：** 在完整页任务列表滚动到 `window.scrollY=1203`，用侧边导航进入地图，再返回当前聚焦。`navigation-window-deep-to-map` 的窗口偏移为 370，地图标题 top 为 -255；`navigation-window-return-focus` 仍为 370，当前聚焦块 top=-161.60、bottom=-42.91，整个块都在视口上方。导航虽高亮“当前聚焦”，首屏只看见任务列表的中间内容。

**用户后果：** 主线入口不能可靠地把用户带回当前目标。用户从地图回到工作时需要自己向上找一次，不符合“目标留在视线里”的接续逻辑。

**定位：** [app/app.js:779](/Users/aitoshuu/Documents/GitHub/focuence/app/app.js:779) 导航只改 view/hash 并重绘、刷新，没有设置新视图的滚动落点。完整页由文档滚动；只有 [app/styles.css:349](/Users/aitoshuu/Documents/GitHub/focuence/app/styles.css:349) 的侧栏 main 是内部滚动区。早期 navigation-deep 前缀记录中的 main.scrollTop=0，不能作为深滚动验收证据，本项只引用后续实际测量 windowScroll 的记录。

**证据：** [进入地图后的视口](/Users/aitoshuu/Documents/GitHub/focuence/docs/reviews/ui-ux-2026-10-28/rereview/screenshots/navigation-window-deep-to-map.png)、[返回聚焦后的视口](/Users/aitoshuu/Documents/GitHub/focuence/docs/reviews/ui-ux-2026-10-28/rereview/screenshots/navigation-window-return-focus.png)。侧栏对照 `panel-deep-return-focus` 的 mainScroll=10、当前块 top=213.5/bottom=466.7，仍在视口内；不把完整页缺陷扩大为侧栏已失败。

**通过条件：** 从深列表经主导航进入聚焦或地图，标题、当前目标或地图控制进入视口；侧栏按实际内部滚动区验证；关系证据的返回定位继续准确。

### E4 · P2 · 浏览记录开关没有就近表达“尚未生效”

**触发与事实：** 默认设置页把“记录前台浏览”切为关闭。`settings-tracking-toggled-unsaved` 中 checkbox=false，侧边动作仍为“暂停记录”，实际设置尚未保存；待保存提示和按钮位于 y=1334.76，超过 950px 视口。当前视口没有显示“保存后生效”或待保存状态，只有已经变灰的开关。

**用户后果：** 用户可能把视觉关闭理解成已暂停，而实际记录设置仍开启。这是状态表达和控制反馈问题，不是要求改变显式保存的数据接口。不能据 demo 断言发生了真实浏览采集，但源码确认只有保存后才发送设置更新。

**定位：** [app/app.js:708](/Users/aitoshuu/Documents/GitHub/focuence/app/app.js:708) 的记录开关描述直接写暂停效果；[app/app.js:960](/Users/aitoshuu/Documents/GitHub/focuence/app/app.js:960) 只收集 settingsDraft；[app/app.js:717](/Users/aitoshuu/Documents/GitHub/focuence/app/app.js:717) 把唯一保存区放在后续本地智能区底部；真正请求发生在 [app/app.js:1092](/Users/aitoshuu/Documents/GitHub/focuence/app/app.js:1092)。

**证据：** [开关关闭后的首屏](/Users/aitoshuu/Documents/GitHub/focuence/docs/reviews/ui-ux-2026-10-28/rereview/screenshots/settings-tracking-toggled-unsaved.png)、[滚动后才出现的保存区](/Users/aitoshuu/Documents/GitHub/focuence/docs/reviews/ui-ux-2026-10-28/rereview/screenshots/settings-pending-save-control.png)。

**通过条件：** 更改后能在当前视口理解“实际仍记录、这次更改待保存”，并能完成保存；成功后开关、真实记录状态和反馈一致，失败时仍明确未生效。可使用固定保存条和就近说明完成，无需增加动效。

## 改进建议

### E5 · P3 · 筛选中的空态与保存成功缺少衔接

`workbench-completed-filter-empty` 选“已完成”后列表为空，界面仍说“先给眼前的事一个目标”。在这个空态新建任务并保存，`workbench-filter-create-result` 仍为“0 个任务”，只短暂提示保存成功；改为全部任务后 `workbench-filter-create-task-exists` 才看见刚创建的目标。

源码 [app/app.js:378](/Users/aitoshuu/Documents/GitHub/focuence/app/app.js:378) 同时过滤任务，但 [app/app.js:387](/Users/aitoshuu/Documents/GitHub/focuence/app/app.js:387) 只根据文本 query 选择空态，没有区分状态筛选；[app/app.js:882](/Users/aitoshuu/Documents/GitHub/focuence/app/app.js:882) 保存后也没有定位创建对象。[截图](/Users/aitoshuu/Documents/GitHub/focuence/docs/reviews/ui-ux-2026-10-28/rereview/screenshots/workbench-filter-create-result.png) 可见筛选仍为已完成，导航总数为 4 而列表为 0。

建议区分“还没有任务”和“此筛选无任务”，保存后提供查看新任务的入口，接着由用户显式设为当前聚焦。它不丢保存数据，清除筛选可恢复，故列 P3；这一项单独存在时不阻塞本轮通过。

## 已达到的主线与修复回归

| 检查点 | 当前判断与证据 |
| --- | --- |
| 三端默认当前聚焦，地图相邻 | 通过结构检查。`popup-default-focus`、`panel-default-focus-320`、`workbench-default-focus` 均呈现同一主线；完整导航没有再用回顾代替默认目标。 |
| 当前目标与单页继续优先 | 通过当前截图检查。[320px 已选择聚焦](/Users/aitoshuu/Documents/GitHub/focuence/docs/reviews/ui-ux-2026-10-28/rereview/screenshots/panel-selected-focus-320.png) 中目标和继续动作可见；批量恢复保持次级、标明总页数。导航深滚动问题另列 E3。 |
| 断点退出和保存 | 本次普通断点通过。Esc 显示继续编辑/放弃，继续编辑回到 `checkpoint-nextStep`，保存后显示“已确认断点”并回原触发按钮。证据为 `popup-checkpoint-exit-guard`、`popup-checkpoint-keep-editing`、`popup-checkpoint-save-result`。其他编辑器缺口另列 E2。 |
| 地图关系 → 同次两端记录 → 原关系 | 通过这条例证。`map-relation-exact-path` 同时显示 09:42–09:45 摄影参考和 09:45–09:49 ESP32 文档，并标明先访问/接着访问；`map-path-return-focus` 回到原 g。没有把单主题列表冒充两端证据。普通选边焦点另列 E1。 |
| 主题、任务、分组边界 | 源码与文案通过。就近说明把内容分类、用户目标和浏览器组织分开；官网也解释安装后从当前聚焦选择任务，地图用于回看。地图主题与当前任务无需同名，不要求用目标覆盖主题。 |
| 地图的事实口径 | 通过当前可见文案检查。访问先后、观察次数、样本较少和前台时长都有说明，未把时间当完成度或心理注意力。 |
| 官网目标—断点—继续 | 新证据 `site-goal-checkpoint-resume` 支持示例输入、保存和继续；四个主题的切换有 `site-map-theme-selection-and-metrics`，没有把示例当作扩展真实状态。 |
| 窄屏阅读与表单提交 | 本次 320/390 官网地图的次数及节点元信息均为 12px，未见横溢或单位拆散；400×520 新任务固定提交区可见。320/360 侧栏主线和关系保持可读。 |
| 基础界面与动效 | 中性工作面、正文层级、选择蓝色和统一选择框方向一致。键盘问题应通过正确落点解决，本轮没有理由为了过审添加装饰动画或重做视觉风格。 |

## 通过门槛与未验证范围

本轮需要关闭 E1–E4，再对各项通过条件做当前版本回归，才能给出完整 UI/UX 通过结论；E5 是清晰度改进。当前可以认可主线和主要修复方向，不能把前序测试通过直接替代这些新发现的行为验收。

所看扩展交互为现有 `?demo=1` 合成模式，页面时钟固定到当天 13:00 以显示上午夹具，不读取私人标签或历史。未实测原生工具栏关闭生命周期、真实数据库/模型/权限、屏幕阅读器和触摸真机；没有据桌面截图声称这些载体已通过。此次判断对象是本地修复候选，公网旧版本与商店状态均未用作本报告的过审依据。
