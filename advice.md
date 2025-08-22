最终方案：完整的提示词与实施策略
这套方案分为两部分：

最终版提示词 (Final Prompts): 包含可以直接使用的 System Prompt 和 User Prompt 模板。

核心改进策略汇总 (Key Improvement Strategy): 详细解释了“为什么”这样改以及“如何”在代码中实现，融合了我们双方的智慧。

第一部分：最终版提示词 (Final Prompts)
1. 系统提示词 (System Prompt)
这就是你重写并优化的版本，它非常出色，可以直接使用。

Plaintext

你是一个专业的智能标签页分组助手。你的目标是：基于用户的浏览行为和注意力模式，将标签页分成逻辑上相关的工作组，并返回严格 JSON 格式的结果。

【分组优先级（从高到低）】
1. **工作流相关性**：连续打开或来源一致 (referrer) 的标签页通常属于同一任务流。
2. **域名相关性**：相同域名的标签页通常归为一组。
3. **语义相似性**：通过标题/URL提取关键词，判断内容主题是否一致。
4. **时间接近性**：短时间内访问或打开的标签页倾向于属于同一任务。
5. **注意力权重**：`attentionScore` 高的标签页是分组的核心。

【输出规则】
- 每个分组必须包含 2 个或更多标签页。
- 避免过度分组（总组数建议不超过 8 个）。
- 为每个分组生成一个简洁、能概括其核心主题的名字。
- 严格按照指定的 JSON 结构输出，每个分组必须包含以下字段：
  - `name` (string): 组名，简短且直观。
  - `tabs` (array of numbers): 标签页 ID 列表。
  - `reason` (string): 一句话解释为什么这些标签页被归为一组。
  - `status` (enum: "recently active" | "stale" | "normal"): 根据组内标签页的整体活跃度判断。

【输出格式示例】
```json
{
  "groups": [
    {
      "name": "代码开发 - GitHub",
      "tabs": [12, 15, 18],
      "reason": "这些标签页都来自 github.com 且与同一个代码仓库相关。",
      "status": "recently active"
    },
    {
      "name": "前端技术文档",
      "tabs": [21, 23],
      "reason": "均为前端框架的技术文档或教程页面。",
      "status": "normal"
    }
  ]
}
【约束与兜底】

你的回答必须是纯粹的 JSON 代码，不包含任何解释性文字或代码块标记 (如 ```json)。

如果有些标签页实在无法与任何其他页面形成有意义的分组，将它们放入一个名为 "杂项标签页" 的组中。

禁止产生空的 tabs 数组。


#### **2. 用户提示词模板 (User Prompt Template)**

这个模板整合了我们讨论过的数据增强项，让 LLM 获得最丰富的信息。

```javascript
// 1. 先在你的代码中准备增强版的 tabData
const tabData = tabs.map(tab => ({
    id: tab.id,
    title: tab.title,
    url: tab.url,
    domain: new URL(tab.url).hostname,
    isPinned: tab.pinned, // [新增] 是否固定
    // [优化] 转换为自然语言，LLM 更易理解
    timeSinceLastAccess: formatDistanceToNow(new Date(tab.lastAccessed), { addSuffix: true, locale: zhCN }), 
    attentionScore: calculateAttentionScore(tab), // 你原有的注意力分数
    // activeTime: tab.activeTime || 0 // 活跃时间信息已融入 attentionScore
}));

// 2. 构建 User Prompt
const userPrompt = `
请根据你的分组策略，为以下 ${tabData.length} 个标签页进行智能分组：

${JSON.stringify(tabData, null, 2)}
`;
注意: formatDistanceToNow 是一个示例函数（类似 date-fns 库中的功能），用于将时间戳转换为 "5分钟前"、"大约2小时前" 这样的可读字符串。这比给模型一长串毫秒数要有效得多。

第二部分：核心改进策略汇总 (Key Improvement Strategy)
这是对我们所有讨论的提炼，解释了“为什么”和“怎么做”。

1. Prompt 架构优化：从“清单”到“手册”
改进点：明确了 分组优先级，从高到低的顺序（工作流 > 域名 > 语义 > 时间 > 注意力）为 LLM 提供了清晰的决策框架，减少了它在面对冲突标准时的不确定性。

收益：分组结果更稳定、更符合逻辑直觉，有效减少了无意义的碎片化分组。

2. 输出结构增强：提供“可解释性”和“可用性”
改进点：在输出 JSON 中增加了 reason 和 status 字段。

reason：向用户解释分组的依据，把“黑盒”决策变得透明。这是提升用户信任度的关键。

status：让 LLM 根据组内标签页的总体“新鲜度”直接给出状态。UI 可以直接利用这个字段进行视觉标记（例如，“最近活跃”的组高亮，“待清理”的组置灰），引导用户操作。

收益：用户能立刻理解分组的价值并决定下一步操作（是关闭旧的还是聚焦新的），极大提升了扩展的实用性。

3. Few-shot 示例：为模型提供“样板间”
改进点：在 System Prompt 中内嵌了一个高质量的输入输出示例。

收益：这是确保 LLM 输出格式稳定、内容符合预期的最有效方法之一。它能显著降低因 JSON 解析失败而触发回退策略的概率。

4. 防御性设计：构建“兜底逻辑”
改进点：增加了明确的约束，如“创建杂项组”、“禁止空组”、“只输出JSON”。

收益：确保了无论输入多么混乱，LLM 的输出总是一个可用的、符合程序处理预期的结果，大大增强了系统的鲁棒性。

5. 数据特征增强：给模型更丰富的“线索”
改进点：在输入数据 (tabData) 中增加了 isPinned 字段，并将时间戳转换为自然语言。

收益：isPinned 是一个极强的用户意图信号。时间自然语言化则降低了 LLM 的理解成本。提供更优质、更易于理解的数据，是提升模型决策质量的根本。

总结
通过上述整合优化，你的 Focuence智序 项目现在拥有了一套非常强大和专业的 LLM 驱动机制。它不仅规则清晰、输出稳定，而且具备了良好的可解释性和用户体验设计。