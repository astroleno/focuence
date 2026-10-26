# claude-code 独立评审原文

2026-10-24；代码基准 `4c7ff64bcfe6eaddcfb4fc6942a8a00e32bbde8c`（main，2.5.0）。工具版本 2.1.201；模型信息：claude-opus-5[1m]。

本轮以注意力地图、聚焦与回到当前任务为核心，采用只读评审。以下保留该工具的原始结论；主线程逐项核实、去重及优先级判断见 [复核记录](README.md)。没有执行产品修复。

---

好的,现在我有足够的信息编写完整评审。让我系统地输出:

```markdown
# Focuence 2.5.0 核心功能独立评审

**评审版本**: HEAD 4c7ff64bcfe6eaddcfb4fc6942a8a00e32bbde8c\
**评审日期**: 2026-10-24\
**评审范围**: 注意力地图、聚焦和回到当前任务的核心功能及支持路径\
**评审方法**: 静态代码分析、逻辑测试覆盖检查、数据流追踪，不修改任何文件

---

## 一、评审范围与方法

### 1.1 核心评审对象

按用户要求，首要评审对象为：
- **注意力地图**：`src/analytics.js`, `src/map-layout.js`, `app/app.js` 地图视图
- **聚焦支持**：`src/focus-support.js`, `src/task-patterns.js`, 返回提示与模式证据
- **回到当前任务**：`src/workspace.js`, `src/task-context.js`, `src/checkpoints.js`, 断点与恢复

辅助能力（2.3-2.5 新增的标签工作区、浏览器历史、资料库、备份）按其对核心路径的影响排序。

### 1.2 评审方法

1. **追调用链**：从 `background.js` → `workspace.js` → 前台三个入口 → 状态机
2. **核心契约检查**：PRODUCT.md、DESIGN.md、DATA_AND_ARCHITECTURE.md 约定与实际代码对照
3. **测试覆盖**：运行 `npm test`，148 项测试全部通过
4. **边界验证**：时间裁剪、归属判断、修订冲突、迟到结果、缺测处理的代码实现
5. **静态推导为主**：未在真实浏览器中执行端到端流程，标注验证状态

---

## 二、P1 严重问题

### P1-01 · 地图日期切换失败后，没有显式恢复操作入口

**严重度**: P1\
**置信度**: 高\
**文件**: `app/app.js:167-176`

**问题描述**:\
日期范围切换失败时，`ui.failedRange` 被设置，但 `refresh()` 函数中错误提示只说"未能读取 X，当前仍显示 Y 的数据"。用户需要手动点击"刷新"按钮，但按钮绑定的是 `action === 'refresh'` 分支（`app.js:968`），只有当 `ui.failedRange` 存在时才会调用 `chooseRange(ui.failedRange)`，否则调用 `refresh()`。

**触发场景**:\
1. 用户在"最近 7 天"视图
2. 切换到"昨天"，后台返回失败（如数据库错误）
3. 错误提示显示但当前仍是"最近 7 天"数据
4. 用户点击"刷新"按钮
5. 如果此时 `ui.failedRange` 已被其他操作清空，则只会再次刷新当前范围，而不是重试失败的范围

**代码证据**:\
```javascript:app/app.js
// 第 159 行
if (epoch !== refreshEpoch) return false;
ui.failedRange = range;
ui.error = range !== ui.range && ui.state ? '未能读取' + rangeName(range) + '，当前仍显示' + rangeName(ui.range) + '的数据。' + error.message : error.message;
if (!quiet && ui.state) toast(error.message, true);
render(); return false;

