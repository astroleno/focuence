# DeepSeek Harness 独立评审原文

2026-10-24；代码基准 `4c7ff64bcfe6eaddcfb4fc6942a8a00e32bbde8c`（main，2.5.0）。工具版本 0.2.1-rc.2，沿用本机模型选择。使用现有本地安装和已有凭据，仅在本次启动中启用凭据读取；未改全局配置。

首次调查未及时收敛后，主线程中断并通过同一 session 续写，要求只汇总已调查内容。没有提供其他 reviewer 的结论。以下保留最终原文；主线程逐项复核见 [复核记录](README.md)。没有执行产品修复。

---

# Focuence 2.5.0 独立评审

- 仓库：`/Users/aitoshuu/Documents/GitHub/focuence`
- 分支/提交：`main` @ `4c7ff64bcfe6eaddcfb4fc6942a8a00e32bbde8c`
- 版本：`2.5.0`
- 评审日期：2026-10-24
- 评审性质：独立、只读评审；未读取其他 reviewer 的结论，未调用其他 agent、浏览器、MCP 或外部来源。

## 1. 范围和方法

阅读了 `PRODUCT.md`、`README.md`、`DESIGN.md`、`docs/DATA_AND_ARCHITECTURE.md`、`docs/V2_EXTENSION_SURFACES.md`、`docs/plans/2026-10-23-001-feat-task-memory-attention-plan.md`、`docs/plans/2026-10-23-002-feat-browser-workspace-memory-plan.md`，并追踪了以下链路：

- 注意力记录与地图：`src/activity.js`、`src/analytics.js`、`src/map-layout.js`、`background.js`、`app/app.js`、`popup/app.js`、`src/ui.js`。
- 当前任务、断点与返回：`src/focus-support.js`、`src/task-patterns.js`、`src/task-context.js`、`src/checkpoints.js`、`src/task-memory-ui.js`、`src/workspace.js`。
- 辅助能力：`src/store.js`、`src/backup.js`、`src/tab-workspace.js`、`src/tab-operations.js`、`src/browser-history.js`、`src/search-sources.js`、`src/memory-search.js`、`src/library.js` 及对应 UI/测试。

排除：`node_modules`、`vendor`、`models`、`dist`、`.git`、`docs/reviews/v2.5/core-review-2026-10-24/`、`.review-work/` 及其他项目。未修改任何文件、未建分支/worktree、未安装依赖。工作区原有截图删除和 `docs/reviews/v2.5/README.md` 修改未动。

实际运行了现有纯逻辑测试，并用 Node 做了少量针对本报告的静态探针；未运行浏览器、MV3、IndexedDB 迁移、真实模型或 native 测试。

---

## 2. 结论摘要

注意力记录状态机和地图聚合的主口径总体是克制的：心跳不重复累计、失焦/暂离/缺测/重启不伪装成前台时长、地图边只表达主题先后、节点尺寸不编码时长、局部图保留未展开数量和关系表。这些都与 `DESIGN.md` 的地图契约基本一致。

但当前版本存在一个高影响的支持链路缺陷：**任何例行观察/心跳都会推进数据代次并把所有检索/关联任务标记为过期**。这会让“分析关联”“语义分组”“语义找回”在正常刷新或 30 秒心跳后自我取消，属于 P1。

此外，多窗口的注意力上下文没有收口到请求窗口，可能把窗口 A 的返回提示显示在窗口 B 且无法操作；任务编辑中的“取消删除”会关闭编辑器并丢失草稿；排除站点没有进入自动继续线索的过滤。辅助能力本身的数据模型基本支持核心，但共享代次和候选过滤的缺口会反向破坏核心体验。

| ID | 级别 | 置信度 | 主题 |
|---|---|---|---|
| CORE-01 | P1 | 高 | 心跳/GET_STATE 推进 dataEpoch，异步记忆任务自我失效 |
| CORE-02 | P2 | 高 | 多窗口下返回提示和继续线索未按请求窗口收口 |
| CORE-03 | P2 | 高 | 取消删除任务后编辑器被关闭，草稿丢失 |
| AUX-01 | P2 | 中高 | 排除站点未进入自动继续线索过滤 |
| CORE-04 | P3 | 高 | 地图的失效对象提示在恢复后仍残留 |
| CORE-05 | P3 | 高 | 返回提示在“返回/标相关”成功前就记为已处理 |
| CORE-06 | P3 | 高 | 顶栏不显示 idle/unfocused/clock warning，记录状态可能误导 |
| CORE-07 | P3 | 高 | 断点页不在当前列表时，编辑断点会静默清空继续页 |
| AUX-02 | P3 | 高 | 分组撤销是全局“最近一次”，多窗口可撤错窗口 |

