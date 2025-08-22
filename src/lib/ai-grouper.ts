import { TabInfo, GroupResult, TabGroup, Settings } from '../types';

/**
 * AI智能分组系统
 * 基于refcode优化的结构化prompt和严格输出约束
 */
export class AIGrouper {
  private settings: Settings['ai'];
  
  constructor(aiSettings: Settings['ai']) {
    this.settings = aiSettings;
  }

  /**
   * 执行智能语义分组
   */
  async performSemanticGrouping(
    tabs: TabInfo[], 
    existingGroups: TabGroup[] = []
  ): Promise<GroupResult> {
    if (!this.settings.enabled || !this.settings.apiKey) {
      throw new Error('AI功能未启用或API密钥缺失');
    }

    try {
      const prompt = this.buildSemanticGroupingPrompt(tabs, existingGroups);
      const response = await this.callAI(prompt);
      return this.parseSemanticGroupingResult(response, tabs);
    } catch (error) {
      console.error('AI分组失败:', error);
      throw error;
    }
  }

  /**
   * 构建结构化分组提示词（基于refcode优化）
   */
  private buildSemanticGroupingPrompt(tabInfo: TabInfo[], existingGroups: TabGroup[] = []): string {
    // 限制标签页数量，避免token超限
    const MAX_TABS = 60;
    const tabs = tabInfo.slice(0, MAX_TABS).map((t, i) => ({
      idx: i + 1,
      id: t.id,
      title: (t.title || "").slice(0, 120),
      domain: t.domain || "",
      path: (t.path || "").slice(0, 150),
      attentionScore: Number.isFinite(t.attentionScore) ? Number(t.attentionScore.toFixed(3)) : 0
    }));

    const existing = existingGroups.map(g => ({
      name: g.name,
      tabIds: g.tabIds || [],
      confidence: g.confidence
    }));

    // 结构化JSON输入（refcode核心优化）
    const structuredInput = JSON.stringify({
      tabs,
      existingGroups: existing
    }, null, 2);

    return `${this.getSystemPrompt()}\n\n输入数据:\n${structuredInput}`;
  }

  /**
   * 系统提示词（基于refcode的严格约束版本）
   */
  private getSystemPrompt(): string {
    return `你是"Focuence"标签页分组助手。任务：基于提供的JSON输入，对标签页进行稳定、可解释的语义分组。

硬性规则：
- 只使用给定的tabs数据；不得虚构/猜测额外标签页或字段
- 每个标签页至多归属一个分组；同一tabId不得出现在多个分组
- 跨域合流允许（如GitHub代码/Issue、Docs文档、Figma设计、Notion说明等），前提是服务同一项目/主题/任务
- 尊重现有分组(existingGroups)：优先复用已有名称与范围；仅在confidence>0.8时才提出rename/merge，并在actions中说明
- 优先级排序：分组和组内成员按attentionScore降序；分值相同按出现顺序
- 强制分组原则：所有标签页都必须被分组，ungrouped数组应该为空或接近空
- 积极分组：只要有2个或以上标签页存在任何潜在关联就应该分组，宁可多分组也不要漏掉
- 降低分组门槛：即使是弱关联（如相同领域、相似主题、工作流程、相同类型）也应该分组
- 兜底分组：如果某些标签页难以归类，按域名、功能类型或浏览时间创建通用分组
- 输出必须是单个JSON对象，不含多余文字、注释或Markdown

分组原则（优先级递减）：
1. 内容语义优先：基于标签页标题和路径的实际内容主题分组，而非域名
   - 相同研究课题、项目或任务的页面应归为一组（即使来自不同网站）
   - 如"大模型研究"、"React开发"、"机器学习"等主题性分组
2. 注意力模式：结合attentionScore识别用户工作重点和关注顺序
3. 时间关联：考虑访问时长和访问频次，识别连续性工作流程
4. 域名兜底：仅在内容无明显关联时才按域名分组

命名与描述：
- 分组名：≤12个中文字符，基于标题内容提取核心主题，避免域名命名
  - 优先：具体任务/项目名称（如"Claude开发指南"、"机器学习模型"）
  - 次选：领域分类（如"前端开发"、"产品设计"）
  - 避免：网站名（如"GitHub"、"知乎"）
- description：≤40字，说明分组的实际工作内容和目标
- reasoning：≤80字，基于内容相似性解释分组依据

输出格式（严格遵循）：
{
  "groups": [
    {
      "name": "具体分组名",
      "description": "分组描述",
      "tabIds": [123, 456],
      "confidence": 0.0-1.0,
      "reasoning": "分组理由"
    }
  ],
  "ungrouped": [tabId, ...],
  "actions": {
    "reuse": [{"name":"沿用的组名","tabIds":[...]}],
    "rename": [{"from":"旧名","to":"新名","reason":"..."}],
    "merge": [{"into":"保留名","from":["被合并名1"],"reason":"..."}]
  },
  "insights": "≤100字，概括用户当下工作焦点/模式"
}

示例：
输入: {"tabs":[{"id":1,"title":"GPT-4性能评测","domain":"openai.com","attentionScore":0.85},
{"id":2,"title":"Claude 3.5模型对比","domain":"anthropic.com","attentionScore":0.92},
{"id":3,"title":"大模型应用场景分析","domain":"zhihu.com","attentionScore":0.67}]}

输出: {"groups":[{"name":"大模型研究","description":"大语言模型性能对比和应用研究","tabIds":[2,1,3],"confidence":0.91,"reasoning":"基于标题内容的语义相似性，都关注大模型的性能评估和应用"}],"ungrouped":[],"actions":{"reuse":[],"rename":[],"merge":[]},"insights":"用户正在深入研究不同大语言模型的性能特点"}

只返回JSON，无其他内容。`;
  }

