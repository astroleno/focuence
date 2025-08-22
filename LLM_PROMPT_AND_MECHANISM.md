# Focuence智序 - LLM提示词和机制文档

## 概述

Focuence智序使用大语言模型(LLM)来实现智能标签页分组，基于用户的浏览行为和注意力模式进行分组决策。

## 数据提交机制

### 提交给LLM的数据结构

```javascript
const tabData = tabs.map(tab => ({
    id: tab.id,                    // 标签页唯一标识符
    title: tab.title,              // 标签页标题
    url: tab.url,                  // 完整URL
    domain: tab.url ? new URL(tab.url).hostname : 'unknown',  // 域名
    lastAccessed: tab.lastAccessed, // 最后访问时间戳
    timeSinceLastAccess: number,   // 距离上次访问的毫秒数
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

### 系统提示词

```
你是一个专业的智能标签页分组助手。基于用户的浏览行为和注意力模式，将标签页分成逻辑上相关的工作组。

分组策略：
1. **工作流相关性**：连续打开的标签页通常属于同一工作流
2. **域名分类**：相同域名的标签页通常相关
3. **时间模式**：相近时间访问的标签页可能相关
4. **注意力权重**：根据最近访问时间和活跃程度判断重要性
5. **语义关联**：通过标题和URL判断内容相关性

重要规则：
- 每个组至少包含2个标签页
- 优先创建有意义的组，避免过度分组
- 组名要简洁明了，反映组的主题
- 返回严格的JSON格式

输出格式：
{
  "groups": [
    {
      "name": "组名",
      "tabs": [标签页ID列表]
    }
  ]
}
```

### 用户提示词模板

```
请将以下${tabs.length}个标签页进行智能分组。考虑它们的打开顺序、域名、访问时间和注意力模式：

${JSON.stringify(tabData, null, 2)}

请提供合理的分组建议。
```

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

### 错误处理机制

1. **API密钥检查**：如果未设置API密钥，直接使用回退策略
2. **网络错误处理**：捕获网络异常，使用回退策略
3. **JSON解析错误**：如果AI返回非标准JSON，使用回退策略
4. **响应格式验证**：验证返回数据的完整性

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

## 改进方向

### 提示词优化
- 增加更多上下文信息
- 改进分组策略描述
- 优化输出格式要求

### 数据增强
- 添加用户行为数据
- 引入机器学习模型
- 考虑标签页内容分析

### 用户体验
- 提供分组理由说明
- 支持用户自定义分组
- 分组历史记录功能