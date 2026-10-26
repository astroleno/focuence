# kimi-cli 独立评审原文

2026-10-24；代码基准 `4c7ff64bcfe6eaddcfb4fc6942a8a00e32bbde8c`（main，2.5.0）。工具版本 2.3.1；模型信息：kimi-code/kimi-for-coding (configured default)。

本轮以注意力地图、聚焦与回到当前任务为核心，采用只读评审。以下保留该工具的原始结论；主线程逐项核实、去重及优先级判断见 [复核记录](README.md)。没有执行产品修复。

---

评审完成。以下为可直接存档的评审报告。

---

# Focuence 2.5.0 核心能力独立评审（main @ 4c7ff64）

日期：2026-10-24 · 评审对象：注意力地图、聚焦与返回当前任务 · 辅助面：标签工作区、浏览器历史、资料库、备份（按对核心的影响排序）

## 范围与方法

- **只读**：仅阅读受版本管理的源码、测试与设计文档；未修改、提交任何文件，未调用其他 agent、浏览器或外部来源。`npm test` 为唯一执行的命令。
- **追踪的调用链**：
  - 前台记录与地图：`src/activity.js` → `background.js`（`recordCurrent`/`getState`）→ `src/analytics.js`（`computeAnalytics`/`computeReview`）→ `src/map-layout.js` → `app/app.js`（timeline/map/review）、`panel`（`app/app.js` 复用）、`popup/app.js`、`src/ui.js`。
  - 聚焦与返回：`src/task-context.js`、`src/checkpoints.js`、`src/focus-support.js`、`src/task-patterns.js`、`src/workspace.js`（协调器）、`src/task-lifecycle.js`、`background.js`（消息路由、tab/idle/alarms 事件）。
  - 检索与关联：`src/memory-search.js`、`src/search-sources.js`、`src/task-matching.js`、`src/semantic.js`、`src/workspace.js`（job 生命周期）。
  - 辅助面与核心的交接：`src/store.js`（事务/清理/导入）、`src/backup.js`、`src/browser-history.js`、`src/library.js`、`src/tab-operations.js`、`src/tab-workspace.js`。
- **契约依据**：`PRODUCT.md`、`DESIGN.md`、`docs/DATA_AND_ARCHITECTURE.md`、`docs/plans/2026-10-23-001/002`。
- **验证口径**：除注明"实际测试"外，全部为静态推导；浏览器行为（`test/native/`）未执行，不声称已实测。

## 按严重度的 Findings

### F-001 · P1 · 置信度高：任何标签页事件都会使数据代次 +1，并把全部检索/关联作业（含已完成）置为失效、清空结果

**位置**：`background.js:554-560`（`tabSourceChanged` 及 7 个 tab 事件监听）、`background.js:113`（`invalidate: () => { dataEpoch++; persistSession() }`）；失效后果在 `src/workspace.js:83-90`（`invalidate` 把所有 job 标 `stale` 并清空 `results/candidates/scores`）、`src/workspace.js:318`（`advanceJob` 的 epoch 核验）、`src/workspace.js:376`（`openResult`）、`src/workspace.js:392`（`searchResults`）、`src/workspace.js:252`（侧栏关联作业按 epoch 匹配）；前端自清在 `src/task-memory-ui.js:220-222`、`src/task-memory-ui.js:321,325`。

**触发**：用户切换标签、新建/关闭标签、导航导致 URL/标题变化（`onUpdated` 的 `change.url || change.title`），只要涉及任一可记录页面。

**调用链**：`chrome.tabs.onActivated/onCreated/onUpdated…` → `tabSourceChanged` → `workspace.invalidate()` → ① `dataEpoch++` 并写 `chrome.storage.session`；② 所有作业（含 `status:'done'` 的检索）`status='stale'`、`results=[]`、`error='资料或任务已经更新，请重新查找或分析。'`。