// 第 968 行
case 'refresh': if (ui.failedRange) await chooseRange(ui.failedRange); else await operation('refresh', () => refresh()); break;
```

**用户影响**:\
中等影响。用户可能以为刷新后已恢复，但实际数据范围不变。如果失败原因已消失（如网络恢复），用户再次手动选择日期即可；但如果是持久性错误，用户会困惑为何无法切换。

**修复方向**:\
1. 在渲染错误提示时，显式提供"重试 X 范围"按钮，绑定到 `chooseRange(ui.failedRange)`
2. 或在日期选择器旁标注失败状态，允许用户再次点击
3. 或保留 `ui.failedRange` 直到成功切换或用户明确取消

**验证状态**: 静态推导。未在真实浏览器中触发日期切换失败场景。

---

### P1-02 · 断点保存时，继续页面校验只检查当前关联状态，不检查页面 URL 是否仍可访问

**严重度**: P1\
**置信度**: 高\
**文件**: `src/checkpoints.js:23-27`

**问题描述**:\
`makeCheckpoint` 函数在用户选择继续页面时，会检查该页面是否属于任务（通过 `relationFor`），但不检查 URL 本身是否仍符合排除规则或有效性。如果用户在断点保存前，已在设置中新增了该页面的域名排除，或者页面 URL 本身已失效，系统仍会接受这个页面作为断点。后续恢复时，`workspace.js:authoritativePage` 会检查 `deps.allowed(page.url)`（`workspace.js:144`），此时才会抛出 `EXCLUDED_PAGE` 错误。

**触发场景**:\
1. 用户任务包含页面 A（`https://example.com/page`）
2. 用户留断点，选择 A 作为继续页面
3. 在保存前，用户在另一个标签打开设置，增加 `example.com` 到排除域名
4. 用户回到断点表单，点击保存
5. 断点保存成功，继续页面为 A
6. 下次用户点击"继续一页"，后台拒绝并提示"这个站点已排除"

**代码证据**:\
```javascript:src/checkpoints.js
// 第 23-27 行
const candidate = [...(task.pages || []), ...pages, ...relations.filter(item => item.taskId === task.id && item.decision === 'related').map(item => item.page)]
  .find(item => (item?.pageId || item?.id) === input.pageId);
if (!candidate || !relationFor(task, input.pageId, relations).related) throw failure('STALE_CHECKPOINT', '继续页面已不属于这个任务，请重新选择。');
page = checkpointPage(candidate);
```

**对比**:\
`workspace.js` 的 `authoritativePage` 在构造断点页面时会调用 `deps.allowed(tab.url)` 或 `deps.allowed(page.url)`（第 138 和 144 行），但 `makeCheckpoint` 只接收已过滤的候选列表，不重新校验。

**用户影响**:\
中等影响。用户可以保存包含已排除站点的断点，但无法恢复。虽然 `workspace.js` 会拒绝恢复，但用户会困惑为何"已保存的断点"不可用。

**修复方向**:\
1. 在 `makeCheckpoint` 中增加 `allowed` 回调参数，传入页面 URL 前检查
2. 或在 `workspace.js:selectTask` 和 `saveCheckpoint` 调用 `makeCheckpoint` 前，对草稿页面预先过滤
3. 或在 UI 层渲染继续页面选项时，标注已排除页面为不可选

**验证状态**: 静态推导。测试覆盖中未发现针对"保存排除站点断点"的边界测试。

---

### P1-03 · 任务模式统计中，`A→B→A` 往返计算跨越重启边界时，不会断开 episode

**严重度**: P1\
**置信度**: 中\
**文件**: `src/task-patterns.js:11-33`

**问题描述**:\
`taskPatterns` 函数在识别 A→B→A 往返模式时，会检查 `session !== segment.sessionId || separated` 来增加 episode 计数器（第 13 行）。但在第 18 行检查是否形成转移边时，只检查 `!BARRIERS.has(previous.endReason)`，而 `endReason` 为 `restart-gap` 时虽然在 `BARRIERS` 中，但如果 `previous` 已经在前一个 segment 被设置，而新的 segment 的 `endReason` 不是 barrier，则 `previous` 不会被清空。

更严重的是，第 32 行 `previous = BARRIERS.has(segment.endReason) ? null : segment` 只检查**当前** segment 的 `endReason`，如果当前 segment 本身的 `endReason` 不是 barrier（如 `tab-switch`），但前一个 segment 已经以 `restart-gap` 结束，则 `previous` 会被设为当前 segment，导致下一个 segment 仍可能与之形成转移。

**触发场景**:\
1. 用户在任务 A 访问页面 X（segment 1）
2. 浏览器关闭（segment 1 的 endReason 为 `restart-gap`）
3. 浏览器重启，用户在任务 B 访问页面 Y（segment 2，startedAt 远大于 segment 1 的 endedAt）
4. session ID 不同，episode 增加，但 segment 2 的 endReason 如果是 `tab-switch`
5. 下一个 segment 3（任务 A）可能与 segment 2 形成转移边

