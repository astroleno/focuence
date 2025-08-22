# Focuence智序 - LLM提示词和机制文档

## 概述

Focuence智序使用大语言模型(LLM)来实现智能标签页分组，基于用户的浏览行为和注意力模式进行分组决策。

**更新说明：** 本文档已根据 advice.md 的建议进行了全面优化，实现了从"清单式"到"手册式"的提示词架构升级。

## 数据提交机制

### 提交给LLM的数据结构

```javascript
const tabData = tabs.map(tab => ({
    id: tab.id,                    // 标签页唯一标识符
    title: tab.title,              // 标签页标题
    url: tab.url,                  // 完整URL
    domain: tab.url ? new URL(tab.url).hostname : 'unknown',  // 域名
    isPinned: tab.pinned || false, // 是否固定标签页（新增）
    lastAccessed: tab.lastAccessed, // 最后访问时间戳
    timeSinceLastAccess: number,   // 距离上次访问的毫秒数
    timeSinceLastAccessText: string, // 自然语言时间描述（新增）
    attentionScore: number,        // 注意力分数(0-1)
    windowId: tab.windowId,        // 窗口ID
    index: tab.index,              // 在标签栏中的位置索引
    activeTime: tab.activeTime || 0 // 活跃时间
}));
```

### 注意力分数计算

```javascript
let attentionScore = 0.5; // 基础分数

if (tab.lastAccessed) {
    const hoursSinceLastAccess = timeSinceLastAccess / (1000 * 60 * 60);
    
    // 根据最近访问时间调整分数
    if (hoursSinceLastAccess < 1) attentionScore += 0.3;    // 1小时内
    else if (hoursSinceLastAccess < 6) attentionScore += 0.2; // 6小时内
    else if (hoursSinceLastAccess < 24) attentionScore += 0.1; // 24小时内
}

attentionScore = Math.min(attentionScore, 1.0); // 最高不超过1.0
```

## LLM提示词设计

### 系统提示词（已优化）

```
你是一个专业的智能标签页分组助手。你的目标是：基于用户的浏览行为和注意力模式，将标签页分成逻辑上相关的工作组，并返回严格 JSON 格式的结果。

【分组优先级（从高到低）】
1. **工作流相关性**：连续打开或来源一致 (referrer) 的标签页通常属于同一任务流。
2. **域名相关性**：相同域名的标签页通常归为一组。
3. **语义相似性**：通过标题/URL提取关键词，判断内容主题是否一致。
4. **时间接近性**：短时间内访问或打开的标签页倾向于属于同一任务。
5. **注意力权重**：attentionScore 高的标签页是分组的核心。

【输出规则】
- 每个分组必须包含 2 个或更多标签页。
- 避免过度分组（总组数建议不超过 8 个）。
- 为每个分组生成一个简洁、能概括其核心主题的名字。
- 严格按照指定的 JSON 结构输出，每个分组必须包含以下字段：
  - name (string): 组名，简短且直观。
  - tabs (array of numbers): 标签页 ID 列表。
  - reason (string): 一句话解释为什么这些标签页被归为一组。
  - status (enum: "recently active" | "stale" | "normal"): 根据组内标签页的整体活跃度判断。

【输出格式示例】
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
```

### 用户提示词模板（已优化）

```
请根据你的分组策略，为以下 ${tabData.length} 个标签页进行智能分组：

${JSON.stringify(tabData, null, 2)}
```

**优化说明：**
- 简化了提示词内容，避免重复说明策略（系统提示词已详细说明）
- 直接引用分组策略，确保一致性
- 数据中包含了增强的字段（isPinned, timeSinceLastAccessText）

## API调用配置

### 请求参数

```javascript
{
    model: app.settings.model,        // 模型名称 (如: gpt-4o-mini)
    messages: [
        {
            role: "system",
            content: systemPrompt     // 系统提示词
        },
        {
            role: "user", 
            content: userPrompt      // 用户提示词
        }
    ],
    temperature: 0.2,                // 降低随机性，提高一致性
    max_tokens: 3000                 // 最大输出长度
}
```

### 错误处理机制（已增强）

1. **API密钥检查**：如果未设置API密钥，直接使用回退策略
2. **网络错误处理**：捕获网络异常，使用回退策略
3. **响应内容验证**：检查AI响应是否为空或无效
4. **JSON结构验证**：验证响应是否包含基本JSON结构
5. **JSON解析错误**：如果AI返回非标准JSON，使用回退策略
6. **数据完整性检查**：验证分组对象的结构和必要字段
7. **标签页ID验证**：确保分组中的标签页ID有效且存在
8. **最终兜底机制**：如果所有分组都无效，强制使用回退策略