**用户影响（直接打击核心闭环）**：
1. **找回**：检索完成后打开第一条结果（`OPEN_MEMORY_RESULT` → `openPage`/`focusResult` 激活标签）→ `onActivated` → invalidate → 作业失效；随后翻页（`GET_SEARCH_RESULTS`）、看来源（`GET_MEMORY_EVIDENCE`）、打开第二条结果均返回 `STALE_SUGGESTION`；前端 `refresh()` 后 `searchView()` 以 epoch 升高为由把本地结果也清空，界面显示"资料已更新，请重新查找。"。即"找回 → 打开 → 再找回下一条"的最基本循环断裂。
2. **关联**：侧栏"相关页面"作业在任何标签事件后退回纯关键词候选（`workspace.js:252-259`），语义排序结果随浏览持续丢失。
3. **语义整理**：`embeddingsFor` 批间核验 `generation !== dataEpoch`（`background.js:236,239`），页面加载期的标题/URL 更新即可使 `PROPOSE_GROUPS` 语义路径以"本机语义分析已取消"失败（`background.js:248-263`）。
4. 每次标签事件还伴随一次 `chrome.storage.session` 写入（churn）。

**与契约的矛盾**：`docs/DATA_AND_ARCHITECTURE.md` §9 明确数据代次只随"任务修改、切换（任务）、清理、站点排除、保留期或模型/记录设置变化"增加；`background.js` 已在 `propose`（`background.js:264-267` 标题哈希重核）与 `snapshotJob`（`workspace.js:358-366`）具备内容级核验，标签事件级 invalidate 属冗余且有害的放大。测试 `test/task-memory-flows.test.js:57,130` 只验证了"invalidate 后作业失效"这一协调器语义，没有任何测试覆盖"后台把标签事件接到 invalidate"这一段接线，因此该缺陷未被测试网捕获。

**修复方向**：后台 `tabSourceChanged` 中移除 `workspace?.invalidate()`（保留 `reconcile()` 记录观察即可）；内容变化交给已存在的快照哈希/签名核验处理；`invalidate` 仅保留在任务变更、设置、清理、导入、历史来源变化等处。若确需让候选感知窗口内容变化，按签名比对精准失效，而不是全量 epoch。

**验证状态**：静态推导（事件链逐行核实）。未做浏览器实测，列为待核实首项。

### F-002 · P3 · 置信度中：撤销分组的窗口指纹不含 windowId，跨窗口移动组成员后撤销会改动另一个窗口

**位置**：`background.js:346-348`（`windowFingerprint` 仅 `[tab.id, tab.groupId, tab.pinned]`）、`background.js:350-369`（`undoGroup`）。

**触发**：应用 Focuence 分组后，用户把组内某标签拖到另一个窗口，再点"撤销"。

**依据**：指纹不跨窗口比对 → 校验通过；`chrome.tabs.query({groupId})` 跨窗口返回该标签，`ungroup` 后 `chrome.tabs.move(tab.id, {index:-1})`（`background.js:362`）在其**当前所在窗口**内把它移到末尾；`background.js:364` 的窗口比对阻止原位放回。净效果：在用户未预期的窗口内改动了一个标签的位置/分组。

**影响**：边缘场景下的意外重排，不丢数据。修复方向：指纹加入 `tab.windowId`，或撤销前逐成员核对 `windowId === undo` 记录值，不符则拒绝撤销。

**验证状态**：静态推导，未做浏览器实测。

### F-003 · P3 · 置信度高：合并导入把 revision 无差别 +1 施加到所有本机任务（含未冲突任务）

**位置**：`src/backup.js:134-136`（`data.tasks = tasks.map(task => ({...task, revision: max+1}))`，merge 模式下 `tasks` 包含全部本机未选任务）。

**触发**：任何一次"合并导入"，即使用户未选择覆盖任何本机任务。

**影响**：三端所有打开的任务编辑器/断点对话框在导入后无谓收到 `STALE_TASK`，与"保留本机"的默认语义不符；亦放大并发编辑的核对成本。修复方向：仅对实际被备份替换/新增的任务提升 revision（或保持本机任务 revision 不动，冲突选择的任务按备份 revision +1）。

**验证状态**：静态推导。`test/backup.test.js` 未断言未冲突任务的 revision 不变。