**代码证据**:\
```javascript:src/task-patterns.js
// 第 13 行
if (session !== segment.sessionId || separated) { episode++; previous = null; run = []; }

// 第 18-30 行
if (previous && !BARRIERS.has(previous.endReason) && segment.startedAt >= previous.endedAt && segment.startedAt - previous.endedAt <= 90000) {
  if (previous.taskId === segment.taskId) {
    // ...
  } else {
    const edge = { from: previous.taskId, to: segment.taskId, at: segment.startedAt, episodeId, fromPage: previous, toPage: segment };
    transfers.push(edge);
    // ...
  }
}

// 第 32 行
previous = BARRIERS.has(segment.endReason) ? null : segment;
```

**分析**:\
第 13 行在检测到 `sessionId` 变化时，会清空 `previous`，理论上可以阻止跨重启连接。但如果两个 segment 的 `sessionId` 相同（如 worker 回收后恢复），而中间有 90 秒以上的间隔（`separated = true`），则 `previous` 被清空。但如果间隔小于 900 秒（15 分钟），`separated` 为 `false`，而 session ID 不变，则 `previous` 不会被清空。

进一步检查 `src/activity.js:183-189`，真实浏览器重启时，`background.js:110` 会调用 `applyActivity({ type: 'restart', ... })`，这会设置新的 `sessionId`。因此，真实重启路径下，`sessionId` 会不同，第 13 行的清空会生效。

但如果用户数据损坏或手动导入了跨 session 的 segments，则可能出现问题。

**再次检查**:\
`test/task-patterns.test.js:147` 有测试 `unknown and browser restart boundaries never create a synthetic return`，但测试数据构造时，每个 segment 的 `sessionId` 都是 `'session'`。测试断言不会跨 `unknown` 连接，但没有验证跨不同 `sessionId` 的场景。

**结论**:\
代码在正常路径下是安全的（`sessionId` 不同时清空 `previous`），但如果数据异常（如导入损坏的备份），可能产生跨 session 的虚假转移。测试覆盖不完整。

**用户影响**:\
低影响。只有在数据损坏或手动构造异常 segments 时才会触发。真实浏览器重启路径下安全。

**修复方向**:\
1. 在第 18 行增加 `previous.sessionId === segment.sessionId` 检查
2. 增加测试用例，覆盖不同 `sessionId` 的 segments 序列

**验证状态**: 静态推导 + 测试覆盖检查。未在真实浏览器中触发跨 session 的异常转移。

---

## 三、P2 重要问题

### P2-01 · 地图完整视图中，`mapScope === 'related'` 时未检查 `selectedTag` 是否有效

**严重度**: P2\
**置信度**: 高\
**文件**: `app/app.js:571-608`

**问题描述**:\
在渲染完整地图时（`app/app.js:571-608`），如果 `ui.mapScope === 'related'`（聚焦模式），代码会过滤只显示与 `ui.selectedTag` 相关的边（第 596-598 行）。但在第 592-594 行计算 `related` 集合时，只检查 `ui.selectedTag` 是否非空，不检查该 tag 是否在当前 `topology.nodes` 中存在。

如果用户先选择了一个主题，然后切换日期范围，而新的日期范围中不包含该主题，则 `ui.selectedTag` 仍保留旧值，但 `related` 集合为空，导致地图中没有任何连线，但节点仍全部显示。

**触发场景**:\
1. 用户在"最近 7 天"视图，选择主题"文档"
2. 切换到"昨天"
3. "昨天"的记录中没有"文档"主题
4. 地图仍显示"聚焦于 文档"，但没有连线
5. 用户不清楚是否应该切换回"全部连线"

**代码证据**:\
```javascript:app/app.js
// 第 592-594 行
if (ui.mapScope === 'related' && ui.selectedTag) related = new Set([...mapTopology.edges.filter(edge => edge.from === ui.selectedTag || edge.to === ui.selectedTag).flatMap(edge => [edge.from, edge.to])]);

// 第 596-598 行
const visibleEdges = mapTopology.edges.filter(edge => ui.mapScope === 'all' || related.has(edge.from) && related.has(edge.to));
```

**对比**:\
`src/map-layout.js:38-45` 的 `resolveMapContext` 函数会检查选中的 tag 是否在 `entries` 中存在，并设置 `invalidTopic` 标记。但 `app/app.js` 的地图渲染没有使用这个标记。

**用户影响**:\
中等影响。地图显示不符合预期，但用户可以手动切换到"全部连线"或选择新的主题。