  /**
   * 调用AI API
   */
  private async callAI(prompt: string): Promise<string> {
    const apiConfig = this.getAPIConfig();
    
    console.log('=== API配置详情 ===');
    console.log('- Endpoint:', apiConfig.endpoint);
    console.log('- HasApiKey:', !!this.settings.apiKey);
    console.log('- ApiKeyLength:', this.settings.apiKey?.length || 0);
    console.log('- Provider:', this.settings.provider);
    console.log('- Model:', this.settings.model);
    console.log('================');
    
    const response = await fetch(apiConfig.endpoint, {
      method: 'POST',
      headers: apiConfig.headers,
      body: JSON.stringify(apiConfig.body(prompt))
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('API请求失败详情:');
      console.error('- Status:', response.status);
      console.error('- StatusText:', response.statusText);
      console.error('- ResponseBody:', errorText);
      
      // 特殊处理429限流错误
      if (response.status === 429) {
        let errorMessage = 'API请求过于频繁，请稍后再试';
        try {
          const errorData = JSON.parse(errorText);
          if (errorData.error?.message) {
            errorMessage = errorData.error.message;
          }
        } catch (e) {
          // 解析失败，使用默认消息
        }
        throw new Error(`${errorMessage}`);
      }
      
      throw new Error(`AI API请求失败: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return this.extractAIResponse(data);
  }

  /**
   * 获取API配置
   */
  private getAPIConfig() {
    const { provider, model, apiKey, apiUrl, temperature, maxTokens } = this.settings;
    
    const configs = {
      custom: {
        endpoint: `${apiUrl}/v1/chat/completions`,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: (prompt: string) => ({
          model: model === 'custom' ? (this.settings.customModel || 'gpt-4o-mini') : (model || 'gpt-4o-mini'),
          messages: [
            { role: 'user', content: prompt }
          ],
          max_tokens: maxTokens || 2000,
          temperature: temperature || 0.2
        })
      },
      openai: {
        endpoint: 'https://api.openai.com/v1/chat/completions',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: (prompt: string) => ({
          model: model === 'custom' ? (this.settings.customModel || 'gpt-4o-mini') : (model || 'gpt-4o-mini'),
          messages: [
            { role: 'user', content: prompt }
          ],
          max_tokens: maxTokens || 2000,
          temperature: temperature || 0.2 // 低温度提高一致性
        })
      },
      anthropic: {
        endpoint: 'https://api.anthropic.com/v1/messages',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: (prompt: string) => ({
          model: model || 'claude-3-haiku-20240307',
          max_tokens: maxTokens || 2000,
          messages: [
            { role: 'user', content: prompt }
          ]
        })
      },
      deepseek: {
        endpoint: 'https://api.deepseek.com/v1/chat/completions',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: (prompt: string) => ({
          model: model === 'custom' ? (this.settings.customModel || 'deepseek-chat') : (model || 'deepseek-chat'),
          messages: [
            { role: 'user', content: prompt }
          ],
          max_tokens: maxTokens || 2000,
          temperature: temperature || 0.2
        })
      }
    };

    const config = configs[provider];
    if (!config) {
      throw new Error(`不支持的AI提供商: ${provider}`);
    }

    return config;
  }

  /**
   * 提取AI响应内容
   */
  private extractAIResponse(data: any): string {
    const { provider } = this.settings;
    
    try {
      switch (provider) {
        case 'custom':
        case 'openai':
        case 'deepseek':
          return data.choices[0].message.content;
        case 'anthropic':
          return data.content[0].text;
        default:
          throw new Error(`不支持的提供商: ${provider}`);
      }
    } catch (error) {
      console.error('提取AI响应失败:', error, data);
      throw new Error('AI响应格式异常');
    }
  }

  /**
   * 解析语义分组结果（基于refcode的严格验证）
   */
  private parseSemanticGroupingResult(response: string, tabs: TabInfo[]): GroupResult {
    try {
      // 提取JSON内容
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('响应中未找到JSON格式');
      }

      const result = JSON.parse(jsonMatch[0]);
      
      // 验证必需字段
      if (!result.groups || !Array.isArray(result.groups)) {
        throw new Error('groups字段缺失或格式错误');
      }

      // 创建有效tabId集合
      const validTabIds = new Set(tabs.map(tab => tab.id));
      const usedTabIds = new Set<number>();

      // 验证和清理groups
      const cleanedGroups: TabGroup[] = [];
      
      for (const group of result.groups) {
        if (!this.validateGroup(group, validTabIds, usedTabIds)) {
          continue;
        }

        // 标记已使用的tabIds
        for (const tabId of group.tabIds) {
          usedTabIds.add(tabId);
        }

        cleanedGroups.push({
          id: `ai_group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          name: group.name || '未命名分组',
          description: group.description || '',
          tabIds: group.tabIds,
          confidence: Math.min(1.0, Math.max(0.0, group.confidence || 0.5)),
          reasoning: group.reasoning || '',
          createdAt: Date.now(),
          aiGenerated: true,
          attentionWeight: this.calculateGroupAttentionWeight(group.tabIds, tabs)
        });
      }

      // 处理未分组的标签页，自动创建兜底分组
      const ungroupedTabIds = Array.from(validTabIds).filter(tabId => !usedTabIds.has(tabId));
      
      // 如果存在未分组的标签页，创建兜底分组
      if (ungroupedTabIds.length > 0) {
        // 按域名分组未分组的标签页
        const ungroupedTabs = tabs.filter(tab => ungroupedTabIds.includes(tab.id));
        const domainGroups = new Map<string, number[]>();
        
        for (const tab of ungroupedTabs) {
          const domain = tab.domain || 'unknown';
          if (!domainGroups.has(domain)) {
            domainGroups.set(domain, []);
          }
          domainGroups.get(domain)!.push(tab.id);
        }
        
        // 为每个域名创建分组
        for (const [domain, tabIds] of domainGroups) {
          if (tabIds.length >= 2) {
            cleanedGroups.push({
              id: `ai_fallback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              name: domain === 'unknown' ? '其他页面' : this.cleanDomainName(domain),
              description: `${domain}相关页面`,
              tabIds: tabIds,
              confidence: 0.5,
              reasoning: 'AI兜底分组：基于域名的自动分组',
              createdAt: Date.now(),
              aiGenerated: true,
              attentionWeight: this.calculateGroupAttentionWeight(tabIds, tabs)
            });
            
            // 标记这些标签页已分组
            for (const tabId of tabIds) {
              usedTabIds.add(tabId);
            }
          }
        }
        
        // 剩余单个标签页创建通用分组
        const stillUngrouped = ungroupedTabIds.filter(tabId => !usedTabIds.has(tabId));
        if (stillUngrouped.length > 0) {
          cleanedGroups.push({
            id: `ai_misc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name: '其他页面',
            description: `${stillUngrouped.length}个未分类页面`,
            tabIds: stillUngrouped,
            confidence: 0.3,
            reasoning: 'AI兜底分组：收集其他未分类页面',
            createdAt: Date.now(),
            aiGenerated: true,
            attentionWeight: this.calculateGroupAttentionWeight(stillUngrouped, tabs)
          });
          
          // 标记所有剩余标签页已分组
          for (const tabId of stillUngrouped) {
            usedTabIds.add(tabId);
          }
        }
      }

      const ungrouped = Array.from(validTabIds).filter(tabId => !usedTabIds.has(tabId));

      // 清理actions字段
      const actions = {
        reuse: Array.isArray(result.actions?.reuse) ? result.actions.reuse : [],
        rename: Array.isArray(result.actions?.rename) ? result.actions.rename : [],
        merge: Array.isArray(result.actions?.merge) ? result.actions.merge : []
      };

      return {
        groups: cleanedGroups,
        ungrouped,
        actions,
        insights: result.insights || '已完成智能分组分析'
      };

    } catch (error) {
      console.error('解析AI分组响应失败:', error);
      throw new Error('AI响应解析失败，请重试');
    }
  }