---

## 3. Findings（代码与行为缺陷）

### CORE-01 [P1] 每次观察/心跳都推进 `dataEpoch`，关联、语义分组和语义检索被自我失效

**置信度：高**

**证据与调用链：**

- `background.js:59-66` 的 `applyActivity()` 在 `result.segments.length` 为真时调用 `workspace.invalidate()`。
- `src/activity.js:196-210`：每次 `context`/`heartbeat` 只要当前片段仍打开，就会把同一个 open segment 以 `endReason: 'checkpoint'` 推入 `segments`。也就是说，**心跳一定产生一个 segment 快照**。
- `background.js:89-93` 的 `recordCurrent()` 每次都会调用 `applyActivity()`。
- `background.js:291-292` 的 `GET_STATE` 每次先 `queueActivity(recordCurrent)`；`background.js:573` 的 `focuence-checkpoint` 每 30 秒调用 `reconcile()`，同样走 `recordCurrent()`。
- `src/workspace.js:83-90` 的 `invalidate()` 会调用 `deps.invalidate()`，并把所有 job 标记为 `stale`、清空 `results/candidates/scores/queryVector`。
- `background.js:113`：`deps.invalidate()` 的实现是 `dataEpoch++`。
- `src/workspace.js:318-321`：`advanceJob()` 发现 `job.epoch !== deps.epoch()` 就把 job 标为 `stale`。
- `src/task-memory-ui.js:196-201`：关联分析每处理完一批就 `await refresh()`，而 `refresh()` 会触发 `GET_STATE → recordCurrent → dataEpoch++`，因此关联任务通常在第一批之后就被判 stale。
- `src/task-memory-ui.js:220-222`：检索页用 `work().epoch > searchEpoch` 判断结果过期，因此下一次侧栏刷新就可能把刚完成的结果清空。
- `app/app.js:891-898` 的 `pollModel()` 每 1.4 秒 `refresh()`；`popup/app.js:228` 语义分析期间每 1 秒 `refresh()`。两者都会在推理过程中推进 epoch，导致 `infer()` 的 epoch 校验失败。

**触发步骤：**

1. 正常浏览一个 HTTP(S) 页面，保持前台。
2. 等待 30 秒心跳，或切换到侧栏/完整页触发 `GET_STATE`，或让弹窗的语义分析计时器刷新。
3. `recordCurrent → applyActivity` 收到一个 `endReason: 'checkpoint'` 的 segment。
4. `workspace.invalidate()` 把所有 job 置 stale，并 `dataEpoch++`。
5. 正在进行的 `SUGGEST_TASK_PAGES`、`SEARCH_MEMORY`、`PROPOSE_GROUPS` 的后续批次看到 epoch 不一致，返回 stale 或“本机语义分析已取消”。

**用户影响：**

- “分析关联”很可能只完成第一批 24 个文档，后续候选不再补充。
- “用本地语义再看一遍”在弹窗/完整页的轮询刷新下会自我取消，UI 显示本机分析失败。
- 语义找回的结果会在侧栏下一次 15 秒刷新或 30 秒心跳后被标记为“资料已更新”，即使资料没有变化。
- 1,000 资源、42 个批次级别的检索几乎必然会跨过 30 秒心跳，无法按文档承诺完成。
- `applyImport()` 在 `background.js:189-193` 写库前就先 `dataEpoch++`，导入失败时也会产生同类“无数据变化却取消任务”的副作用。

**修复方向：**

- 不要用“任何活动片段”驱动 `workspace.invalidate()`。把**观察心跳**和**数据代次**分开：心跳只更新活动状态，不推进检索/推理代次。
- 只在实际来源变化时推进数据代次：新页面/导航/标签激活、任务和关联变更、资料库变更、历史导入/删除、设置或排除规则变化。
- 如必须在观察时失效，至少区分“同一 open segment 的 checkpoint 更新”和“新页面/新任务归属”；`endReason === 'checkpoint'` 的同一 segment 更新不应清空 job。
- 增加测试：连续 heartbeat 不改变 job 的 epoch；关联/检索跨心跳仍能完成。
- 同时修正 `applyImport()` 的 epoch 时机，最好在写库成功后再推进。