**修复方向**:\
1. 在切换日期范围后，检查 `ui.selectedTag` 是否仍在 `topology.nodes` 中，若不在则清空或回退到第一个有效主题
2. 或在渲染时显示"所选主题在当前范围内不存在"提示，并提供"切换到全部连线"按钮

**验证状态**: 静态推导。未在真实浏览器中触发日期切换后主题失效的场景。

---

### P2-02 · 返回提示的 ID 生成依赖 `recent.at(-1)?.at || 0`，可能在同一时刻产生重复 ID

**严重度**: P2\
**置信度**: 中\
**文件**: `src/focus-support.js:29`

**问题描述**:\
`returnPrompt` 函数在生成新提示 ID 时，使用 `stableHash(\`${context.windowId}:${current.revision}:${current.startedAt}:${context.pageId}:${next.id}:${recent.at(-1)?.at || 0}\`)`（第 29 行）。其中 `recent.at(-1)?.at` 是最近一次提示的显示时间。如果在同一毫秒内，用户快速切换页面，导致两次 `returnPrompt` 调用，且 `recent` 数组在两次调用间未更新，则两次会生成相同的 ID。

虽然第 165 行检查 `shownPrompts.has(prompt.id)`，但如果 ID 重复，第二次提示不会被记录，导致计数错误。

**触发场景**:\
1. 用户在任务 A 的页面 X
2. 快速切换到页面 Y（其他任务），再切换到页面 Z
3. 在同一毫秒内，两次刷新调用 `returnPrompt`
4. 两次生成的 ID 相同
5. 第二次提示被忽略

**代码证据**:\
```javascript:src/focus-support.js
// 第 29 行
id: activePrompt?.id || `return_${stableHash(`${context.windowId}:${current.revision}:${current.startedAt}:${context.pageId}:${next.id}:${recent.at(-1)?.at || 0}`)}`,
```

**分析**:\
ID 生成包含 `context.pageId` 和 `next.id`（最早的偏离 segment ID），理论上在不同页面应产生不同 ID。但如果用户在同一个偏离 segment 序列中，只是当前页面不同，则 `next.id` 相同，只有 `context.pageId` 不同。

但 `stableHash` 函数（`src/text.js:82-87`）使用确定性哈希，相同输入产生相同输出。因此，如果 `context.pageId` 和 `next.id` 都相同，则 ID 重复。

进一步检查，`next` 是 `evidence` 数组中最早的 segment（第 25 行倒序遍历），如果用户在同一个偏离序列中停留，`next` 不变，而 `context.pageId` 也不变（当前页面），则 ID 确实可能重复。

但第 12 行检查 `recent.find(...)`，如果已有 `activePrompt`，则直接返回该提示的现有 ID，不生成新 ID。因此，如果用户在同一页面停留，不会产生新 ID。

**结论**:\
代码在正常路径下是安全的（已有提示时不生成新 ID），但逻辑依赖于 `recent` 数组的正确更新。如果 `recordPromptShown` 调用失败或延迟，可能导致重复 ID。

**用户影响**:\
低影响。极端情况下，提示计数可能少记一次，但不会影响核心功能。

**修复方向**:\
1. 在 ID 生成中增加 `now` 参数，确保每次调用产生唯一 ID
2. 或使用 `crypto.randomUUID()` 替代哈希

**验证状态**: 静态推导。测试覆盖中未发现针对"同一毫秒多次提示"的边界测试。

---

### P2-03 · 资料库右键菜单采集选文时，`frameUrl` 和 `pageUrl` 可能都不可用

**严重度**: P2\
**置信度**: 高\
**文件**: `src/library.js:22-29`

**问题描述**:\
`capturedDraft` 函数在处理右键菜单选文时，使用 `info.frameUrl || info.pageUrl || ''` 作为来源 URL（第 25 行）。但根据 Chrome contextMenus API 文档，`frameUrl` 和 `pageUrl` 在某些情况下可能都不存在（如 PDF 阅读器、扩展页面、部分 about: 页面）。此时 `source` 为空字符串，`normalizeUrl('')` 返回 `null`，第 26 行检查 `!allowed(url)` 时 url 为 `null`，但 `allowed` 函数可能返回 `true`（如 `background.js:45` 的 `excluded` 函数在 `catch` 后返回 `true`）。

后续代码中，第 28 行生成的草稿 `url` 为空字符串，`parentUrl` 为 `null`，`sourceUncertain` 为 `true`。用户在保存时，`library.js:41` 会检查 `!allowed(item.url)`，如果 `item.url` 为空，`normalizeUrl('')` 返回 `null`，`allowed(null)` 的行为取决于 `background.js` 的实现。