  /**
   * 验证分组数据
   */
  private validateGroup(
    group: any, 
    validTabIds: Set<number>, 
    usedTabIds: Set<number>
  ): boolean {
    // 验证基本字段
    if (!group.name || typeof group.name !== 'string' || group.name.length > 50) {
      return false;
    }

    if (!Array.isArray(group.tabIds) || group.tabIds.length === 0) {
      return false;
    }

    // 验证tabIds有效性和唯一性
    for (const tabId of group.tabIds) {
      if (!Number.isInteger(tabId) || !validTabIds.has(tabId) || usedTabIds.has(tabId)) {
        return false;
      }
    }

    return true;
  }

  /**
   * 清理域名显示
   */
  private cleanDomainName(domain: string): string {
    return domain.replace('www.', '').split('.')[0];
  }

  /**
   * 计算分组注意力权重
   */
  private calculateGroupAttentionWeight(tabIds: number[], tabs: TabInfo[]): number {
    const tabMap = new Map(tabs.map(tab => [tab.id, tab]));
    const scores = tabIds
      .map(id => tabMap.get(id)?.attentionScore || 0)
      .filter(score => score > 0);
    
    if (scores.length === 0) return 0.5;
    
    return scores.reduce((sum, score) => sum + score, 0) / scores.length;
  }

  /**
   * 测试AI连接
   */
  async testConnection(): Promise<boolean> {
    try {
      const testPrompt = '请回复一个简单的JSON: {"status": "ok", "message": "连接成功"}';
      const response = await this.callAI(testPrompt);
      
      // 简单验证响应包含预期内容
      return response.includes('ok') || response.includes('成功');
    } catch (error) {
      console.error('AI连接测试失败:', error);
      return false;
    }
  }

  /**
   * 获取支持的模型列表
   */
  static getSupportedModels(provider: string): string[] {
    const models = {
      custom: ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo', 'claude-3-haiku', 'deepseek-chat'],
      openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'],
      anthropic: ['claude-3-haiku-20240307', 'claude-3-sonnet-20240229'],
      deepseek: ['deepseek-chat', 'deepseek-coder']
    };

    return models[provider as keyof typeof models] || [];
  }
}