**验证状态：**静态推导 + 本会话实际运行 Node 测试（148/148 通过）与探针（心跳后 `segments.length === 1`）。未做浏览器实测。

---

### CORE-02 [P2] 多窗口下返回提示和继续线索没有按请求窗口收口

**置信度：高**

**证据与调用链：**

- `background.js:299-304`：`reviewContext` 直接取全局 `lastSegment`，没有校验 `lastSegment.windowId === windowId`；`suggestionContext = activity.context || reviewContext`，也没有按请求窗口过滤。
- `background.js:318`：`workspace.view({ windowId, ... })` 的 `windowId` 是当前请求窗口。
- `src/workspace.js:244-256`：`current = windowContext(state.context, windowId)` 是**请求窗口**的任务绑定；但传给 `returnPrompt` 的 `context: activity.context` 是**当前聚焦窗口**的上下文，两者没有做窗口一致性校验。
- `src/focus-support.js:7-12`：`returnPrompt` 只检查 `context.windowId` 是整数，没有接收/比较请求窗口 ID。其证据循环按 `context.windowId` 过滤 segment，因此可以返回 `windowId` 为聚焦窗口的 prompt。
- `src/workspace.js:407-413`：`focusFeedback` 在点击时用请求 `windowId` 重新计算 prompt，然后检查 `prompt.windowId !== windowId` 并抛 `STALE_CONTEXT`。
- `src/task-memory-ui.js:157-174`：侧栏当前任务区直接渲染 `data.returnPrompt`；`src/task-memory-ui.js:323` 的反馈请求使用 `getWindowId()`。

**触发步骤：**

1. 窗口 A 和窗口 B 都把任务 A 选为当前任务。
2. 聚焦窗口 A，连续访问两个属于其他任务的页面，满足 5 分钟/2 页面条件。
3. 在窗口 B 打开侧栏并触发 `GET_STATE`（或窗口 B 的侧栏按 15 秒刷新）。
4. `current` 是窗口 B 的任务 A；`activity.context` 和证据来自窗口 A；`returnPrompt` 返回 `windowId=A` 的提示。
5. 窗口 B 的侧栏显示“要回到 A 吗？”。
6. 点击“返回任务”时，UI 传窗口 B 的 `windowId`；`focusFeedback` 重新计算后得到窗口 A 的 prompt，`prompt.windowId !== B`，返回“这条提示已失效”。

**用户影响：**

- 提示出现在错误窗口，且所有操作都会失败。
- 窗口 B 的“继续的线索”和下一主题建议可能基于窗口 A 的当前页面，而不是窗口 B 的注意力上下文。
- 多窗口是产品明确支持的场景，这个缺口会直接破坏“每个窗口当前任务”和返回提示的可信度。

**修复方向：**

- 给 `returnPrompt` 增加显式的 `windowId` 参数，并要求 `context.windowId === windowId`。
- `background.getState` 的 `reviewContext` 过滤 `lastSegment.windowId === windowId`；`suggestionContext` 也只接受请求窗口的上下文。
- `workspace.view` 在窗口不一致时不要传入 `activity.context`，或在 `returnPrompt` 内直接拒绝。
- 增加两个窗口、同一任务、不同聚焦窗口的测试。

**验证状态：**静态推导 + `returnPrompt` Node 探针（确认其可返回非请求窗口的 `windowId`）。未做多窗口浏览器实测。

---

### CORE-03 [P2] “取消删除”会关闭任务编辑器，未保存草稿丢失

**置信度：高**

**证据与调用链：**

- `app/app.js:748-752`：`closeDialog()` 在调用 `dialogCancelHandler()` 后，无条件执行 `document.getElementById('dialog').close()`。
- `app/app.js:877-889`：`confirmTaskDeletion()` 保存编辑器节点，设置 `onCancel = restoreEditor`；`restoreEditor` 只是把原节点放回 dialog 并恢复焦点，不会阻止后续 `close()`。
- `app/app.js:860-875`：`confirmDialog()` 的“取消删除”按钮绑定 `close-dialog`。
- `app/app.js:1135-1139`：dialog 的 `close` 事件会把 `taskEditor` 置空，并把焦点移到返回目标。

**触发步骤：**