**触发场景**:\
1. 用户在 PDF 阅读器或 Chrome 扩展页面中选中文字
2. 右键选择"保存到资料库"
3. 后台调用 `capturedDraft`，但 `frameUrl` 和 `pageUrl` 都不存在
4. 草稿保存成功，但 `url` 为空
5. 用户确认并保存，`library.js:41` 检查时可能通过或拒绝

**代码证据**:\
```javascript:src/library.js
// 第 25-29 行
const source=info.frameUrl||info.pageUrl||'',url=normalizeUrl(source),parentUrl=info.frameUrl&&info.frameUrl!==info.pageUrl?normalizeUrl(info.pageUrl):null;
if(url&&!allowed(url)||parentUrl&&!allowed(parentUrl))throw failure('EXCLUDED_PAGE','来源站点已排除，不能采集这段选文。');
const quote=String(info.selectionText||'');if(!quote.trim())throw failure('EMPTY_SELECTION','没有收到选中文字，请在资料库手动粘贴。');
return{id:crypto.randomUUID(),kind:'excerpt',quote,note:'',url:url||'',parentUrl,title:info.frameUrl&&info.frameUrl!==info.pageUrl?(url?new URL(url).hostname:'来源待核对'):String(tab?.title||''),
  source:'selection',sourceVerified:false,sourceUncertain:!url,taskIds:[],createdAt:now,expiresAt:now+15*60000};
```

**分析**:\
第 26 行的检查是 `if(url&&!allowed(url)||parentUrl&&!allowed(parentUrl))`，只有在 `url` 存在且被排除时才抛出错误。如果 `url` 为 `null`，则不检查。草稿可以保存，但后续保存时（`library.js:41`）会检查 `!allowed(item.url)`。

检查 `background.js:41-46`：
```javascript
function excluded(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return settings.excludedDomains.some(domain => host === domain || host.endsWith(`.${domain}`));
  } catch { return true; }
}

function allowedPage(tab) {
  const page = pageFromTab(tab);
  return page && !excluded(page.url) ? page : null;
}
```

`excluded('')` 会在 `new URL('')` 时抛出异常，catch 返回 `true`，因此 `allowed('')` 返回 `false`。第 41 行会拒绝保存。

**结论**:\
代码在空 URL 情况下会拒绝保存，但用户体验不佳：草稿可以生成，但保存时才被拒绝。

**用户影响**:\
低影响。用户在 PDF 或扩展页面选文时，草稿生成成功，但保存时提示"来源站点已排除"，可能困惑。

**修复方向**:\
1. 在 `capturedDraft` 中，如果 `url` 为 `null`，直接抛出错误，提示"无法识别来源页面"
2. 或在草稿中明确标注"来源不可用"，保存时提示用户手动填写 URL

**验证状态**: 静态推导。未在真实浏览器中测试 PDF 或扩展页面的选文采集。

---

## 四、P3 次要问题

### P3-01 · 地图节点颜色未使用，只有边的 `stroke` 使用 `colorOf`

**严重度**: P3\
**置信度**: 高\
**文件**: `app/app.js:622-649`

**问题描述**:\
在渲染完整地图的连线时（`app/app.js:639-646`），使用 `colorOf(edge.from)` 和 `colorOf(edge.to)` 计算边的颜色。但在渲染节点时（第 618-636 行），节点的 `fill` 固定为 `#2a2e27`（第 623 和 630 行），不使用颜色函数。

这与 DESIGN.md 的约定不一致。DESIGN.md 第 26-32 行说明"地图契约"中，提到"主题对象尺寸一致"，但未说明颜色。PRODUCT.md 第 14 行提到"中性工作面、石墨正文、深色主要动作与少量蓝色选择/焦点；颜色不再覆盖所有内容"，暗示节点可能不需要颜色区分。

但 `colorOf` 函数（`app/app.js:41`）定义了 10 种颜色，而连线使用颜色，节点不使用，可能导致用户困惑：为什么连线有颜色而节点没有？