## 回退分组策略

当LLM分组失败时，系统采用三层回退机制：

### 第一层：域名分组
- 按相同域名分组
- 最可靠的策略
- 每组至少2个标签页

### 第二层：时间序列分组
- 按标签页打开顺序分组
- 考虑索引间隔(≤5)和时间间隔(≤10分钟)
- 相同域名的标签页优先分组

### 第三层：关键词分组
- 基于标题和URL的关键词匹配
- 使用预定义的技术术语列表
- 每组至少2个标签页

## 智能组名生成

### 组名生成策略

1. **单域名组**：`域名 - 共同关键词`
2. **多域名组**：`域名1 & 域名2 & 域名3`
3. **关键词组**：基于提取的关键词
4. **注意力模式组**：`最近活跃` 或 `待清理`
5. **默认组**：`相关标签页`

### 关键词提取

```javascript
const commonTechTerms = [
    'github', 'git', 'code', 'programming', 'development', 'api', 'documentation',
    'docs', 'tutorial', 'guide', 'reference', 'stack', 'overflow', 'blog',
    'news', 'article', 'search', 'google', 'youtube', 'video', 'music',
    'email', 'mail', 'calendar', 'drive', 'docs', 'sheets', 'slides',
    'admin', 'dashboard', 'login', 'profile', 'settings', 'config'
];
```

### 共同关键词识别

- 分析所有标签页标题
- 提取出现频率超过阈值的词
- 最多返回2个共同关键词

## 注意力模式分析

### 最近活跃标签页
- 30分钟内访问过的标签页占比≥60%
- 组名标记为"最近活跃"

### 待清理标签页  
- 2小时前访问过的标签页占比≥60%
- 组名标记为"待清理"

## 分组操作功能

### 高亮分组
- 获取组内所有标签页的当前索引
- 使用`chrome.tabs.highlight()`高亮显示
- 提供用户反馈

### 关闭分组
- 批量关闭组内所有标签页
- 使用`chrome.tabs.remove()`执行关闭
- 更新UI状态

### 单独关闭
- 支持关闭组内单个标签页
- 自动更新组状态
- 空组自动移除

## 调试和监控

### 控制台日志
- 记录API调用过程
- 显示分组策略执行情况
- 输出详细的错误信息

### 状态显示
- UI中显示分组进度
- 实时反馈处理结果
- 错误状态用户提示

### 性能优化
- 限制单次分组的标签页数量
- 避免频繁的API调用
- 智能缓存机制

## 近期改进总结（基于 advice.md）

### 1. Prompt 架构优化：从"清单"到"手册"
- ✅ **完成**：明确了分组优先级的层次结构
- ✅ **完成**：为 LLM 提供了清晰的决策框架
- ✅ **完成**：减少了冲突标准时的不确定性

### 2. 输出结构增强：提供"可解释性"和"可用性"  
- ✅ **完成**：添加了 `reason` 字段，解释分组依据
- ✅ **完成**：添加了 `status` 字段，标识分组活跃度
- ✅ **完成**：提升用户对分组结果的理解和信任

### 3. Few-shot 示例：为模型提供"样板间"
- ✅ **完成**：在系统提示词中内嵌了高质量示例
- ✅ **完成**：确保 LLM 输出格式稳定、内容符合预期

### 4. 防御性设计：构建"兜底逻辑"
- ✅ **完成**：增加了8层防御性检查
- ✅ **完成**：确保任何情况下都有可用的分组结果
- ✅ **完成**：大大增强了系统的鲁棒性

### 5. 数据特征增强：给模型更丰富的"线索"
- ✅ **完成**：添加了 `isPinned` 字段（用户意图信号）
- ✅ **完成**：实现了时间自然语言化（提升理解性）
- ✅ **完成**：优化了数据结构的可读性

## 未来改进方向

### 提示词优化
- 考虑添加用户历史偏好学习
- 引入多轮对话式分组优化
- 支持用户自定义分组规则

### 数据增强
- 分析标签页内容摘要
- 引入浏览器使用模式分析
- 考虑跨窗口的全局分组

### 用户体验
- 支持用户手动调整分组结果
- 分组历史记录和恢复功能
- 个性化分组策略配置