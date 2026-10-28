# Lama 独立复审：第二轮 UI/UX 修复

2026-10-28。**结论：本轮 UI/UX 通过。RR1–RR5 的 5 项 P2、RR6 的 1 项 P3 均已关闭；未发现需要阻止本轮提交的直接回归。** 此结论针对修复工作区及本轮前端交互范围，不代表商店过审、稳定版发布或公网部署验收。

## 审阅方法与版本

本评审由独立子 agent 完成，读取了 [Lama 路由](</Users/aitoshuu/.codex/skills/lama/SKILL.md>) 和其指定的 [Appllama 设计技能](</Users/aitoshuu/.cc-switch/skills/appllama-app-design-skill/SKILL.md>)。采用信息层级、导航语义、编辑状态、可恢复操作及窄屏布局原则；本项目是浏览器工作工具，不把 Expo、iOS 导航或原生控件要求套入现有 HTML/CSS/JavaScript。

核对资料为 [产品契约](../../../../PRODUCT.md)、[设计契约](../../../../DESIGN.md)、[六项修复计划](../../../plans/2026-10-28-002-fix-focus-map-rereview-plan.md)、[共同采证范围](CONTEXT.md)、当前源码和 [浏览器记录](browser-checks.json)。没有读取本轮 Emil 报告或主线程汇总结论，也没有修改产品。

被审版本为 `ee6a98a` 基础上尚未提交的修复工作区。已独立计算并核对 [source-snapshot.json](source-snapshot.json) 中 10 个文件的 SHA-256，全部一致。没有把旧提交的实现视作此次修复结果。浏览器由主线程统一操作，本评审独立阅读 DOM/交互记录并实际查看 14 张正式新截图；没有声称自行操作了原生扩展宿主。

## 六项核验

| 项目 | 结果 | 当前行为与 UI/UX 判断 | 源码与证据 |
| --- | --- | --- | --- |
| RR1 / P2 草稿退出保护 | 关闭 | 任务新建/编辑、材料编辑和弹窗保存页有改动时，Esc、关闭、取消或返回先显示同一编辑器中的选择；“继续编辑”恢复原字段与文字选择，“放弃更改”才退出。未改动可直接退出。材料类型重绘不重置初始草稿基准；保存失败保留输入，可重试。保护语义与既有断点编辑一致。 | [draft-guard.js](../../../../src/draft-guard.js) 4–45 行；[app.js](../../../../app/app.js) 820–824、899–935、1226–1233 行；[library-ui.js](../../../../src/library-ui.js) 18–35、57–71 行；[popup/app.js](../../../../popup/app.js) 211–218、269、295–298 行。记录 `RR1-task-edit-keeps-text-selection` 实际保留选择 2–6；`RR1-library-kind-redraw-exit-guard`、创建/更新失败与重试记录均可对照。[400×520 弹窗](screenshots/RR1-popup-escape-guard-520.png)、[320 侧栏](screenshots/RR1-panel-draft-guard-320.png)、[材料重绘后退出](screenshots/RR1-library-kind-redraw-exit-guard.png) 可见保护选择，无横向溢出。 |
| RR2 / P2 新任务可见性 | 关闭 | 无匹配时解释筛选，而不是把已有任务库说成空库。保存后清除挡住对象的状态和文字筛选，显示并聚焦对应任务卡，保留明确的“设为当前聚焦”。保存本身没有改变当前窗口意图，避免“创建成功却找不到”和“保存就自动开始”两种歧义。编辑成功也定位原对象。 | [task-memory-ui.js](../../../../src/task-memory-ui.js) 404–409 行；[app.js](../../../../app/app.js) 361–388、915–922、1091 行；[popup/app.js](../../../../popup/app.js) 329–334 行。采用 `RR2-final-created-completed/waiting/archived` 及 `RR2-final-created-identities-unique`：三次 ID 不同，焦点落到对应 ARTICLE；`RR2-popup-created-visible`、`RR2-panel-created-visible` 覆盖另外两端。[完成筛选下的新任务](screenshots/RR2-final-created-completed.png) 显示全部筛选、成功反馈与显式聚焦动作。 |
| RR3 / P2 地图键盘焦点 | 关闭 | Enter、Space 选择 SVG 关系后仍聚焦同一稳定关系 ID；下一 Tab 继续到图中的主题，不回到日期控件。尺寸重绘与从路径返回也保留关系。恢复仅在焦点落回 BODY/main 时执行，不抢走用户已移到别处的焦点。切换到没有该关系的范围时，明确解释上下文变化。 | [app.js](../../../../app/app.js) 559、595–640、746–798、1126–1136 行。`RR3-map-enter-keeps-edge`、`RR3-map-space-keeps-edge`、`RR3-map-tab-continues`、`RR3-map-resize-keeps-edge`、`RR3-map-return-keeps-relation`；侧栏真实 BUTTON 也有 `RR3-panel-relation-keeps-button`。[键盘选中关系](screenshots/RR3-map-enter-keeps-edge.png) 与对应 DOM 焦点相符。 |
| RR4 / P2 主导航落点 | 关闭 | 完整页重置文档滚动，侧栏重置 main 滚动，异步读取后仍保持视图起点。长页面回到当前聚焦能看到当前目标及“继续一页”；进入地图能看到标题、范围与说明。关系例证的返回仍执行精确对象定位，没有被通用回顶覆盖。 | [app.js](../../../../app/app.js) 801–817、1126–1131 行。`RR4-deep-scroll-setup` 后完整页由 1089.5 回到 0；`RR4-panel-deep-scroll-setup` 后侧栏 main 从 1325.5 回到 0；`RR4-settings-to-focus-start` 覆盖设置深滚动后的返回。[完整页落点](screenshots/RR4-return-current-visible.png)、[360 侧栏落点](screenshots/RR4-panel-return-current-visible.png) 当前区和操作均可见。 |
| RR5 / P2 设置生效反馈 | 关闭 | 开关表示待保存值，旁边文字明确当前实际生效状态；顶部 sticky 保存区也显示“更改待保存 · 当前生效”。窄屏无需依赖开关下方的不可见说明。保存中有状态并锁定设置控件；失败仍显示未保存、原生效值与可用重试动作；成功后状态、开关和反馈一致。 | [app.js](../../../../app/app.js) 705–733、771、1000–1016、1137–1144 行；[styles.css](../../../../app/styles.css) 301–304、476 行。[最终桌面图](screenshots/RR5-desktop-current-state-final.png)、[最终 390 窄屏图](screenshots/RR5-sticky-current-state-narrow-final.png) 同时呈现保存动作和当前生效配置。`RR5-saving-locks-controls`、`RR5-desktop-failure-can-retry-final`、`RR5-save-bar-stays-visible-deep`、`RR5-final-failure-state`、`RR5-final-save-state` 覆盖中间状态与深滚动。 |
| RR6 / P3 时长口径 | 关闭 | 完整图和局部图都在关系内容前可见地说明“时长为分摊后的前台记录，不等于实际注意力”。这补齐了官网、地图和路径的共同边界，时长没有被表达成专注分数、完成度或任务价值。 | [app.js](../../../../app/app.js) 680–686 行。[完整图](screenshots/RR6-desktop-map-caption-final.png)、[320 侧栏图](screenshots/RR6-panel-map-caption-320.png) 文字可读，不遮挡范围选择和关系操作；[官网 320 示例](screenshots/website-unchanged-map-320.png) 沿用相同口径，页数和分钟单位正常。 |