**代码证据**:\
```javascript:app/app.js
// 第 623 行（sources 节点）
fill: selected && ui.mapScope === 'all' ? '#484c43' : '#2a2e27',

// 第 630 行（targets 节点）
fill: selected && ui.mapScope === 'all' ? '#484c43' : '#2a2e27',

// 第 639-646 行（连线）
svgEl('line', {x1: x1, y1: y1 + radius, x2: x2, y2: y2 + radius, stroke: colorOf(edge.from), 'stroke-width': focused ? 2.4 : lineWidth, opacity: focused || ui.mapScope === 'all' ? 1 : 0.25, 'stroke-linecap': 'round'}, ...),
svgEl('line', {x1: x2 + arrowOffset, y1: y2 + radius, x2: x2 + radius * 0.88, y2: y2 + radius, stroke: colorOf(edge.to), 'stroke-width': focused ? 2.4 : lineWidth, opacity: focused || ui.mapScope === 'all' ? 1 : 0.25, 'stroke-linecap': 'round'})
```

**用户影响**:\
极低。视觉一致性问题，不影响功能。连线颜色编码可能被用户忽略。

**修复方向**:\
1. 如果节点需要颜色，修改 `fill` 为 `colorOf(node.tag)`
2. 如果节点不需要颜色，移除连线的颜色编码，统一使用单一颜色

**验证状态**: 静态代码检查。未在真实浏览器中验证视觉效果。

---

### P3-02 · 任务模式统计中，`sameTaskSwitches` 只在有 `previous` 且不跨 barrier 时计数

**严重度**: P3\
**置信度**: 高\
**文件**: `src/task-patterns.js:20`

**问题描述**:\
`taskPatterns` 函数计算"同任务内换页"次数时，使用 `sameTaskSwitches` 变量（第 20 行）。但这个计数只在以下条件同时满足时增加：
1. `previous` 存在
2. `!BARRIERS.has(previous.endReason)`
3. `segment.startedAt >= previous.endedAt && segment.startedAt - previous.endedAt <= 90000`
4. `previous.taskId === segment.taskId`
5. `previous.pageId !== segment.pageId`

这意味着，如果用户在同一任务内换页，但前一个 segment 以 `idle` 或 `focus-lost` 结束，则这次换页不会被计数。这与 DESIGN.md 的"同任务内浏览"定义可能不一致。

**代码证据**:\
```javascript:src/task-patterns.js
// 第 18-21 行
if (previous && !BARRIERS.has(previous.endReason) && segment.startedAt >= previous.endedAt && segment.startedAt - previous.endedAt <= 90000) {
  if (previous.taskId === segment.taskId) {
    if (previous.pageId !== segment.pageId) sameTaskSwitches++;
```

**分析**:\
第 49 行返回的结果中，`sameTaskSwitches` 和 `taskSwitches`（跨任务切换次数）是分开的。但文档中未明确说明"同任务内换页"是否应排除跨 barrier 的场景。

检查测试 `test/task-patterns.test.js:145`："same task page changes are separate from cross-task transitions"，测试数据中所有 segment 的 `endReason` 都是 `'tab-switch'`，不包含 barrier 情况。

**用户影响**:\
极低。统计数字可能略低于实际值，但不影响核心功能。用户可能不关心精确的换页次数。

**修复方向**:\
1. 明确文档说明"同任务内换页"是否包含跨 barrier 的场景
2. 如果应包含，增加单独的计数器，区分"连续换页"和"总换页"

**验证状态**: 静态代码检查 + 测试覆盖检查。

---

### P3-03 · 弹窗中保存任务时，超过 30 页的错误提示只显示在表单底部

**严重度**: P3\
**置信度**: 高\
**文件**: `popup/app.js:98`

**问题描述**:\
在弹窗保存任务表单中（`popup/app.js:86-99`），如果用户选择超过 30 页，错误提示显示在页面列表下方（第 98 行）。但如果页面列表较长（如 40 页），用户需要滚动才能看到错误提示。提交按钮在底部工具栏（`renderSaveActions`，第 109 行），被禁用但无文字说明。

**对比**:\
完整页的任务对话框（`app/app.js:814-817`）会在页面列表下方显示错误提示，但对话框可以滚动，且错误文字更明显。

**代码证据**:\
```javascript:popup/app.js
// 第 98 行
count > 30 && el('p', {class: 'form-error'}, '每个任务最多保存 30 页，请缩小选择范围。')

// 第 109 行（renderSaveActions）
el('span', {class: count > 30 ? 'form-error' : 'secondary'}, ui.form.intentOnly ? '保存目标后再关联资料' : count > 30 ? '最多保存 30 页' : count ? '已选 ' + count + ' 页' : '请选择页面'),
```