1. 在任务工作台点击“编辑”打开任务编辑器。
2. 修改名称、目标或笔记（尚未保存）。
3. 点击“删除任务”，再点击“取消删除”或按 Escape。
4. `restoreEditor` 恢复表单节点后，`closeDialog()` 仍然关闭 dialog。
5. 重新打开编辑时，`taskDialog` 从 `ui.state` 重建，之前的编辑草稿已丢失。

**用户影响：**

- 与 `README.md:29` “编辑时取消删除会回到原草稿”的明确承诺不符。
- 删除确认是破坏性操作附近的常见误触路径，用户会因为取消而丢掉正在编辑的任务文字。

**修复方向：**

- 让 `dialogCancelHandler` 返回“已处理”标记；`closeDialog()` 在 handler 处理了取消时不要继续 `close()`。
- 或者让 `restoreEditor` 重新打开编辑器并恢复 `taskEditor`，不要触发 dialog 的 `close` 清理。
- 增加“编辑 → 删除 → 取消”不丢草稿的浏览器/交互测试。

**验证状态：**静态推导；未做浏览器实测。

---

### AUX-01 [P2] 排除站点没有进入自动继续线索过滤

**置信度：中高**

**证据与调用链：**

- `src/analytics.js:181-205` 的 `buildSuggestions()` 从 `segments`、`pages`、`tasks[].pages` 构造候选，只检查 `eligibleUrl()`（HTTP/HTTPS），没有站点排除参数。
- `background.js:304` 调用 `computeAnalytics({ segments, tasks, pages, now, currentContext })`，没有传入 `allowed`/`excludedDomains`。
- `app/app.js:426-437` 的 `continuationSuggestions()` 只过滤 `/^https?:\/\//`，随后直接渲染“继续看看”。
- `docs/DATA_AND_ARCHITECTURE.md:187` 明确要求：增加排除站点后，旧分析失效，新检索、候选、提示等应应用排除规则；既有手工保存内容保留可见和显式恢复能力，但“不再作为自动推荐输入”。

**触发步骤：**

1. 用户曾经访问或保存过 `https://bank.example/account`。
2. 在设置中把 `bank.example` 加入排除站点。
3. 回到任务/回顾页，触发 `GET_STATE`。
4. `computeAnalytics` 仍从旧的 `segments`/`pages` 或已保存任务页生成 `method: 'task'`/`'recent'` 的 suggestion；`continuationSuggestions` 显示它并提供“继续看看”。

**用户影响：**

- 用户以为排除站点已经生效，但该站点仍会出现在自动“继续的线索”中。
- 对敏感站点，这是隐私预期和信任问题；即使任务页是手工保存内容，自动推荐也应遵守排除规则。

**修复方向：**

- 给 `computeAnalytics`/`buildSuggestions` 增加 `allowed` 或排除域名参数，在 `segments`、`pages`、`tasks[].pages` 进入候选前过滤。
- `continuationSuggestions` 再做一次 URL/域名校验，避免旧状态绕过。
- 明确：任务详情里的显式页面列表可以保留，但自动候选与“继续看看”必须过滤。
- 增加“排除后不再出现 suggestion”的测试。

**验证状态：**静态推导 + `computeAnalytics` Node 探针（在没有 allowed 输入时会返回已保存页面建议）。未做排除站点端到端实测。

---

### CORE-04 [P3] 地图失效对象提示在恢复后仍然残留

**置信度：高**

**证据与调用链：**

- `app/app.js:628-639`：`renderMap()` 只在 `context.invalidTopic || context.invalidRelation` 时设置 `ui.mapNotice`，但没有在 `context` 恢复有效时清空。
- `app/app.js:1041-1043`：只有用户主动 `select-tag`/`select-edge` 才清空 `ui.mapNotice`。
- `ui.selectedEdge` 在 `resolveMapContext` 后可能已被清空，下一次 render 已经不再 invalid，但 `ui.mapNotice` 仍保留。

**触发步骤：**

1. 在地图中选中一个主题/关系。
2. 切换到一个该对象不存在的日期范围；界面提示“所选主题在这个范围内没有记录，已显示可用主题”，同时回退到可用主题。
3. 再刷新或再次切换到一个有效范围。
4. 选中对象已经有效，但旧的 warning 仍然显示。

**用户影响：**

- 地图上出现与当前选中对象不符的警告，用户会怀疑当前主题或关系仍然失效。
- 这会削弱“地图对象/范围切换是可信的”这一核心感受。

**修复方向：**