## 注意力地图与聚焦主线

主线在当前实现中成立：地图解释已经观察到的去向，任务决定眼前要推进的事，确认断点承载下一步和继续页面，“继续一页”是直接接续动作。

- 地图关系回看保留同一次切换的两个端点。`map-exact-two-endpoints` 与[路径截图](screenshots/map-exact-two-endpoints.png) 同时显示 09:42 的摄影参考和 09:45 的 ESP32 文档，以及“返回所选地图关系”。没有退化成仅回看目标主题、遗漏来源页面的流程。
- 新目标保存后仍未开始聚焦；`focus-flow-saved-without-autostart` 记录当前区为空，再经用户显式选择、确认断点和继续页面，形成[完整接续状态](screenshots/focus-flow-goal-checkpoint-continue-one.png)。目标、已确认下一步、继续页面与“继续一页”的阅读顺序清楚。
- 三端继续使用“当前聚焦 / 注意力地图”这组对应入口。任务管理和批量恢复仍可找到，视觉优先级低于当前目标与单页继续。主题、任务和浏览器分组的说明没有被新的保存或筛选行为推翻；暂停窗口聚焦与暂停浏览记录也仍是各自独立的操作。

这些判断结合实际图像、交互记录和源码，未以“测试通过”替代 UI/UX 判断。本轮没有确认新的 P1/P2/P3 必修 finding，也没有用个人装饰偏好增加通过门槛。

## 证据解释与验收边界

原始 `RR3-range-removal-has-honest-fallback` 的失败断言已单独核对：该步没有先聚焦日期控件，却期待它拥有焦点。最终 `RR3-range-user-control-focus-final` 先聚焦再操作，正确保留日期控件焦点，并解释原主题/关系缺失；不能把旧断言继续计作产品缺陷。RR2 最初固定时钟造成的 demo ID 重复也不能代替最终三次独立 ID 的结果。

保存失败样本来自临时合成错误夹具，证明前端保留草稿、区分生效状态并提供重试，不证明真实磁盘或后台故障已全面覆盖。截图覆盖桌面、320/360 侧栏、400×520 弹窗与 390 窄完整页；每个交互不代表在每个尺寸都做了全排列测试。

没有重新实测原生工具栏弹窗被宿主销毁、原生侧栏生命周期、屏幕阅读器、触摸真机、真实权限与模型。共享草稿保护是编辑器内退出保护，不是跨关闭持久保存。官网源码未变，本轮仅对本地候选补查 320 示例，未验证新部署或商店审核状态。既有后台检索及返回提示问题继续属于已记录的其他范围，不因本次 UI/UX 通过而关闭。

**本轮通过条件已满足：六项必修关闭，注意力地图 → 当前聚焦 → 确认断点 → 继续一页的职责与交互保持一致，没有发现本次改动引入的阻塞回归。**