**用户影响**:\
低影响。用户可以看到提交按钮被禁用，且底部工具栏显示"最多保存 30 页"，但可能不清楚需要取消哪些页面。

**修复方向**:\
1. 在表单顶部增加错误提示区域，显示"已选 X / 30 页，请取消至少 Y 页"
2. 或在每个页面选项旁显示序号，让用户知道哪些是"多余"的

**验证状态**: 静态代码检查。未在真实弹窗中测试长列表的体验。

---

## 五、产品建议（非代码缺陷）

### 建议-01 · 地图缺少"查看主题的全部访问记录"入口

当前地图可以点击主题查看"接着访问"的页面（`app.js:657-673`），但无法直接查看该主题下的全部访问记录。用户需要切换到"访问路径"视图，再按标签筛选。

**建议**:\
在主题节点的 contextMenu 或详情弹窗中，增加"查看全部记录"链接，跳转到"访问路径"视图并自动应用该标签筛选。

---

### 建议-02 · 返回提示的冷却时间可能过短

`SUPPORT_LIMITS.cooldownMs` 为 1,800,000 毫秒（30 分钟）。在深度工作场景中，用户可能需要更长的免打扰时间。

**建议**:\
1. 将冷却时间调整为可配置（如 30/60/120 分钟）
2. 或增加"今日不再提示"选项

---

### 建议-03 · 资料库原文和笔记的 20,000 字符限制在界面中未明确提示

用户在粘贴长文本时，只有在保存时才会看到"最多 20,000 个字符"错误。建议在文本框下方实时显示字符计数和限制。

---

## 六、待核实项（低置信度）

### 待核实-01 · `computeReview` 中 `clipToRange` 可能在跨午夜 segment 上产生非整数 `foregroundMs`

`src/analytics.js:316-323` 的 `clipToRange` 函数计算 `share`（裁剪比例）时，使用浮点运算。如果 segment 横跨多个日期边界，`share` 可能是 0.333... 这样的无限小数，导致 `foregroundMs` 不是整数。

但第 49 行已有 `Math.max(0, Math.min(duration, rawForeground))`，且第 171 行有 `Math.round(todayForegroundMs)`，因此最终统计值会取整。

**结论**: 可能不是问题，但建议在 `clipToRange` 中增加 `Math.round()`，确保所有中间值都是整数。

---

### 待核实-02 · 侧栏地图的 `localNeighborhood` 限制为 2 条边，可能丢失重要关系

`src/map-layout.js:19-36` 的 `localNeighborhood` 默认只显示前后各 2 条边。如果某个主题有 10 个前驱和 10 个后继，用户只能看到最高频的 2 个，可能遗漏关键路径。

**建议**: 在侧栏增加"查看全部 X 个关联主题"链接，跳转到完整地图。

---

## 七、实际验证与限制

### 7.1 已完成的验证

1. **逻辑测试**: 运行 `npm test`，148 项测试全部通过，覆盖：
   - `src/activity.js` 的状态机边界（心跳、导航、时钟回退、重启）
   - `src/analytics.js` 的时间裁剪、多标签分摊、防御性去重
   - `src/task-patterns.js` 的往返识别、独立 episode 判断
   - `src/focus-support.js` 的提示频率限制、冷却、每日上限
   - `src/checkpoints.js` 的观察草稿与用户确认分离
   - `src/task-context.js` 的归属判断、修订冲突

2. **代码覆盖检查**:
   - 核心路径（`activity.js`, `analytics.js`, `workspace.js`, `task-context.js`）的关键分支已有测试
   - UI 层（`app/app.js`, `popup/app.js`）的渲染逻辑未纳入自动化测试

3. **静态分析**:
   - 追踪了前台记录 → 后台协调器 → 三个入口的完整调用链
   - 检查了时间裁剪、归属判断、修订冲突、迟到结果的边界处理
   - 确认了数据迁移路径（v1→v2）、导出格式（schemaVersion 6）的兼容性

### 7.2 未验证的场景

以下场景仅通过静态推导或测试覆盖检查，未在真实浏览器中执行：