- 在 `renderMap()` 开始时按当前 `entries/edges/selection` 重新计算并清空 `ui.mapNotice`；不要在 render 中累积一次性提示。
- 可以在 `chooseRange` 成功或 `resolveMapContext` 返回有效对象时显式清空。

**验证状态：**静态推导；未做浏览器实测。

---

### CORE-05 [P3] 返回提示在“返回任务/这页也相关”成功前就被记为已处理

**置信度：高**

**证据与调用链：**

- `src/workspace.js:407-425`：
  - 先 `recordPromptShown`；
  - 对非 `shown` 动作立即 `dismissPrompt(...)` 并 `commit(...)`；
  - 然后才执行 `setRelation` 或 `restoreTask`。
- 如果 `setRelation` 因页面已变化失败，或 `restoreTask` 因没有可用继续页/窗口变化失败，提示已经被标记为 dismissed，且 30 分钟冷却仍然生效。

**触发步骤：**

1. 侧栏显示返回提示。
2. 用户点击“返回任务”，但在点击前页面/任务已变化，`restoreTask` 返回失败。
3. 提示已经被记录为 dismissed；即使条件仍然成立，接下来 30 分钟内不会再次出现。

**用户影响：**

- 用户在最需要返回线索的时候失去了提示。
- 失败后没有可重试的提示对象，只能依赖任务卡片的“继续一页”。

**修复方向：**

- 对 `return`/`related`：先完成恢复或关联，再记录 dismissed；失败时保留提示可重试。
- 对 `dismiss`/`snooze`：可以按当前方式立即记录。
- 至少不要因为一次失败就消耗 30 分钟冷却。

**验证状态：**静态推导；未做浏览器实测。

---

### CORE-06 [P3] 顶栏没有呈现 idle/unfocused/clock warning，用户可能误以为正在记录

**置信度：高**

**证据与调用链：**

- `background.js:320` 已经计算 `trackingState`：`paused / unknown / idle / active / unfocused`，其中 `warning` 来自时钟异常。
- `app/app.js:232-238` 的导航/状态只使用 `ui.state.settings.tracking`：
  - `tracking` 为真时显示“本机记录中”；
  - 只有暂停时显示“记录已暂停”。
- 因此失焦、系统空闲、时钟倒退等状态仍显示“本机记录中”。

**触发步骤：**

1. 打开侧栏/完整页。
2. 让浏览器失焦，或让系统进入 idle，或制造时钟倒退。
3. 后端 `trackingState.status` 已经是 `unfocused`/`idle`/`unknown`，但顶栏仍显示“本机记录中”。

**用户影响：**

- 用户看到注意力地图/时间线出现缺口，却不知道是没在记录、失焦、暂离还是时钟异常。
- 对“前台时长不等于注意力”的产品承诺来说，这是解释性信息的缺失；用户可能把缺失误解为产品漏记。

**修复方向：**

- 消费已有的 `trackingState`，在顶栏用明确文案区分：本机记录中 / 暂离 / 失去焦点 / 时钟异常 / 已暂停。
- 在时间线空态或地图摘要旁显示最近一次记录状态，避免只靠 timeline 的 idle/unknown 行解释。

**验证状态：**静态推导；未做浏览器实测。

---

### CORE-07 [P3] 断点继续页不在当前可选列表时，编辑断点会静默清空继续页

**置信度：高**

**证据与调用链：**

- `src/task-memory-ui.js:50-60`：
  - `pages` 只由 `task.pages` 和当前 `related` 关联组成；
  - `<select id="checkpoint-page">` 的选项来自这个 `pages` 列表；
  - 当前 `task.checkpoint.page` 只有在这个列表里时才会被 `selected`。
- `src/task-memory-ui.js:73-79`：提交时 `pageId: values.pageId`，如果 select 没有匹配项，浏览器取第一个空选项，`pageId` 变成 `''`。
- `makeCheckpoint` 在 `pageId` 为空时把 `page` 设为 `null`，于是保存的新断点不再有继续页。

**触发步骤：**

1. 任务断点原本指向一个已确认相关但未保存的页面。
2. 用户重置/撤销了该关联，或把该页从保存列表移除（断点页仍在任务中显示）。
3. 打开“留断点”，只修改“下一步”，没有重新选择继续页面。
4. 下拉框显示“暂不指定页面”，提交后原继续页被清空。

**用户影响：**

- 用户以为只是修改文字，却丢掉了“回到哪一页”的关键线索。
- 与“断点可指向已确认相关但尚未保存的页面”的产品语义冲突。