### F-004 · P3 · 置信度中：检索批次推进与 `GET_STATE` 均按"全保留期片段"全量重算，规模上不封顶

**位置**：`src/workspace.js:323,338`（每个 24 段批次都重跑 `prepareJob`，其中 `store.listSegments({since: now - retentionDays·86400000})` 全量读出并重建语料与签名）；`src/workspace.js:249-250`（每次 `GET_STATE` 的 `view()` 同样全量读保留期片段）；侧栏 15 秒心跳 + 每个标签事件触发刷新（`app/app.js:1119-1131`）。

**影响**：365 天保留期 + 长历史时，语义找回呈 O(n²/24) 的库扫描与语料重建，MV3 后台 CPU/内存压力随保留期线性放大，直接拖累核心找回与地图入口的响应。修复方向：作业内按签名缓存语料，仅在新 epoch 或来源变化时重建；`view()` 的 patterns/prompt 所需片段与统计范围分开取。

**验证状态**：静态推导，未做大数据量实测。

## 产品建议（与代码缺陷分开）

1. **找回闭环的验收标准应写死"打开结果后仍可翻页/打开后续结果"**：这是"注意力 → 找回 → 回来"主线的最小闭环。F-001 修复后建议补一条 `test/native` 或后台级回归用例固化该行为。
2. **"当前任务"信息层级总体忠于契约且正确**：三端均先呈现目标 → 确认断点 → 继续操作（`src/task-memory-ui.js:177-191`）；观察草稿与确认文字分开展示、继续页未在保存列表时有明文说明（`task-memory-ui.js:109`）；提示阈值（5 分钟/2 页/每日 3 次）在设置页可见（`app/app.js:675`）。建议保持，无需重排。
3. **地图证据链完整**：节点/边/逐日/关系表同范围（`background.js:316-319`），线宽=次数、位置不编码语义、孤立主题单列、2,000 条截断有明示（`app/app.js:503,645`），符合 `DESIGN.md` 地图契约；建议在完整页地图默认选中"有最多关系的主题"而非列表首项，进一步缩短"注意力在哪里"的到达路径（当前回退逻辑见 `src/map-layout.js:41`，取首个有边主题，行为可接受，属优化项）。

## 待核实（低置信度或需实测）

1. F-001 在真实浏览器中的端到端表现（隔离 Chrome：检索 → 打开结果 → 再翻页/再打开），以及移除 invalidate 后语义整理在浏览中的稳定性。
2. F-002 跨窗口拖动后撤销的实际标签行为（不同 Chrome 版本 `tabs.move` 语义）。
3. F-004 在 90 天+ 真实片段量下的检索耗时与内存（`test/native/search-performance.mjs` 存在但本次未运行）。
4. 侧栏所属窗口失焦时返回提示不出现的频率是否影响可感知性（`src/focus-support.js:8` 要求 `context.intendedTaskId === current.taskId`，设计如此，属行为确认而非缺陷）。

## 实际验证与限制

- **实际运行**：`npm test`（`node --test --test-concurrency=1 test/*.test.js`）——**148/148 通过**。这是本次唯一执行的测试；既有验收记录不视为本次亲测。
- **未执行**：`test/native/` 浏览器脚本（需 Chrome/CDP）、模型推理、打包构建。所有 findings 均为静态推导，已在各条目标注。
- **未读取** `docs/reviews/v2.5/core-review-2026-10-24/` 与 `.review-work/` 的其他评审结果；工作区中既有的截图清理与文档链接补充未触碰。
- 辅助面（备份/历史/资料库/标签工作区）与核心的交接（事务、revision/generation 核验、关闭日志、恢复前去重）逐一核对，除 F-003、F-004 外未发现破坏核心路径的问题；历史导入、导入恢复、清理自身的数据代次增加属契约明文允许。

**总结**：核心架构（意图/观察分离、证据驱动地图、克制提示）与文档契约一致，测试网在纯逻辑层覆盖良好；最大的实际风险集中在后台把高频标签事件接入"数据代次失效"这一处接线（F-001），它使找回、关联、语义整理三个核心动作在日常浏览中互相踩踏，建议优先修复并补回归测试。