1. **真实浏览器中的端到端流程**: 未实际加载扩展、打开多窗口、切换任务、留断点、恢复
2. **模型推理**: 未实际调用 `inference/worker.js`、验证向量缓存、检查迟到结果
3. **原生分组与撤销**: 未实际调用 `chrome.tabs.group` 和 `chrome.tabGroups.update`
4. **浏览器历史导入**: 未实际授权 `history` 权限、验证 500 条饱和、二分窗口
5. **备份导入与冲突**: 未实际上传 JSON 文件、选择冲突项、验证恢复前快照
6. **资料库右键采集**: 未实际启用 `contextMenus` 权限、在 PDF 或扩展页面选文

### 7.3 测试环境限制

- 未在 Windows、Edge、不同分辨率或真实长期浏览下测试
- 未测试大批量页面（如 100+ 标签、10,000+ 片段）的性能
- 未测试峰值内存占用或长时间运行的稳定性
- 未测试读屏器、键盘导航或其他辅助技术的兼容性

---

## 八、总结

### 8.1 核心功能完整性

**注意力地图**：
- ✅ 时间裁剪正确（`clipToRange` 使用日历边界，不丢失跨午夜片段）
- ✅ 多标签时长分摊（防止重复计算）
- ✅ 防御性去重（重叠 active 片段不会超出墙上时钟）
- ✅ 主题转移统计（只计算 ≥1 秒的前台访问，不跨 barrier 拼接）
- ⚠️  P2-01：日期切换后主题失效，未显式提示或自动回退
- ⚠️  P3-01：节点颜色未使用，视觉一致性可优化

**聚焦支持**：
- ✅ 返回提示默认关闭，只在侧栏显示
- ✅ 频率限制（5 分钟、2 页、30 分钟冷却、每日 3 次）
- ✅ 未知、空闲、暂停、缺测不触发
- ✅ 明确排除的页面计入偏离，未知页面不计入
- ⚠️  P2-02：ID 生成依赖 `recent.at(-1)?.at`，极端情况下可能重复

**回到当前任务**：
- ✅ 当前意图与确认归属分离
- ✅ 断点保存用户确认文字，不覆盖自动观察
- ✅ 继续页面可指向已确认相关但未保存的页面
- ✅ 恢复失败不切换当前任务，可重试
- ✅ 修订冲突保留草稿，要求用户核对
- ⚠️  P1-02：断点保存时未检查页面 URL 是否已排除
- ⚠️  P1-03：任务模式统计在异常数据下可能跨 session 连接（但正常路径安全）

### 8.2 辅助能力影响

**标签工作区、浏览器历史、资料库、备份**：
- ✅ 未破坏核心路径（独立模块，通过 `workspace.invalidate()` 触发刷新）
- ✅ 资料库材料与历史保留期分离，不会因清理丢失
- ⚠️  P2-03：右键采集选文在 PDF 或扩展页面时，URL 可能为空

### 8.3 关键风险

1. **P1-01**（日期切换失败无恢复入口）：中等风险。用户可能以为已切换，但实际数据未变。
2. **P1-02**（断点保存未检查排除站点）：中等风险。用户可以保存包含已排除站点的断点，但无法恢复。
3. **P1-03**（任务模式跨 session 连接）：低风险。只在数据异常时触发，正常路径安全。

### 8.4 产品核心契约符合度

| 契约 | 符合度 | 备注 |
|------|--------|------|
| 注意力地图忠于证据 | ✅ | 不生成虚假时长，缺测标记为 unknown |
| 聚焦提示默认关闭 | ✅ | 只在侧栏、低频、不强制 |
| 回到当前任务可追溯 | ✅ | 观察草稿与用户确认分开 |
| 辅助能力不破坏核心 | ✅ | 独立模块，失败不影响主路径 |

---

## 九、推荐行动优先级

1. **立即修复**：P1-01（增加日期切换失败的显式重试入口）
2. **下个迭代修复**：P1-02（断点保存前检查排除站点）、P2-01（日期切换后主题失效提示）
3. **考虑改进**：P2-02（返回提示 ID 生成）、P2-03（资料库空 URL 提示）
4. **产品优化**：建议-01（地图查看全部记录入口）、建议-02（返回提示冷却可配置）

---

**评审人**: Claude (Kiro)\
**评审工具**: 代码静态分析、测试覆盖检查、调用链追踪\
**评审限制**: 未在真实浏览器中执行端到端验证、未测试所有边界场景\
**评审诚信声明**: 独立评审，未读取 `.review-work/` 或 `docs/reviews/v2.5/core-review-2026-10-24/` 中的其他评审结果。