**修复方向：**

- 如果 `checkpoint.page` 仍存在但不在当前 `pages` 中，把它作为显式选项加入，或显示“原继续页已失效”并禁止静默清空。
- 提交时如果原断点有页面且用户没有主动改成空选项，保留原页面。
- 增加“关联被重置后编辑断点”的测试。

**验证状态：**静态推导；未做浏览器实测。

---

### AUX-02 [P3] 分组撤销是全局“最近一次”，多窗口可能撤错窗口

**置信度：高**

**证据与调用链：**

- `background.js:30`：`lastUndo` 是全局变量。
- `background.js:336-343`：`applyGroup()` 无论来自哪个窗口，都覆盖同一个 `lastUndo`。
- `background.js:350-369`：`undoGroup()` 只使用 `lastUndo`，不接收/核验请求窗口。
- `background.js:319`：`getState` 向每个窗口返回同一个 `undoAvailable`。
- 因此窗口 A 显示的“撤销”可以撤销窗口 B 最近一次分组。

**触发步骤：**

1. 在窗口 A 应用一个分组。
2. 在窗口 B 应用另一个分组。
3. 回到窗口 A 点击“撤销”。
4. 实际撤销的是窗口 B 的分组；窗口 A 的分组保持不变。

**用户影响：**

- 用户可能在自己没有操作的窗口里看到页面被解除分组、位置被重排。
- 这是辅助分组能力的多窗口一致性问题，不直接破坏注意力记录，但会破坏“撤销只影响刚才操作”的信任。

**修复方向：**

- 把 `lastUndo` 按 `windowId` 保存；`undoGroup` 接收请求窗口并核验。
- `getState.undoAvailable` 按窗口返回。
- 增加两个窗口分别应用/撤销的测试。

**验证状态：**静态推导；未做浏览器实测。

---

## 4. 产品建议（与代码缺陷分开）

这些不是对现有实现的确定性缺陷判断，而是从“注意力在哪里、当前要做什么、怎样回来”的核心信息层级出发的建议。

### P-01 三端需要一个真正的“当前工作”首屏

- 弹窗默认是“整理页面”（`popup/app.js:149-164`），当前任务/下一步/继续入口要切到“最近任务”才出现。
- 完整页默认是“一周回顾”（`app/app.js:63-64`、`394-424`），首屏重点是主题分布和任务卡，而不是当前任务、断点和“回来”。
- 侧栏任务页把当前任务放在前面，这是最接近核心的入口，但地图、路径、找回、资料库各自独立。

建议：增加一个跨三端的“今天/当前”首屏，顺序固定为：

1. 当前任务名与目标；
2. 下一步/断点与“继续一页”；
3. 最近 5 分钟/今天是否在目标上，或为什么没有记录；
4. 相关线索/继续候选；
5. 再进入完整地图、路径、资料库。

弹窗也应优先呈现当前任务，而不是默认展示分组建议。

### P-02 返回提示应成为侧栏的全局提示，而不是任务视图内部的一块

- `src/task-memory-ui.js:177-191` 把返回提示挂在 `current()` 的当前任务块内；只有任务视图调用 `memory.current({support: isPanel})` 时才出现。
- 用户在侧栏查看地图、路径、找回或资料库时，即使满足返回条件，也看不到提示。

建议：把返回提示提升为侧栏顶部的全局条带；在任务、地图、路径、找回视图都可显示；提示中始终包含当前任务名、下一步和“返回/标相关/稍后”。这样“怎样回来”不依赖用户停留在任务页。

### P-03 “注意力地图”这个名称需要与证据口径对齐

- 完整页地图标题是“注意力地图”（`app/app.js:628-649`），但实际展示的是主题访问先后关系和前台时长文字。
- 地图本身没有把尺寸编码时长，也没有把位置解释成语义距离，这是好的；但“注意力”这个词容易让用户把访问先后理解成注意力/专注评价，和 `PRODUCT.md:20`“不将前台停留当作实际注意力”存在张力。

建议：要么改名为“主题切换地图/访问路径地图”，要么在地图标题下直接写明“只表示已观察到的访问先后，不表示注意力、专注或任务完成”。地图详情中的“观察到 N 次”应继续保留，避免给出心理或完成度解释。

### P-04 一周回顾应显示覆盖缺口，而不只是前台时长

- `app/app.js:404-423` 的回顾摘要只展示前台停留、访问页面、切换、有记录天数；`computeReview` 已经计算了 `idleMs`/`unknownMs`，但界面没有展示。
- 时间线里有 idle/unknown 行，但回顾首屏没有告诉用户这一周有多少时间没有被记录或被判定为暂离/未知。

建议：在回顾摘要或图表旁增加“暂离/未知/未记录”覆盖信息，并明确“前台停留只是可解释的浏览器状态统计”。这样用户不会把 2 小时前台时长误读成整周注意力总量。地图/路径也应复用同一覆盖口径。

### P-05 回顾里的“下次，从这里继续”应优先固定当前任务

- `app/app.js:412-413` 只取 `ui.state.tasks.slice(0, 2)`，按最近活动排序，不保证当前任务出现。
- 如果当前任务最近编辑较少、但仍是“正在做”的任务，它可能不在回顾首屏。

建议：回顾页先固定显示当前任务及其断点/下一步，再列最近任务；任务卡片的“恢复保存页”和“继续一页”应使用不同动作名，避免用户误以为恢复全部等于继续当前页。

---

## 5. 待核实项

### U-01 单一任务成员页面在“没有当前意图”时被自动归属

**证据：**

- `src/task-context.js:30-41` 的 `resolveTaskContext()`：当 `intendedTaskId` 为空时，如果页面只属于一个任务，`matches.length === 1` 会选中该任务。
- Node 探针：`resolveTaskContext('q', null, [{id:'A',pages:[{pageId:'q'}]}])` 实际返回 `{intendedTaskId:null, taskId:'A', assignmentSource:'saved'}`。
- 计划 `docs/plans/2026-10-23-001...md:111` 的规则写的是“有当前任务且页面已保存或被用户标记相关，才归到该任务”；`docs/DATA_AND_ARCHITECTURE.md:111` 只说“多任务共享页面为未知”。
- 现有测试 `test/task-context.test.js:9-16` 只覆盖了“共享页面无意图为未知”，没有覆盖单一任务成员页面。

**需要确认：** 单一任务成员是否是“无歧义归属”，还是必须要求窗口有当前意图。若按计划规则 1 严格执行，这是 P2：暂停/无当前任务时访问已保存页面仍会写入 `taskId`，可影响任务模式/返回证据；若产品认为单一成员可自动归属，则应在文档中明确，并补测试。

### U-02 取消检索后仍保留结果、允许翻页和查看证据

**证据：**

- `src/workspace.js:368-372` 的 `cancelJob()` 只把状态设为 `cancelled`，保留 `results`、`scores`、`candidates`。
- `src/task-memory-ui.js:237-246` 无论 job 是否 cancelled 都渲染 `job.results`；只要不是 pending，翻页按钮仍可出现。
- `src/workspace.js:390-405` 的 `searchResults()` 只拒绝 `stale`，不拒绝 `cancelled`。
- 计划 `docs/plans/2026-10-23-001...md:210` 的验收措辞包含“取消后不继续展示旧任务结果”。

**需要确认：** 产品是否接受“停止分析但保留已找到结果”。当前 README 说“可停止分析”，UI 文案也说“保留已找到的结果”，这与计划的验收措辞冲突。若保留是产品决定，应更新计划/验收；否则取消后应清空或至少禁止翻页/证据。

### U-03 排除站点后的旧地图/模式是否也应失效

- 当前 `computeReview()` 和 `taskPatterns()` 使用的旧 `segments` 没有按 `allowed` 过滤；文档一方面说“不追溯删除已有内容”，另一方面说“旧分析失效”。
- 我未把“旧地图继续展示历史”判为缺陷，因为文档明确保留已有内容；但“自动建议/自动模式是否继续使用旧数据”需要产品确认。建议至少让自动候选过滤，历史证据保留并明确标注。

---

## 6. 辅助能力对核心的影响评估

- **标签页工作区/保存后关闭**：数据模型把任务、断点、恢复日志分开，先持久化再关闭，部分失败保留事实状态，设计上支持核心“回来”。但分组撤销的全局 `lastUndo` 在多窗口下可能撤错窗口（AUX-02）。
- **备份/导入**：格式 2—6、冲突选择、恢复前快照和事务回滚路径在代码与测试中较完整，任务/断点/关联/资料库都进入交换备份；这是支持核心的。`applyImport()` 在写库前推进 epoch（`background.js:189-193`）会放大 CORE-01 的失败副作用。
- **浏览器历史/统一检索**：来源、日期、站点、任务筛选在构建语料前执行，保留来源证据，这部分方向正确；但统一检索任务的完成依赖数据代次，CORE-01 会让它在正常刷新后失效。
- **资料库**：材料独立于历史保留期，原文/笔记分栏、修订冲突和备份路径基本支持核心“找回线索”；但资料库列表/历史面板把 `work.epoch` 当缓存键（`src/library-ui.js`、`src/history-ui.js`），在 CORE-01 下会随每次心跳反复重读。

总体判断：2.3—2.5 的数据模型大多没有改写注意力/任务归属的核心语义；主要破坏来自共享的 `dataEpoch` 失效机制、自动候选未应用排除规则，以及多窗口上下文没有按窗口收口。

---

## 7. 实际验证及限制

### 已实际运行

- `npm test`：当前 `test/*.test.js` 共 **148 项，148 通过，0 失败**（约 1.6 秒）。这覆盖了活动状态机、聚合/裁剪、返回提示阈值、任务上下文、断点、备份、历史、标签页操作、资料库等纯逻辑。
- Node 探针：
  - 连续 `context` + `heartbeat` 后，`reduceActivity` 返回 1 个 `endReason: 'checkpoint'` 的 segment，支持 CORE-01 的静态链路。
  - `returnPrompt` 在没有“请求窗口”参数时可返回聚焦窗口的 `windowId`，支持 CORE-02 的接口缺口判断。
  - `computeAnalytics` 在没有 `allowed` 输入时会从已保存任务页生成 suggestion，支持 AUX-01 的过滤缺口。
  - `resolveTaskContext` 在无当前意图、单一任务成员时返回该任务，支持 U-01 的待核实行为。

### 未运行

- 未在真实 Chrome/Edge 中加载 MV3 扩展；未验证真实多窗口、标签事件、sidePanel、session 权限、history 权限、contextMenus。
- 未运行 `test/native/*`、真实 IndexedDB 迁移、配额/事务故障、真实 BGE 模型、1,000 资源检索、截图和 320/360/400 宽度可访问性检查。
- 未做屏幕阅读器、键盘焦点、真实视觉层级检查；本报告中的 UI 影响均为静态推导。

### 测试覆盖缺口

- 没有测试覆盖 `applyActivity → workspace.invalidate → dataEpoch` 这条实际后台链路；`test/task-memory-flows.test.js` 的 fixture 直接调用 `memory.invalidate()`，没有覆盖“心跳不应失效”。
- 没有多窗口返回提示/继续线索的测试。
- 没有“编辑任务 → 删除 → 取消”草稿保留测试。
- 没有“排除站点后自动建议”的测试。
- 没有地图失效提示清除、断点页不在列表时编辑断点的测试。
- 计划中提到的 `test/workspace-migrations.test.js`、`test/backup-store.test.js` 在当前 `test/` 中不存在；数据库 v4→v5 迁移和导入事务失败没有纯逻辑测试证据。
- `README.md:71` 仍写“113 项逻辑测试通过”，本次实际为 148 项；计划中的 148 项与当前运行一致，README 计数滞后。

### 只读确认

本次评审未修改源码、测试或文档；未提交、推送、建分支或 worktree。工作区原有截图删除和 `docs/reviews/v2.5/README.md` 修改保持原状。

---

## 8. 最终判断

Focuence 2.5.0 的注意力记录和地图聚合在“不要伪造专注/完成”这件事上是认真的：心跳不重复累计、缺测不计入前台、地图只表达已观察到的主题先后、局部图和完整图保留真实关系。这些是产品核心的好基础。

当前最需要优先修的是 **CORE-01**：它不是一个边缘的性能问题，而是让“分析关联/语义分组/语义找回”在正常心跳或刷新后自我失效的共享架构缺陷。其次是 **CORE-02** 的多窗口上下文收口和 **CORE-03** 的任务编辑草稿保护。辅助能力方面，**AUX-01** 的排除站点过滤是隐私和信任问题，**AUX-02** 的多窗口撤销是操作一致性问题。

产品层面，三端的信息层级还没有把“当前任务 → 下一步 → 怎样回来 → 注意力证据”放在同一个核心首屏；地图命名和回顾覆盖信息也容易让用户高估“注意力”证据的完整性。建议在修复上述代码缺陷后，再做一次围绕“今天/当前”的首屏重构，而不是继续把核心能力分散在弹窗的“整理页面”和完整页的“一周回顾”里。
