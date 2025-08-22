// 应用状态
const app = {
    tabCount: 0,
    activeTabs: 0, // 替换注意力分数为活跃标签页数量
    groups: [],
    suggestions: [],
    loading: false,
    hasCachedGroups: false, // 是否有缓存的分组结果
    cachedGroups: [], // 缓存的分组结果
    lastGroupingTime: 0, // 上次分组时间
    dataQuality: null, // 数据质量信息
    enhancedTabs: [], // 增强的标签页数据
    groupingLevel: 'auto', // 分组级别：auto, basic, coarse, moderate, fine
    settings: {
        apiEndpoint: 'https://yunwu.zeabur.app',
        model: 'chatgpt-4o-mini',
        apiKey: ''
    }
};

// 初始化应用
async function init() {
    await loadSettings();
    await loadCachedGroups(); // 加载缓存的分组
    await getTabInfo();
    setupEventListeners();
    
    // 确保初始状态正确
    app.loading = false;
    hideLoading('ai');
    hideLoading('clean');
    
    // 设置初始为折叠状态
    setCollapseState();
    
    updateUI();
}

// 设置事件监听器
function setupEventListeners() {
    document.querySelector('.settings-btn').addEventListener('click', openSettings);
    document.getElementById('aiGroupingBtn').addEventListener('click', aiGrouping);
    document.getElementById('cleaningBtn').addEventListener('click', cleaningSuggestions);
    document.getElementById('groupsBackBtn').addEventListener('click', () => {
        // 重置状态（但保留缓存）
        app.loading = false;
        app.groups = [];
        app.suggestions = [];
        
        // 确保loading动画隐藏
        hideLoading('ai');
        hideLoading('clean');
        
        // 折叠面板并显示空状态
        setCollapseState();
        showSection('empty');
        
        updateUI();
    });
    document.getElementById('suggestionsBackBtn').addEventListener('click', () => {
        // 重置状态
        app.loading = false;
        app.groups = [];
        app.suggestions = [];
        
        // 确保loading动画隐藏
        hideLoading('ai');
        hideLoading('clean');
        
        // 折叠面板并显示空状态
        setCollapseState();
        showSection('empty');
        
        updateUI();
    });
    document.getElementById('regroupBtn').addEventListener('click', regroupTabs);
    document.getElementById('createAllGroupsBtn').addEventListener('click', createAllGroups);
    
    // 添加事件委托处理动态生成的按钮
    document.addEventListener('click', handleDynamicButtonClick);
}

// 处理动态生成的按钮点击事件
function handleDynamicButtonClick(event) {
    const target = event.target;
    const action = target.dataset.action;
    
    if (!action) return;
    
    switch (action) {
        case 'close-tab':
            const tabId = parseInt(target.dataset.tabId);
            if (tabId) {
                closeTab(tabId);
            }
            break;
            
        case 'create-group':
            const groupId = target.dataset.groupId;
            if (groupId) {
                createTabGroup(groupId);
            }
            break;
            
        case 'highlight-group':
            const highlightGroupId = target.dataset.groupId;
            if (highlightGroupId) {
                highlightGroup(highlightGroupId);
            }
            break;
            
        case 'close-group':
            const closeGroupId = target.dataset.groupId;
            if (closeGroupId) {
                closeGroup(closeGroupId);
            }
            break;
    }
}

// 加载设置
async function loadSettings() {
    try {
        const result = await chrome.storage.sync.get(['settings']);
        if (result.settings) {
            app.settings = { ...app.settings, ...result.settings };
        }
    } catch (error) {
        console.error('加载设置失败:', error);
    }
}

// 保存设置
async function saveSettings() {
    try {
        await chrome.storage.sync.set({ settings: app.settings });
    } catch (error) {
        console.error('保存设置失败:', error);
    }
}

// 加载缓存的分组
async function loadCachedGroups() {
    try {
        const result = await chrome.storage.local.get(['cachedGroups', 'lastGroupingTime']);
        if (result.cachedGroups && result.lastGroupingTime) {
            const timeSinceLastGrouping = Date.now() - result.lastGroupingTime;
            // 如果缓存时间不超过1小时，则使用缓存
            if (timeSinceLastGrouping < 60 * 60 * 1000) {
                app.cachedGroups = result.cachedGroups;
                app.lastGroupingTime = result.lastGroupingTime;
                app.hasCachedGroups = true;
                console.log('加载了缓存的分组结果:', app.cachedGroups.length, '个组');
            } else {
                console.log('缓存已过期，清除缓存');
                await clearCachedGroups();
            }
        }
    } catch (error) {
        console.error('加载缓存分组失败:', error);
    }
}

// 保存分组到缓存
async function saveCachedGroups(groups) {
    try {
        app.cachedGroups = groups;
        app.lastGroupingTime = Date.now();
        app.hasCachedGroups = true;
        
        await chrome.storage.local.set({ 
            cachedGroups: groups,
            lastGroupingTime: app.lastGroupingTime
        });
        console.log('分组结果已保存到缓存:', groups.length, '个组');
    } catch (error) {
        console.error('保存缓存分组失败:', error);
    }
}

// 清除缓存的分组
async function clearCachedGroups() {
    try {
        app.cachedGroups = [];
        app.lastGroupingTime = 0;
        app.hasCachedGroups = false;
        
        await chrome.storage.local.remove(['cachedGroups', 'lastGroupingTime']);
        console.log('缓存分组已清除');
    } catch (error) {
        console.error('清除缓存分组失败:', error);
    }
}

// 获取标签页信息 - 集成注意力数据
async function getTabInfo() {
    try {
        // 获取增强的注意力数据
        const response = await chrome.runtime.sendMessage({ action: 'getAttentionData' });
        if (response) {
            const newTabCount = response.tabs.length;
            
            // 只有在标签页数量显著变化时才清除缓存（变化超过3个标签页）
            if (app.tabCount > 0 && Math.abs(app.tabCount - newTabCount) > 3) {
                console.log(`标签页数量显著变化(${app.tabCount} -> ${newTabCount})，清除分组缓存`);
                await clearCachedGroups();
                app.groups = [];
            }
            
            app.tabCount = newTabCount;
            app.activeTabs = calculateActiveTabs(response.tabs);
            app.dataQuality = response.dataQuality;
            app.enhancedTabs = response.tabs;
            
            console.log('数据质量评估:', app.dataQuality);
            updateUI();
        } else {
            // 回退到基础标签页获取
            const tabs = await chrome.tabs.query({currentWindow: true});
            app.tabCount = tabs.length;
            app.activeTabs = calculateActiveTabs(tabs);
            updateUI();
        }
    } catch (error) {
        console.error('获取标签页信息失败:', error);
        // 回退处理
        const tabs = await chrome.tabs.query({currentWindow: true});
        app.tabCount = tabs.length;
        app.activeTabs = calculateActiveTabs(tabs);
        updateUI();
    }
}

// 计算活跃标签页数量
function calculateActiveTabs(tabs) {
    if (tabs.length === 0) return 0;
    
    const now = Date.now();
    let activeCount = 0;
    
    tabs.forEach(tab => {
        // 定义活跃标签页的标准：
        // 1. 最近1小时内访问过的
        // 2. 固定标签页
        // 3. 当前激活的标签页
        if (tab.active || tab.pinned || 
            (tab.lastAccessed && (now - tab.lastAccessed) < 60 * 60 * 1000)) {
            activeCount++;
        }
    });
    
    return activeCount;
}

// AI分组 - 优先显示缓存
async function aiGrouping() {
    if (app.loading) return;
    
    console.log('开始AI分组 - 检查缓存');
    
    // 优先检查是否有有效的缓存结果
    if (app.hasCachedGroups && app.cachedGroups.length > 0) {
        console.log('显示缓存的分组结果');
        
        // 验证缓存中的标签页是否仍然存在
        const currentTabs = await chrome.tabs.query({currentWindow: true});
        const currentTabIds = new Set(currentTabs.map(tab => tab.id));
        
        // 过滤出仍然存在的标签页
        const validGroups = app.cachedGroups.map(group => ({
            ...group,
            tabs: group.tabs.filter(tab => currentTabIds.has(tab.id))
        })).filter(group => group.tabs.length > 0);
        
        if (validGroups.length > 0) {
            app.groups = validGroups;
            app.suggestions = [];
            
            const cacheAge = Math.floor((Date.now() - app.lastGroupingTime) / (1000 * 60));
            showStatusInfo(`显示缓存的分组结果 (${validGroups.length} 个组，${cacheAge}分钟前)`);
            
            // 展开面板并显示分组
            setExpandedState();
            showSection('groups');
            
            updateUI();
            setTimeout(hideStatusInfo, 2000);
            return;
        } else {
            console.log('缓存的分组已失效，清除缓存');
            await clearCachedGroups();
        }
    }
    
    // 如果没有有效缓存，执行首次AI分组
    console.log('没有有效缓存，执行首次分组');
    await performInitialAIGrouping();
}

// 首次AI分组 - 支持渐进式调整
async function performInitialAIGrouping() {
    app.loading = true;
    showLoading('ai');
    showStatusInfo('正在分析标签页...');
    
    try {
        // 使用增强的标签页数据
        const tabs = app.enhancedTabs.length > 0 ? app.enhancedTabs : await chrome.tabs.query({currentWindow: true});
        console.log('获取到标签页:', tabs.length);
        
        // 根据数据质量决定分组策略
        const groupingStrategy = determineGroupingStrategy();
        showStatusInfo(`${groupingStrategy.description}...`);
        
        const groups = await performAIGrouping(tabs, groupingStrategy);
        console.log('AI分组完成，组数:', groups.length, '策略:', groupingStrategy.level);
        
        if (groups.length === 0) {
            showStatusInfo('未找到合适的分组');
            showSection('empty');
            await clearCachedGroups();
        } else {
            showStatusInfo(`${groupingStrategy.successMessage} (${groups.length} 个组)`);
            app.groups = groups;
            app.suggestions = [];
            app.groupingLevel = groupingStrategy.level;
            await saveCachedGroups(groups); // 保存到缓存
            
            // 展开面板并显示分组结果
            setExpandedState();
            showSection('groups');
            
            console.log('显示分组结果');
        }
        
        updateUI();
    } catch (error) {
        console.error('AI分组失败:', error);
        showError('AI分组失败，请检查API设置');
        showStatusInfo('分组失败，使用本地策略');
    } finally {
        console.log('AI分组finally块，重置loading状态');
        app.loading = false;
        hideLoading('ai');
        setTimeout(hideStatusInfo, 2000);
    }
}

// 确定分组策略
function determineGroupingStrategy() {
    const dataQuality = app.dataQuality;
    
    if (!dataQuality) {
        return {
            level: 'basic',
            description: '正在基础分组',
            successMessage: '完成基础分组',
            minGroupSize: 2,
            maxGroups: 4,
            useAttentionData: false
        };
    }
    
    const recommendedLevel = dataQuality.recommendedGroupingLevel;
    
    const strategies = {
        basic: {
            level: 'basic',
            description: '正在进行基础智能分组',
            successMessage: '完成基础分组',
            minGroupSize: 3,
            maxGroups: 3,
            useAttentionData: false
        },
        coarse: {
            level: 'coarse',
            description: '正在进行粗略智能分组',
            successMessage: '完成粗略分组',
            minGroupSize: 2,
            maxGroups: 4,
            useAttentionData: true,
            attentionWeight: 0.3
        },
        moderate: {
            level: 'moderate',
            description: '正在进行适中粒度智能分组',
            successMessage: '完成适中分组',
            minGroupSize: 2,
            maxGroups: 6,
            useAttentionData: true,
            attentionWeight: 0.5
        },
        fine: {
            level: 'fine',
            description: '正在进行精细智能分组',
            successMessage: '完成精细分组',
            minGroupSize: 2,
            maxGroups: 8,
            useAttentionData: true,
            attentionWeight: 0.7
        }
    };
    
    return strategies[recommendedLevel] || strategies.basic;
}

// 构建适应性提示词
function buildAdaptivePrompt(strategy, tabCount) {
    const basePrompt = `你是一个专业的智能标签页分组助手。你的目标是：基于用户的浏览行为和注意力模式，将标签页分成逻辑上相关的工作区，并返回严格 JSON 格式的结果。

【核心原则】
⚠️ 绝对禁止创建只包含1个标签页的分组！每个分组必须至少包含2个标签页！
⚠️ 宁可将相关性较弱的标签页合并为一个大组，也不要创建多个单标签页分组！
⚠️ 无法分组的单独标签页必须合并到"杂项工作区"组中！`;

    let specificGuidance = '';
    
    if (!strategy) {
        // 基础模式
        specificGuidance = `
【基础分组策略】
- 主要依据域名进行分组
- 保持简单，避免复杂的细分
- 总组数控制在2-4个
- 每组至少包含2个标签页`;
    } else {
        switch (strategy.level) {
            case 'basic':
                specificGuidance = `
【基础分组策略】
- 主要依据域名进行分组
- 简单的工作场景识别
- 总组数控制在${strategy.maxGroups}个
- 每组至少包含${strategy.minGroupSize}个标签页`;
                break;
                
            case 'coarse':
                specificGuidance = `
【粗略分组策略】
- 结合域名和基础注意力数据
- 识别主要工作场景：开发、学习、娱乐、办公
- 总组数控制在${strategy.maxGroups}个
- 注意力数据权重：${strategy.attentionWeight * 100}%
- 每组至少包含${strategy.minGroupSize}个标签页`;
                break;
                
            case 'moderate':
                specificGuidance = `
【适中分组策略】
- 深度分析注意力模式和使用习惯
- 识别详细工作场景和子分类
- 考虑标签页访问频率和活跃时间
- 分析工作流连续性和关联性
- 总组数控制在${strategy.maxGroups}个
- 注意力数据权重：${strategy.attentionWeight * 100}%
- 每组至少包含${strategy.minGroupSize}个标签页`;
                break;
                
            case 'fine':
                specificGuidance = `
【精细分组策略】
- 全面分析注意力数据、使用模式、工作流上下文
- 精确识别项目、主题、使用场景的细微差别
- 深度分析标签页之间的关联性和依赖关系
- 考虑打开顺序、访问模式、使用强度
- 识别特定的工作流和任务序列
- 总组数可达${strategy.maxGroups}个
- 注意力数据权重：${strategy.attentionWeight * 100}%
- 每组至少包含${strategy.minGroupSize}个标签页`;
                break;
        }
    }

    const outputFormat = `
【智能命名策略】
- **开发工作区**：GitHub仓库名 + "开发"，如"focuence开发工作区"
- **学习工作区**：主题 + "学习"，如"React学习工作区"
- **研究工作区**：领域 + "研究"，如"AI技术研究工作区"
- **娱乐工作区**：平台 + "娱乐"，如"YouTube娱乐工作区"
- **办公工作区**：功能 + "办公"，如"邮件协作办公区"
- **购物工作区**：商品类型 + "购物"，如"数码产品购物区"

【输出格式示例】
{
  "groups": [
    {
      "name": "focuence开发工作区", 
      "tabs": [12, 15, 18, 22],
      "reason": "GitHub上focuence项目的开发相关页面，包含代码仓库、问题追踪和文档",
      "status": "recently active"
    },
    {
      "name": "React学习工作区",
      "tabs": [21, 23, 25],
      "reason": "React技术学习相关页面，包含官方文档、教程和示例代码",
      "status": "normal"
    }
  ]
}

【约束与兜底】
- 回答必须是纯粹的 JSON 代码，不包含解释文字或代码块标记
- 禁止创建只有1个标签页的分组（违反此规则的分组将被自动合并）
- 所有无法归类的标签页必须放入"杂项工作区"组
- 组名必须有意义，避免"分组1"、"组A"等无意义名称
- 确保每个分组的tabs数组包含至少2个有效的标签页ID`;

    return basePrompt + specificGuidance + outputFormat;
}

// 构建用户提示词
function buildUserPrompt(tabData, strategy) {
    let analysisLevel = '';
    
    if (strategy?.useAttentionData) {
        analysisLevel = `
【注意力数据说明】
- attentionScore: 综合注意力分数 (0-1)
- totalActiveTime: 总活跃时间 (毫秒)
- activationCount: 激活次数
- openOrder: 打开顺序
- usagePattern: 使用模式 (intensive/scanning/reference/regular)
- contentCategory: 内容分类
- relationshipStrength: 与其他标签页的关联强度

请重点关注注意力分数高、激活次数多、活跃时间长的标签页，它们应该被优先考虑分组。`;
    }

    return `请根据${strategy?.level || 'basic'}分组策略，为以下 ${tabData.length} 个标签页进行智能分组：
${analysisLevel}

【标签页数据】
${JSON.stringify(tabData, null, 2)}

请返回符合要求的JSON格式分组结果。`;
}

// 执行AI分组
async function performAIGrouping(tabs, strategy = null) {
    if (!app.settings.apiKey) {
        console.log('API密钥未设置，使用回退策略');
        return fallbackGrouping(tabs, strategy);
    }
    
    console.log('开始AI分组，标签页数量:', tabs.length, '策略:', strategy?.level || 'default');
    
    // 构建增强版标签页数据
    const now = Date.now();
    const tabData = tabs.map(tab => {
        // 基础注意力分数
        let attentionScore = 0.5;
        let timeSinceLastAccess = 0;
        
        // 如果有增强数据，使用增强的注意力分数
        if (tab.attentionData && strategy?.useAttentionData) {
            attentionScore = tab.attentionData.attentionScore;
            timeSinceLastAccess = tab.attentionData.timeSinceLastActive;
        } else if (tab.lastAccessed) {
            timeSinceLastAccess = now - tab.lastAccessed;
            const hoursSinceLastAccess = timeSinceLastAccess / (1000 * 60 * 60);
            
            // 计算基础注意力分数
            if (hoursSinceLastAccess < 1) attentionScore += 0.3;
            else if (hoursSinceLastAccess < 6) attentionScore += 0.2;
            else if (hoursSinceLastAccess < 24) attentionScore += 0.1;
        }
        
        // 时间自然语言化
        let timeSinceLastAccessText = '未知';
        if (tab.lastAccessed || (tab.attentionData && tab.attentionData.lastActivated)) {
            const accessTime = tab.attentionData?.lastActivated || tab.lastAccessed;
            const timeDiff = now - accessTime;
            const minutes = Math.floor(timeDiff / (1000 * 60));
            const hours = Math.floor(timeDiff / (1000 * 60 * 60));
            const days = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
            
            if (minutes < 1) {
                timeSinceLastAccessText = '刚刚';
            } else if (minutes < 5) {
                timeSinceLastAccessText = '5分钟前';
            } else if (minutes < 60) {
                timeSinceLastAccessText = `大约${minutes}分钟前`;
            } else if (hours < 2) {
                timeSinceLastAccessText = `大约1小时前`;
            } else if (hours < 24) {
                timeSinceLastAccessText = `大约${hours}小时前`;
            } else if (days === 1) {
                timeSinceLastAccessText = '昨天';
            } else if (days < 7) {
                timeSinceLastAccessText = `${days}天前`;
            } else {
                timeSinceLastAccessText = '一周前';
            }
        }
        
        // 构建标签页数据
        const baseData = {
            id: tab.id,
            title: tab.title,
            url: tab.url,
            domain: tab.url ? new URL(tab.url).hostname : 'unknown',
            isPinned: tab.pinned || false,
            lastAccessed: tab.lastAccessed,
            timeSinceLastAccess: timeSinceLastAccess,
            timeSinceLastAccessText: timeSinceLastAccessText,
            attentionScore: Math.min(attentionScore, 1.0),
            windowId: tab.windowId,
            index: tab.index,
            activeTime: tab.activeTime || 0
        };
        
        // 如果有增强数据且策略支持，添加增强字段
        if (tab.attentionData && strategy?.useAttentionData) {
            return {
                ...baseData,
                // 增强的注意力数据
                openOrder: tab.attentionData.openOrder,
                totalActiveTime: tab.attentionData.totalActiveTime,
                activationCount: tab.attentionData.activationCount,
                averageSessionTime: tab.attentionData.averageSessionTime,
                accessPattern: tab.attentionData.accessPattern,
                recentActivity: tab.attentionData.recentActivity,
                workflowContext: tab.attentionData.workflowContext,
                contentCategory: tab.attentionData.contentCategory,
                usagePattern: tab.attentionData.workflowContext?.usagePattern || 'unknown',
                relationshipStrength: tab.attentionData.workflowContext?.relationshipStrength || 0
            };
        }
        
        return baseData;
    });
    
    console.log('发送给AI的标签页数据:', tabData);
    
    // 构建适应性提示词
    const systemPrompt = buildAdaptivePrompt(strategy, tabData.length);
    
    // 构建用户提示词
    const userPrompt = buildUserPrompt(tabData, strategy);

    try {
        // 调用AI API进行智能分组
        const response = await fetch(`${app.settings.apiEndpoint}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${app.settings.apiKey}`
            },
            body: JSON.stringify({
                model: app.settings.model,
                messages: [
                    {
                        role: 'system',
                        content: systemPrompt
                    },
                    {
                        role: 'user',
                        content: userPrompt
                    }
                ],
                temperature: 0.2, // 降低随机性，提高一致性
                max_tokens: 3000
            })
        });
        
        console.log('API响应状态:', response.status);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('API调用失败:', response.status, errorText);
            throw new Error(`API调用失败: ${response.status}`);
        }
        
        const data = await response.json();
        const aiResponse = data.choices[0].message.content;
        console.log('AI返回的响应:', aiResponse);
        
        // 解析AI返回的分组结果
        try {
            // 防御性检查：确保响应不为空
            if (!aiResponse || aiResponse.trim().length === 0) {
                console.warn('AI返回空响应，使用回退策略');
                return fallbackGrouping(tabs);
            }
            
            // 清理AI返回的markdown格式和多余文本
            let cleanJson = aiResponse.trim();
            
            // 移除markdown代码块标记
            if (cleanJson.startsWith('```json')) {
                cleanJson = cleanJson.substring(7);
            }
            if (cleanJson.startsWith('```')) {
                cleanJson = cleanJson.substring(3);
            }
            if (cleanJson.endsWith('```')) {
                cleanJson = cleanJson.substring(0, cleanJson.length - 3);
            }
            
            // 移除可能的注释和多余文本
            cleanJson = cleanJson.trim();
            
            // 防御性检查：验证是否包含基本的JSON结构
            if (!cleanJson.includes('{') || !cleanJson.includes('}')) {
                console.warn('AI响应不包含有效JSON结构，使用回退策略');
                return fallbackGrouping(tabs);
            }
            
            // 尝试找到JSON对象的开始和结束
            const jsonStart = cleanJson.indexOf('{');
            const jsonEnd = cleanJson.lastIndexOf('}');
            
            if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
                cleanJson = cleanJson.substring(jsonStart, jsonEnd + 1);
            } else {
                console.warn('无法找到完整的JSON对象，使用回退策略');
                return fallbackGrouping(tabs);
            }
            
            console.log('清理后的JSON:', cleanJson);
            
            const groupsData = JSON.parse(cleanJson);
            console.log('解析后的分组数据:', groupsData);
            
            // 防御性检查：验证分组数据的完整性
            if (!groupsData || (typeof groupsData !== 'object')) {
                console.warn('AI返回的数据结构无效，使用回退策略');
                return fallbackGrouping(tabs);
            }
            
            return convertToGroupFormat(groupsData, tabs);
        } catch (parseError) {
            console.error('AI返回的JSON解析失败:', parseError);
            console.log('原始AI响应:', aiResponse);
            console.log('使用回退分组策略');
            return fallbackGrouping(tabs);
        }
    } catch (apiError) {
        console.error('API调用异常:', apiError);
        console.log('使用回退分组策略');
        return fallbackGrouping(tabs);
    }
}

// 转换AI分组结果为应用格式
function convertToGroupFormat(aiGroups, tabs) {
    const groups = [];
    const tabMap = new Map(tabs.map(tab => [tab.id, tab]));
    
    console.log('转换AI分组结果，原始数据:', aiGroups);
    
    // 处理不同的AI响应格式
    let groupList = [];
    if (Array.isArray(aiGroups)) {
        groupList = aiGroups;
    } else if (aiGroups.groups && Array.isArray(aiGroups.groups)) {
        groupList = aiGroups.groups;
    } else {
        console.warn('未知的AI响应格式:', aiGroups);
        return fallbackGrouping(tabs);
    }
    
    // 防御性检查：确保分组列表不为空
    if (groupList.length === 0) {
        console.warn('AI返回空分组列表，使用回退策略');
        return fallbackGrouping(tabs);
    }
    
    const validGroups = [];
    const orphanTabs = []; // 收集孤立的标签页
    
    groupList.forEach((group, index) => {
        // 防御性检查：验证分组对象的基本结构
        if (!group || typeof group !== 'object') {
            console.warn(`跳过无效的分组对象 (索引 ${index}):`, group);
            return;
        }
        
        if (group.tabs && Array.isArray(group.tabs) && group.tabs.length > 0) {
            // 过滤出有效的标签页ID
            const validTabIds = group.tabs.filter(tabId => 
                typeof tabId === 'number' && tabMap.has(tabId)
            );
            
            const groupTabs = validTabIds
                .map(tabId => tabMap.get(tabId))
                .filter(tab => tab);
            
            if (groupTabs.length >= 2) { // 保留有2个或更多标签页的组
                // 确保所有必要字段都有合理的默认值
                const groupName = (group.name && typeof group.name === 'string') 
                    ? group.name 
                    : getSmartGroupName(groupTabs); // 使用智能命名
                const groupReason = (group.reason && typeof group.reason === 'string') 
                    ? group.reason 
                    : `包含${groupTabs.length}个相关标签页的工作区`;
                const groupStatus = ['recently active', 'stale', 'normal'].includes(group.status) 
                    ? group.status 
                    : determineGroupStatus(groupTabs);
                
                validGroups.push({
                    id: `ai-group-${index}`,
                    name: groupName,
                    reason: groupReason,
                    status: groupStatus,
                    tabs: groupTabs.map(tab => ({
                        id: tab.id,
                        title: tab.title,
                        url: tab.url
                    }))
                });
                console.log(`创建AI分组: ${groupName}, 包含 ${groupTabs.length} 个标签页`);
            } else if (groupTabs.length === 1) {
                // 收集单个标签页，稍后合并为杂项组
                orphanTabs.push(...groupTabs);
                console.log(`收集孤立标签页: ${group.name || groupTabs[0].title}`);
            }
        } else {
            console.warn(`跳过无效的分组数据 (索引 ${index}):`, group);
        }
    });
    
    // 如果有孤立的标签页，尝试进一步细分
    if (orphanTabs.length > 0) {
        const refinedGroups = refineOrphanTabs(orphanTabs);
        validGroups.push(...refinedGroups);
        console.log(`处理孤立标签页，创建了 ${refinedGroups.length} 个细分组`);
    }
    
    groups.push(...validGroups);
    
    // 将未分组的标签页按域名分组
    const groupedTabIds = new Set(groups.flatMap(g => g.tabs.map(t => t.id)));
    const ungroupedTabs = tabs.filter(tab => !groupedTabIds.has(tab.id));
    
    if (ungroupedTabs.length > 0) {
        console.log('未分组的标签页:', ungroupedTabs.length, '个');
        const domainGroups = groupByDomain(ungroupedTabs);
        groups.push(...domainGroups);
    }
    
    // 最终的兜底检查：如果AI分组完全失败，使用回退策略
    if (groups.length === 0 && tabs.length > 0) {
        console.warn('AI分组没有产生任何有效结果，使用回退策略');
        return fallbackGrouping(tabs);
    }
    
    console.log('最终转换结果:', groups.length, '个组');
    return groups;
}

// 智能回退分组策略
function fallbackGrouping(tabs, strategy = null) {
    console.log('使用回退分组策略，标签页数量:', tabs.length, '策略:', strategy?.level || 'basic');
    
    const groups = [];
    const minGroupSize = strategy?.minGroupSize || 2;
    const maxGroups = strategy?.maxGroups || 4;
    
    // 策略1: 按域名分组（最可靠）
    const domainGroups = groupByDomain(tabs, minGroupSize);
    groups.push(...domainGroups);
    console.log('域名分组结果:', domainGroups.length, '个组');
    
    // 如果已达到最大分组数，合并其余标签页
    if (groups.length >= maxGroups) {
        const groupedTabIds = new Set(groups.flatMap(g => g.tabs.map(t => t.id)));
        const ungroupedTabs = tabs.filter(tab => !groupedTabIds.has(tab.id));
        
        if (ungroupedTabs.length > 0) {
            // 找到最大的组并合并未分组的标签页
            const largestGroup = groups.reduce((max, current) => 
                current.tabs.length > max.tabs.length ? current : max
            );
            largestGroup.tabs.push(...ungroupedTabs.map(t => ({ id: t.id, title: t.title, url: t.url })));
            largestGroup.reason += `（包含${ungroupedTabs.length}个额外标签页）`;
        }
        
        console.log('达到最大分组数，合并完成');
        return groups;
    }
    
    // 获取未分组的标签页
    const groupedTabIds = new Set(groups.flatMap(g => g.tabs.map(t => t.id)));
    const ungroupedTabs = tabs.filter(tab => !groupedTabIds.has(tab.id));
    console.log('未分组的标签页:', ungroupedTabs.length);
    
    // 策略2: 根据分组级别决定进一步分组方式
    if (ungroupedTabs.length > 0 && groups.length < maxGroups) {
        if (strategy?.useAttentionData && strategy?.level !== 'basic') {
            // 使用注意力数据分组
            const attentionGroups = groupByAttentionData(ungroupedTabs, strategy);
            groups.push(...attentionGroups.slice(0, maxGroups - groups.length));
        } else {
            // 使用时间序列分组
            const timeGroups = groupByTimeSequence(ungroupedTabs, minGroupSize);
            groups.push(...timeGroups.slice(0, maxGroups - groups.length));
        }
    }
    
    // 最终处理未分组的标签页
    const finalGroupedTabIds = new Set(groups.flatMap(g => g.tabs.map(t => t.id)));
    const finalUngroupedTabs = tabs.filter(tab => !finalGroupedTabIds.has(tab.id));
    
    if (finalUngroupedTabs.length > 0) {
        if (finalUngroupedTabs.length >= minGroupSize) {
            // 创建杂项组
            groups.push({
                id: 'misc-group',
                name: '杂项工作区',
                reason: `包含${finalUngroupedTabs.length}个暂时无法归类的标签页`,
                status: 'normal',
                tabs: finalUngroupedTabs.map(t => ({ id: t.id, title: t.title, url: t.url }))
            });
        } else if (groups.length > 0) {
            // 合并到最大的组
            const largestGroup = groups.reduce((max, current) => 
                current.tabs.length > max.tabs.length ? current : max
            );
            largestGroup.tabs.push(...finalUngroupedTabs.map(t => ({ id: t.id, title: t.title, url: t.url })));
            largestGroup.reason += `（包含${finalUngroupedTabs.length}个额外标签页）`;
        }
    }
    
    console.log('最终分组结果:', groups.length, '个组');
    return groups;
}

// 根据注意力数据分组
function groupByAttentionData(tabs, strategy) {
    const groups = [];
    
    // 按注意力分数排序
    const sortedTabs = [...tabs].sort((a, b) => {
        const scoreA = a.attentionData?.attentionScore || 0.5;
        const scoreB = b.attentionData?.attentionScore || 0.5;
        return scoreB - scoreA;
    });
    
    // 按内容类别分组
    const categoryGroups = {};
    sortedTabs.forEach(tab => {
        const category = tab.attentionData?.contentCategory || 'general';
        if (!categoryGroups[category]) {
            categoryGroups[category] = [];
        }
        categoryGroups[category].push(tab);
    });
    
    // 创建分组
    const minGroupSize = strategy.minGroupSize || 2;
    for (const [category, categoryTabs] of Object.entries(categoryGroups)) {
        if (categoryTabs.length >= minGroupSize) {
            const categoryName = getCategoryDisplayName(category);
            groups.push({
                id: `attention-${category}`,
                name: `${categoryName}工作区`,
                reason: `基于注意力模式识别的${categoryName}相关标签页`,
                status: determineGroupStatus(categoryTabs),
                tabs: categoryTabs.map(t => ({ id: t.id, title: t.title, url: t.url }))
            });
        }
    }
    
    return groups;
}

// 获取分类显示名称
function getCategoryDisplayName(category) {
    const categoryNames = {
        development: '开发',
        learning: '学习',
        communication: '沟通',
        productivity: '效率',
        entertainment: '娱乐',
        shopping: '购物',
        social: '社交',
        news: '资讯',
        general: '通用'
    };
    
    return categoryNames[category] || '其他';
}

// 按标题关键词分组
function groupByKeywords(tabs) {
    const groups = [];
    const keywordMap = new Map();
    
    // 常见关键词
    const commonKeywords = [
        'github', 'google', 'stack', 'overflow', 'documentation', 'docs', 'api',
        'blog', 'news', 'article', 'tutorial', 'guide', 'reference', 'search',
        'home', 'main', 'index', 'dashboard', 'admin', 'login', 'profile'
    ];
    
    tabs.forEach(tab => {
        const title = tab.title.toLowerCase();
        const url = tab.url.toLowerCase();
        
        // 查找匹配的关键词
        let matchedKeyword = null;
        for (const keyword of commonKeywords) {
            if (title.includes(keyword) || url.includes(keyword)) {
                matchedKeyword = keyword;
                break;
            }
        }
        
        if (matchedKeyword) {
            if (!keywordMap.has(matchedKeyword)) {
                keywordMap.set(matchedKeyword, []);
            }
            keywordMap.get(matchedKeyword).push(tab);
        }
    });
    
    // 创建关键词分组
    keywordMap.forEach((groupTabs, keyword) => {
        if (groupTabs.length >= 2) {
            groups.push({
                id: `keyword-${keyword}`,
                name: getSmartGroupName(groupTabs),
                reason: `包含相同关键词 "${keyword}" 的标签页`,
                status: determineGroupStatus(groupTabs),
                tabs: groupTabs.map(t => ({ id: t.id, title: t.title, url: t.url }))
            });
        }
    });
    
    return groups;
}

// 按时间序列分组
function groupByTimeSequence(tabs, minGroupSize = 2) {
    const groups = [];
    const sortedTabs = [...tabs].sort((a, b) => (a.index || 0) - (b.index || 0));
    
    if (sortedTabs.length < minGroupSize) return groups;
    
    let currentGroup = [sortedTabs[0]];
    
    for (let i = 1; i < sortedTabs.length; i++) {
        const currentTab = sortedTabs[i];
        const previousTab = sortedTabs[i - 1];
        
        const indexGap = currentTab.index - previousTab.index;
        const timeGap = currentTab.lastAccessed && previousTab.lastAccessed ? 
            Math.abs(currentTab.lastAccessed - previousTab.lastAccessed) : 0;
        
        // 判断是否应该分组的条件：
        // 1. 索引间隔不超过5
        // 2. 时间间隔不超过10分钟
        // 3. 或者有相同的域名
        const shouldGroup = indexGap <= 5 || 
                           (timeGap > 0 && timeGap < 10 * 60 * 1000) ||
                           (currentTab.url && previousTab.url && 
                            getDomainFromUrl(currentTab.url) === getDomainFromUrl(previousTab.url));
        
        if (shouldGroup) {
            currentGroup.push(currentTab);
        } else {
            // 当前组结束，创建新组
            if (currentGroup.length >= minGroupSize) {
                groups.push({
                    id: `time-group-${groups.length}`,
                    name: getSmartGroupName(currentGroup),
                    reason: '在相近时间内打开或访问的标签页',
                    status: determineGroupStatus(currentGroup),
                    tabs: currentGroup.map(t => ({ id: t.id, title: t.title, url: t.url }))
                });
            }
            currentGroup = [currentTab];
        }
    }
    
    // 处理最后一组
    if (currentGroup.length >= minGroupSize) {
        groups.push({
            id: `time-group-${groups.length}`,
            name: getSmartGroupName(currentGroup),
            reason: '在相近时间内打开或访问的标签页',
            status: determineGroupStatus(currentGroup),
            tabs: currentGroup.map(t => ({ id: t.id, title: t.title, url: t.url }))
        });
    }
    
    return groups;
}

// 从URL获取域名
function getDomainFromUrl(url) {
    try {
        return new URL(url).hostname;
    } catch {
        return '';
    }
}

// 按域名分组（优化版，避免单标签组）
function groupByDomain(tabs, minGroupSize = 2) {
    const domainGroups = {};
    
    tabs.forEach(tab => {
        try {
            const url = new URL(tab.url);
            const domain = url.hostname;
            
            if (!domainGroups[domain]) {
                domainGroups[domain] = [];
            }
            domainGroups[domain].push(tab);
        } catch (error) {
            // 忽略无效URL
        }
    });
    
    // 只返回有足够标签页的组
    return Object.entries(domainGroups)
        .filter(([_, tabs]) => tabs.length >= minGroupSize)
        .map(([domain, tabs]) => ({
            id: `domain-${domain}`,
            name: getSmartGroupName(tabs),
            reason: `来自相同域名 ${domain} 的标签页`,
            status: determineGroupStatus(tabs),
            tabs: tabs.map(t => ({ id: t.id, title: t.title, url: t.url }))
        }));
}

// 获取智能分组的名称
function getSmartGroupName(tabs) {
    if (tabs.length === 0) return '空组';
    
    // 分析标签页特征
    const domains = tabs.map(tab => {
        try {
            return new URL(tab.url).hostname;
        } catch {
            return '未知';
        }
    });
    
    const titles = tabs.map(tab => tab.title || '');
    const urls = tabs.map(tab => tab.url || '');
    const uniqueDomains = [...new Set(domains)];
    
    // 策略1: 识别工作区模式
    const workspacePattern = identifyWorkspacePattern(tabs, domains, titles, urls);
    if (workspacePattern) {
        return workspacePattern;
    }
    
    // 策略2: 如果都是同一个域名，使用增强的域名分析
    if (uniqueDomains.length === 1) {
        return getEnhancedDomainName(uniqueDomains[0], titles, urls);
    }
    
    // 策略3: 分析内容主题
    const themeAnalysis = analyzeContentTheme(titles, urls, domains);
    if (themeAnalysis) {
        return themeAnalysis;
    }
    
    // 策略4: 多域名工作流识别
    if (uniqueDomains.length <= 3) {
        const workflowName = identifyWorkflow(uniqueDomains, titles);
        if (workflowName) {
            return workflowName;
        }
        return uniqueDomains.map(d => getDomainName(d)).join(' & ');
    }
    
    // 策略5: 基于注意力模式
    const attentionPattern = analyzeAttentionPattern(tabs);
    if (attentionPattern) {
        return attentionPattern;
    }
    
    return '杂项工作区';
}

// 识别工作区模式
function identifyWorkspacePattern(tabs, domains, titles, urls) {
    const allText = titles.concat(urls).join(' ').toLowerCase();
    
    // 开发工作区
    if (allText.includes('github') || allText.includes('git') || 
        allText.includes('pull request') || allText.includes('commit') ||
        allText.includes('repository') || allText.includes('code') ||
        allText.includes('vs code') || allText.includes('programming')) {
        
        const repoNames = extractGitHubRepoNames(urls);
        if (repoNames.length > 0) {
            return `开发: ${repoNames[0]}`;
        }
        return '代码开发工作区';
    }
    
    // 学习工作区
    if (allText.includes('tutorial') || allText.includes('course') ||
        allText.includes('learn') || allText.includes('documentation') ||
        allText.includes('docs') || allText.includes('guide') ||
        allText.includes('教程') || allText.includes('学习') ||
        allText.includes('教学') || allText.includes('培训')) {
        
        const mainTopic = extractLearningTopic(titles, urls);
        if (mainTopic) {
            return `学习: ${mainTopic}`;
        }
        return '学习研究工作区';
    }
    
    // 购物工作区
    if (allText.includes('cart') || allText.includes('buy') ||
        allText.includes('shop') || allText.includes('purchase') ||
        allText.includes('price') || allText.includes('product') ||
        allText.includes('购物') || allText.includes('商品') ||
        allText.includes('价格') || allText.includes('订单')) {
        return '购物比价工作区';
    }
    
    // 研究工作区
    if (allText.includes('research') || allText.includes('paper') ||
        allText.includes('academic') || allText.includes('scholar') ||
        allText.includes('analysis') || allText.includes('study') ||
        allText.includes('研究') || allText.includes('论文') ||
        allText.includes('学术') || allText.includes('分析')) {
        return '学术研究工作区';
    }
    
    // 设计工作区
    if (allText.includes('design') || allText.includes('figma') ||
        allText.includes('adobe') || allText.includes('sketch') ||
        allText.includes('ui') || allText.includes('ux') ||
        allText.includes('设计') || allText.includes('创意')) {
        return '设计创作工作区';
    }
    
    // 工作办公区
    if (allText.includes('mail') || allText.includes('email') ||
        allText.includes('calendar') || allText.includes('meeting') ||
        allText.includes('slack') || allText.includes('notion') ||
        allText.includes('office') || allText.includes('工作') ||
        allText.includes('会议') || allText.includes('邮件')) {
        return '办公协作工作区';
    }
    
    // 娱乐工作区
    if (allText.includes('youtube') || allText.includes('video') ||
        allText.includes('music') || allText.includes('game') ||
        allText.includes('entertainment') || allText.includes('bilibili') ||
        allText.includes('视频') || allText.includes('音乐') ||
        allText.includes('游戏') || allText.includes('娱乐')) {
        return '娱乐休闲工作区';
    }
    
    return null;
}

// 提取GitHub仓库名
function extractGitHubRepoNames(urls) {
    const repoNames = [];
    urls.forEach(url => {
        const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
        if (match && match[2]) {
            repoNames.push(match[2]);
        }
    });
    return [...new Set(repoNames)];
}

// 提取学习主题
function extractLearningTopic(titles, urls) {
    const allText = titles.join(' ').toLowerCase();
    
    // 技术主题
    const techTopics = ['javascript', 'python', 'react', 'vue', 'node', 'java', 
                       'golang', 'rust', 'typescript', 'css', 'html', 'docker',
                       'kubernetes', 'aws', 'azure', 'machine learning', 'ai'];
    
    for (const topic of techTopics) {
        if (allText.includes(topic)) {
            return topic.charAt(0).toUpperCase() + topic.slice(1);
        }
    }
    
    // 学科主题
    const academicTopics = ['数学', '物理', '化学', '计算机', '经济', '管理', '心理学'];
    for (const topic of academicTopics) {
        if (allText.includes(topic)) {
            return topic;
        }
    }
    
    return null;
}

// 分析内容主题
function analyzeContentTheme(titles, urls, domains) {
    const allText = titles.join(' ').toLowerCase();
    const urlText = urls.join(' ').toLowerCase();
    
    // 新闻资讯
    if (domains.some(d => d.includes('news') || d.includes('cn') || d.includes('com.cn')) ||
        allText.includes('新闻') || allText.includes('资讯') || allText.includes('news')) {
        return '新闻资讯';
    }
    
    // 社交媒体
    if (domains.some(d => ['twitter.com', 'weibo.com', 'zhihu.com', 'reddit.com'].includes(d))) {
        return '社交媒体';
    }
    
    // 技术文档
    if (allText.includes('api') || allText.includes('documentation') || 
        allText.includes('docs') || allText.includes('reference')) {
        return '技术文档';
    }
    
    return null;
}

// 识别工作流
function identifyWorkflow(domains, titles) {
    const domainSet = new Set(domains);
    
    // 开发工作流
    if (domainSet.has('github.com') && 
        (domainSet.has('stackoverflow.com') || domainSet.has('developer.mozilla.org'))) {
        return '开发调试工作流';
    }
    
    // 设计工作流  
    if (domainSet.has('figma.com') && domainSet.has('dribbble.com')) {
        return '设计灵感工作流';
    }
    
    // 研究工作流
    if (domainSet.has('google.com') && 
        (domainSet.has('scholar.google.com') || domainSet.has('arxiv.org'))) {
        return '学术研究工作流';
    }
    
    return null;
}

// 精细化处理孤立标签页
function refineOrphanTabs(orphanTabs) {
    const refinedGroups = [];
    const remainingTabs = [...orphanTabs];
    
    // 1. 按访问时间分组（最近活跃 vs 待清理）
    const now = Date.now();
    const recentTabs = [];
    const staleTabs = [];
    const normalTabs = [];
    
    remainingTabs.forEach(tab => {
        if (tab.lastAccessed) {
            const timeDiff = now - tab.lastAccessed;
            const hoursDiff = timeDiff / (1000 * 60 * 60);
            
            if (hoursDiff <= 2) {
                recentTabs.push(tab);
            } else if (hoursDiff >= 24) {
                staleTabs.push(tab);
            } else {
                normalTabs.push(tab);
            }
        } else {
            normalTabs.push(tab);
        }
    });
    
    // 2. 按内容类型细分
    const contentGroups = categorizeByContent(normalTabs.concat(recentTabs));
    
    // 3. 创建最近活跃组（如果有足够的标签页）
    if (recentTabs.length >= 2) {
        refinedGroups.push({
            id: 'recent-active-group',
            name: '最近活跃工作区',
            reason: `包含最近2小时内访问的${recentTabs.length}个标签页`,
            status: 'recently active',
            tabs: recentTabs.map(tab => ({
                id: tab.id,
                title: tab.title,
                url: tab.url
            }))
        });
    }
    
    // 4. 创建内容分类组
    contentGroups.forEach(group => {
        if (group.tabs.length >= 2) {
            refinedGroups.push(group);
        }
    });
    
    // 5. 创建待清理组（如果有足够的标签页）
    if (staleTabs.length >= 2) {
        refinedGroups.push({
            id: 'stale-cleanup-group',
            name: '待清理工作区',
            reason: `包含超过24小时未访问的${staleTabs.length}个标签页，建议清理`,
            status: 'stale',
            tabs: staleTabs.map(tab => ({
                id: tab.id,
                title: tab.title,
                url: tab.url
            }))
        });
    }
    
    // 6. 收集所有未分组的标签页
    const groupedTabIds = new Set(refinedGroups.flatMap(g => g.tabs.map(t => t.id)));
    const stillOrphanTabs = orphanTabs.filter(tab => !groupedTabIds.has(tab.id));
    
    // 7. 如果还有未分组的标签页，创建杂项组
    if (stillOrphanTabs.length >= 2) {
        refinedGroups.push({
            id: 'misc-group',
            name: '其他工作区',
            reason: `包含${stillOrphanTabs.length}个暂时无法归类的标签页`,
            status: determineGroupStatus(stillOrphanTabs),
            tabs: stillOrphanTabs.map(tab => ({
                id: tab.id,
                title: tab.title,
                url: tab.url
            }))
        });
    } else if (stillOrphanTabs.length === 1) {
        // 单个孤立标签页合并到最合适的现有组
        if (refinedGroups.length > 0) {
            const targetGroup = refinedGroups[refinedGroups.length - 1]; // 合并到最后一个组
            targetGroup.tabs.push({
                id: stillOrphanTabs[0].id,
                title: stillOrphanTabs[0].title,
                url: stillOrphanTabs[0].url
            });
            targetGroup.reason += `（包含1个额外标签页）`;
        }
    }
    
    return refinedGroups;
}

// 按内容类型分类
function categorizeByContent(tabs) {
    const categories = {
        news: [],
        social: [],
        tools: [],
        docs: [],
        search: [],
        media: []
    };
    
    tabs.forEach(tab => {
        const title = tab.title.toLowerCase();
        const url = tab.url.toLowerCase();
        const domain = getDomainFromUrl(tab.url);
        
        // 新闻资讯
        if (domain.includes('news') || title.includes('新闻') || 
            title.includes('资讯') || url.includes('news')) {
            categories.news.push(tab);
        }
        // 社交媒体
        else if (['twitter.com', 'weibo.com', 'zhihu.com', 'reddit.com', 
                  'facebook.com', 'instagram.com'].some(d => domain.includes(d))) {
            categories.social.push(tab);
        }
        // 在线工具
        else if (title.includes('tool') || title.includes('工具') || 
                 title.includes('generator') || title.includes('converter') ||
                 url.includes('tool') || url.includes('util')) {
            categories.tools.push(tab);
        }
        // 文档资料
        else if (title.includes('docs') || title.includes('documentation') ||
                 title.includes('manual') || title.includes('文档') ||
                 title.includes('帮助') || url.includes('doc')) {
            categories.docs.push(tab);
        }
        // 搜索结果
        else if (domain.includes('google') || domain.includes('baidu') ||
                 domain.includes('bing') || title.includes('搜索')) {
            categories.search.push(tab);
        }
        // 媒体内容
        else if (domain.includes('youtube') || domain.includes('bilibili') ||
                 title.includes('video') || title.includes('视频') ||
                 title.includes('music') || title.includes('音乐')) {
            categories.media.push(tab);
        }
    });
    
    const groups = [];
    
    // 创建各类别的分组
    if (categories.news.length >= 2) {
        groups.push({
            id: 'news-group',
            name: '新闻资讯工作区',
            reason: `包含${categories.news.length}个新闻资讯相关页面`,
            status: 'normal',
            tabs: categories.news.map(tab => ({
                id: tab.id,
                title: tab.title,
                url: tab.url
            }))
        });
    }
    
    if (categories.social.length >= 2) {
        groups.push({
            id: 'social-group',
            name: '社交媒体工作区',
            reason: `包含${categories.social.length}个社交媒体平台页面`,
            status: 'normal',
            tabs: categories.social.map(tab => ({
                id: tab.id,
                title: tab.title,
                url: tab.url
            }))
        });
    }
    
    if (categories.tools.length >= 2) {
        groups.push({
            id: 'tools-group',
            name: '在线工具工作区',
            reason: `包含${categories.tools.length}个在线工具和实用程序`,
            status: 'normal',
            tabs: categories.tools.map(tab => ({
                id: tab.id,
                title: tab.title,
                url: tab.url
            }))
        });
    }
    
    if (categories.docs.length >= 2) {
        groups.push({
            id: 'docs-group',
            name: '文档资料工作区',
            reason: `包含${categories.docs.length}个文档和帮助页面`,
            status: 'normal',
            tabs: categories.docs.map(tab => ({
                id: tab.id,
                title: tab.title,
                url: tab.url
            }))
        });
    }
    
    if (categories.search.length >= 2) {
        groups.push({
            id: 'search-group',
            name: '搜索结果工作区',
            reason: `包含${categories.search.length}个搜索引擎结果页面`,
            status: 'normal',
            tabs: categories.search.map(tab => ({
                id: tab.id,
                title: tab.title,
                url: tab.url
            }))
        });
    }
    
    if (categories.media.length >= 2) {
        groups.push({
            id: 'media-group',
            name: '媒体内容工作区',
            reason: `包含${categories.media.length}个视频音频等媒体页面`,
            status: 'normal',
            tabs: categories.media.map(tab => ({
                id: tab.id,
                title: tab.title,
                url: tab.url
            }))
        });
    }
    
    return groups;
}

// 增强的域名命名
function getEnhancedDomainName(domain, titles, urls) {
    const baseName = getDomainName(domain);
    
    // 特殊域名的智能命名
    if (domain === 'github.com') {
        const repoNames = extractGitHubRepoNames(urls);
        if (repoNames.length > 0) {
            return `GitHub: ${repoNames[0]}`;
        }
        return 'GitHub 开发';
    }
    
    if (domain === 'stackoverflow.com') {
        return '技术问答';
    }
    
    if (domain === 'youtube.com') {
        const commonWords = extractCommonKeywords(titles);
        if (commonWords.length > 0) {
            return `YouTube: ${commonWords[0]}`;
        }
        return 'YouTube 视频';
    }
    
    if (domain === 'zhihu.com') {
        return '知乎讨论';
    }
    
    if (domain === 'bilibili.com') {
        return 'B站视频';
    }
    
    // 分析标题是否有共同主题
    const titleKeywords = extractCommonKeywords(titles);
    if (titleKeywords.length > 0) {
        return `${baseName}: ${titleKeywords.join(' ')}`;
    }
    
    return `${baseName} 工作区`;
}

// 提取关键词
function extractKeywords(titles) {
    const keywords = [];
    const commonTechTerms = [
        'github', 'git', 'code', 'programming', 'development', 'api', 'documentation',
        'docs', 'tutorial', 'guide', 'reference', 'stack', 'overflow', 'blog',
        'news', 'article', 'search', 'google', 'youtube', 'video', 'music',
        'email', 'mail', 'calendar', 'drive', 'docs', 'sheets', 'slides',
        'admin', 'dashboard', 'login', 'profile', 'settings', 'config'
    ];
    
    const titleText = titles.join(' ').toLowerCase();
    
    for (const term of commonTechTerms) {
        if (titleText.includes(term)) {
            keywords.push(term);
        }
    }
    
    return [...new Set(keywords)].slice(0, 3); // 最多返回3个关键词
}

// 提取共同关键词
function extractCommonKeywords(titles) {
    const allWords = titles.flatMap(title => 
        title.toLowerCase().split(/[\s\-_.]+/).filter(word => word.length > 2)
    );
    
    const wordCount = {};
    allWords.forEach(word => {
        wordCount[word] = (wordCount[word] || 0) + 1;
    });
    
    // 返回出现次数超过一半的词
    const threshold = Math.max(2, Math.floor(titles.length / 2));
    return Object.entries(wordCount)
        .filter(([word, count]) => count >= threshold)
        .map(([word]) => word)
        .slice(0, 2);
}

// 分析注意力模式
function analyzeAttentionPattern(tabs) {
    const now = Date.now();
    const recentTabs = tabs.filter(tab => 
        tab.lastAccessed && (now - tab.lastAccessed) < 30 * 60 * 1000 // 30分钟内
    );
    
    if (recentTabs.length >= tabs.length * 0.6) {
        return '最近活跃';
    }
    
    const oldTabs = tabs.filter(tab => 
        tab.lastAccessed && (now - tab.lastAccessed) > 2 * 60 * 60 * 1000 // 2小时前
    );
    
    if (oldTabs.length >= tabs.length * 0.6) {
        return '待清理';
    }
    
    return null;
}

// 确定分组状态
function determineGroupStatus(tabs) {
    const now = Date.now();
    
    // 计算最近活跃的标签页数量（30分钟内访问）
    const recentTabs = tabs.filter(tab => 
        tab.lastAccessed && (now - tab.lastAccessed) < 30 * 60 * 1000
    );
    
    // 计算较旧的标签页数量（2小时前访问）
    const staleTabs = tabs.filter(tab => 
        tab.lastAccessed && (now - tab.lastAccessed) > 2 * 60 * 60 * 1000
    );
    
    // 根据比例确定状态
    if (recentTabs.length >= tabs.length * 0.6) {
        return 'recently active';
    } else if (staleTabs.length >= tabs.length * 0.6) {
        return 'stale';
    } else {
        return 'normal';
    }
}

// 获取域名名称
function getDomainName(domain) {
    const parts = domain.split('.');
    if (parts.length > 2) {
        return parts[parts.length - 2].charAt(0).toUpperCase() + parts[parts.length - 2].slice(1);
    }
    return domain.charAt(0).toUpperCase() + domain.slice(1);
}

// 清理建议
async function cleaningSuggestions() {
    if (app.loading) return;
    
    console.log('开始清理建议');
    app.loading = true;
    showLoading('clean');
    showStatusInfo('正在分析标签页使用情况...');
    
    try {
        const tabs = await chrome.tabs.query({currentWindow: true});
        console.log('获取到标签页:', tabs.length);
        showStatusInfo(`分析了 ${tabs.length} 个标签页`);
        
        const suggestions = await generateCleaningSuggestions(tabs);
        console.log('清理建议完成，建议数:', suggestions.length);
        
        if (suggestions.length === 0) {
            showStatusInfo('没有发现需要清理的标签页');
            showSection('empty');
        } else {
            showStatusInfo(`发现 ${suggestions.length} 个待清理标签页`);
            app.suggestions = suggestions;
            app.groups = [];
            
            // 展开面板并显示清理建议
            setExpandedState();
            showSection('suggestions');
            
            console.log('显示清理建议结果');
        }
        
        updateUI();
    } catch (error) {
        console.error('生成清理建议失败:', error);
        showError('生成清理建议失败');
        showStatusInfo('分析失败');
    } finally {
        console.log('清理建议finally块，重置loading状态');
        app.loading = false;
        hideLoading('clean');
        setTimeout(hideStatusInfo, 2000);
    }
}

// 生成清理建议
async function generateCleaningSuggestions(tabs) {
    const now = Date.now();
    const suggestions = [];
    
    tabs.forEach(tab => {
        let reason = '';
        let priority = 0;
        
        // 检查是否长时间未访问
        if (tab.lastAccessed) {
            const timeDiff = now - tab.lastAccessed;
            const hoursDiff = timeDiff / (1000 * 60 * 60);
            
            if (hoursDiff > 24) {
                reason = '超过24小时未访问';
                priority = 1;
            }
            if (hoursDiff > 72) {
                reason = '超过3天未访问';
                priority = 2;
            }
        }
        
        // 检查是否是重复页面
        const duplicateTabs = tabs.filter(t => t.url === tab.url);
        if (duplicateTabs.length > 1) {
            reason = `重复页面 (${duplicateTabs.length}个)`;
            priority = 2;
        }
        
        if (priority > 0) {
            suggestions.push({
                tabId: tab.id,
                title: tab.title,
                reason: reason,
                priority: priority
            });
        }
    });
    
    return suggestions.sort((a, b) => b.priority - a.priority).slice(0, 10);
}

// 关闭标签页
async function closeTab(tabId) {
    try {
        await chrome.tabs.remove(tabId);
        
        // 更新数据
        app.groups = app.groups.map(group => ({
            ...group,
            tabs: group.tabs.filter(tab => tab.id !== tabId)
        })).filter(group => group.tabs.length > 0);
        
        app.suggestions = app.suggestions.filter(suggestion => suggestion.tabId !== tabId);
        
        // 重新获取标签页信息
        await getTabInfo();
        
        // 如果没有内容了，显示空状态
        if (app.groups.length === 0 && app.suggestions.length === 0) {
            showSection('empty');
        }
    } catch (error) {
        console.error('关闭标签页失败:', error);
    }
}

// 创建真正的Chrome标签页分组
async function createTabGroup(groupId) {
    console.log('创建Chrome分组:', groupId);
    const group = app.groups.find(g => g.id === groupId);
    if (!group) {
        console.error('未找到分组:', groupId);
        return;
    }
    
    try {
        console.log('分组信息:', group);
        
        // 获取组内标签页的当前ID
        const tabIds = group.tabs.map(tab => tab.id);
        console.log('要分组的标签页ID:', tabIds);
        
        // 检查Chrome是否支持tab grouping API
        if (chrome.tabs.group) {
            try {
                // 创建标签页分组
                const groupId = await chrome.tabs.group({
                    tabIds: tabIds,
                    createProperties: {
                        windowId: (await chrome.windows.getCurrent()).id
                    }
                });
                
                // 设置分组标题
                if (chrome.tabGroups) {
                    await chrome.tabGroups.update(groupId, {
                        title: group.name,
                        collapsed: false
                    });
                }
                
                showStatus(`已创建分组 "${group.name}"`);
                
                // 重新获取标签页信息但保留分组显示
                setTimeout(async () => {
                    await getTabInfo();
                    // 不清空分组显示，让用户看到结果
                }, 1000);
                
            } catch (groupError) {
                console.error('Chrome分组失败，使用回退方案:', groupError);
                await fallbackGroupingAction(group);
            }
        } else {
            console.log('浏览器不支持tab grouping API，使用回退方案');
            await fallbackGroupingAction(group);
        }
        
    } catch (error) {
        console.error('创建分组失败:', error);
        showError('创建分组失败: ' + error.message);
    }
}

// 回退分组方案（高亮+状态提示）
async function fallbackGroupingAction(group) {
    try {
        // 高亮组内标签页
        await highlightGroup(group.id);
        
        // 显示提示告知用户已进行逻辑分组
        showStatus(`已逻辑分组 "${group.name}"（浏览器限制）`);
        
    } catch (error) {
        console.error('回退分组方案失败:', error);
        showError('分组操作失败');
    }
}

// 高亮分组
async function highlightGroup(groupId) {
    console.log('高亮分组:', groupId);
    const group = app.groups.find(g => g.id === groupId);
    if (!group) {
        console.error('未找到分组:', groupId);
        return;
    }
    
    try {
        console.log('分组信息:', group);
        console.log('标签页索引:', group.tabs.map(tab => tab.index));
        
        // 获取当前窗口信息
        const currentWindow = await chrome.windows.getCurrent();
        console.log('当前窗口ID:', currentWindow.id);
        
        // 获取所有标签页的最新信息
        const currentTabs = await chrome.tabs.query({currentWindow: true});
        console.log('当前标签页:', currentTabs.map(t => ({id: t.id, index: t.index, title: t.title})));
        
        // 创建标签页ID到索引的映射
        const tabIdToIndex = new Map(currentTabs.map(tab => [tab.id, tab.index]));
        
        // 获取组内标签页的当前索引
        const tabIndices = group.tabs.map(tab => {
            const currentIndex = tabIdToIndex.get(tab.id);
            console.log(`标签页 ${tab.id} (${tab.title}) 的索引: ${currentIndex}`);
            return currentIndex;
        }).filter(index => index !== undefined);
        
        if (tabIndices.length === 0) {
            showError('组内标签页已不存在');
            return;
        }
        
        console.log('要高亮的标签页索引:', tabIndices);
        
        // 高亮组内的所有标签页
        await chrome.tabs.highlight({
            tabs: tabIndices,
            windowId: currentWindow.id
        });
        
        // 显示提示
        showStatus(`已高亮 "${group.name}" 组的 ${tabIndices.length} 个标签页`);
    } catch (error) {
        console.error('高亮分组失败:', error);
        showError('高亮分组失败: ' + error.message);
    }
}

// 关闭分组
async function closeGroup(groupId) {
    console.log('关闭分组:', groupId);
    const group = app.groups.find(g => g.id === groupId);
    if (!group) {
        console.error('未找到分组:', groupId);
        return;
    }
    
    try {
        console.log('分组信息:', group);
        
        // 关闭组内的所有标签页
        const tabIds = group.tabs.map(tab => tab.id);
        console.log('要关闭的标签页ID:', tabIds);
        
        await chrome.tabs.remove(tabIds);
        
        // 更新数据
        app.groups = app.groups.filter(g => g.id !== groupId);
        
        // 重新获取标签页信息
        await getTabInfo();
        
        // 如果没有内容了，显示空状态
        if (app.groups.length === 0 && app.suggestions.length === 0) {
            showSection('empty');
        }
        
        showStatus(`已关闭 "${group.name}" 组的 ${tabIds.length} 个标签页`);
    } catch (error) {
        console.error('关闭分组失败:', error);
        showError('关闭分组失败: ' + error.message);
    }
}

// 打开设置
function openSettings() {
    chrome.runtime.openOptionsPage();
}

// 显示状态消息
function showStatus(message) {
    const statusDiv = document.createElement('div');
    statusDiv.style.cssText = `
        position: fixed;
        top: 10px;
        left: 50%;
        transform: translateX(-50%);
        background: #d1fae5;
        color: #065f46;
        padding: 8px 16px;
        border-radius: 6px;
        font-size: 12px;
        z-index: 1000;
    `;
    statusDiv.textContent = message;
    document.body.appendChild(statusDiv);
    
    setTimeout(() => {
        if (document.body.contains(statusDiv)) {
            document.body.removeChild(statusDiv);
        }
    }, 2000);
}

// 显示状态信息
function showStatusInfo(message) {
    const statusInfo = document.getElementById('statusInfo');
    if (statusInfo) {
        statusInfo.textContent = message;
        statusInfo.style.display = 'block';
        
        // 3秒后隐藏
        setTimeout(() => {
            statusInfo.style.display = 'none';
        }, 3000);
    }
}

// 隐藏状态信息
function hideStatusInfo() {
    const statusInfo = document.getElementById('statusInfo');
    if (statusInfo) {
        statusInfo.style.display = 'none';
    }
}

// 显示错误
function showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = `
        position: fixed;
        top: 10px;
        left: 50%;
        transform: translateX(-50%);
        background: #fee2e2;
        color: #dc2626;
        padding: 8px 16px;
        border-radius: 6px;
        font-size: 12px;
        z-index: 1000;
    `;
    errorDiv.textContent = message;
    document.body.appendChild(errorDiv);
    
    setTimeout(() => {
        if (document.body.contains(errorDiv)) {
            document.body.removeChild(errorDiv);
        }
    }, 3000);
}

// 显示加载状态
function showLoading(type) {
    if (type === 'ai') {
        document.getElementById('aiLoading').style.display = 'inline-block';
    } else if (type === 'clean') {
        document.getElementById('cleanLoading').style.display = 'inline-block';
    }
}

// 隐藏加载状态
function hideLoading(type) {
    console.log('隐藏loading:', type);
    if (type === 'ai') {
        const aiLoading = document.getElementById('aiLoading');
        if (aiLoading) {
            aiLoading.style.display = 'none';
            console.log('AI loading已隐藏');
        }
    } else if (type === 'clean') {
        const cleanLoading = document.getElementById('cleanLoading');
        if (cleanLoading) {
            cleanLoading.style.display = 'none';
            console.log('清理loading已隐藏');
        }
    }
}

// 显示指定部分
function showSection(section) {
    // 隐藏所有部分
    document.getElementById('groupsSection').style.display = 'none';
    document.getElementById('suggestionsSection').style.display = 'none';
    document.getElementById('emptyState').style.display = 'none';
    
    // 显示指定部分
    if (section === 'groups') {
        document.getElementById('groupsSection').style.display = 'block';
    } else if (section === 'suggestions') {
        document.getElementById('suggestionsSection').style.display = 'block';
    } else if (section === 'empty') {
        document.getElementById('emptyState').style.display = 'block';
    }
}

// 更新UI
function updateUI() {
    // 更新统计信息
    document.getElementById('tabCount').textContent = app.tabCount;
    document.getElementById('activeTabs').textContent = app.activeTabs;
    
    // 更新按钮状态
    document.getElementById('aiGroupingBtn').disabled = app.loading;
    document.getElementById('cleaningBtn').disabled = app.loading;
    
    // 确保 loading 动画状态正确
    if (!app.loading) {
        hideLoading('ai');
        hideLoading('clean');
    }
    
    // 更新分组区域
    const groupsContainer = document.getElementById('groupsContainer');
    const groupsElement = document.getElementById('groupsSection').querySelector('.groups');
    
    if (app.groups.length > 0) {
        groupsContainer.innerHTML = app.groups.map(group => {
            const statusClass = group.status === 'recently active' ? 'status-active' : 
                               group.status === 'stale' ? 'status-stale' : 'status-normal';
            const statusText = group.status === 'recently active' ? '最近活跃' : 
                              group.status === 'stale' ? '待清理' : '正常';
            
            return `
            <div class="group ${statusClass}">
                <div class="group-header">
                    <div class="group-name">${group.name}</div>
                    <div class="group-count">${group.tabs.length}</div>
                    <div class="group-status ${statusClass}">${statusText}</div>
                </div>
                ${group.reason ? `<div class="group-reason">${group.reason}</div>` : ''}
                <div class="group-tabs">
                    ${group.tabs.map(tab => `
                        <div class="tab-item">
                            <span class="tab-title">${tab.title}</span>
                            <button class="tab-close" data-tab-id="${tab.id}" data-action="close-tab" title="关闭">✕</button>
                        </div>
                    `).join('')}
                </div>
                <div class="group-actions">
                    <button class="group-btn create-group-btn" data-group-id="${group.id}" data-action="create-group">创建分组</button>
                    <button class="group-btn highlight-group-btn" data-group-id="${group.id}" data-action="highlight-group">高亮</button>
                    <button class="group-btn close-group-btn" data-group-id="${group.id}" data-action="close-group">关闭组</button>
                </div>
            </div>
        `;
        }).join('');
        
        // 应用自适应样式
        adaptPanelSize(app.groups.length);
    } else {
        groupsContainer.innerHTML = '';
    }
    
    // 更新清理建议区域
    const suggestionsContainer = document.getElementById('suggestionsContainer');
    if (app.suggestions.length > 0) {
        suggestionsContainer.innerHTML = app.suggestions.map(suggestion => `
            <div class="suggestion">
                <div class="suggestion-content">
                    <span class="suggestion-title">${suggestion.title}</span>
                    <span class="suggestion-reason">${suggestion.reason}</span>
                </div>
                <button class="suggestion-close" data-tab-id="${suggestion.tabId}" data-action="close-tab">关闭</button>
            </div>
        `).join('');
        
        // 应用自适应样式
        adaptPanelSize(app.suggestions.length, 'suggestions');
    } else {
        suggestionsContainer.innerHTML = '';
    }
}

// 根据内容数量自适应面板大小
function adaptPanelSize(itemCount, type = 'groups') {
    const container = document.querySelector('.container');
    const content = document.querySelector('.content');
    const groupsElement = document.querySelector('.groups');
    
    // 移除之前的适应性类
    container.classList.remove('auto-height', 'fixed-height');
    if (groupsElement) {
        groupsElement.classList.remove('few-groups', 'many-groups');
    }
    
    // 清除之前设置的内联样式
    container.style.height = '';
    
    // 计算实际需要的高度
    setTimeout(() => {
        const actualContentHeight = content.scrollHeight;
        const baseHeight = 280; // 头部、统计、按钮、底部的基础高度
        const totalHeight = baseHeight + actualContentHeight;
        
        console.log(`内容实际高度: ${actualContentHeight}px, 总高度需求: ${totalHeight}px, 项目数量: ${itemCount}`);
        
        // 根据内容决定使用哪种展开模式
        if (totalHeight <= 480 && itemCount <= 3) {
            // 普通展开模式 - 面板展开显示所有内容，无滚动条
            setExpandedState();
            container.classList.add('auto-height');
            if (groupsElement) groupsElement.classList.add('few-groups');
            console.log('应用普通展开模式 - 无滚动条');
        } else if (totalHeight <= 700 && itemCount <= 6) {
            // 完全展开模式 - 面板展开显示更多内容
            setExpandedState();
            container.classList.add('fixed-height');
            if (groupsElement) groupsElement.classList.add('many-groups');
            console.log('应用展开模式 - 适度滚动条');
        } else {
            // 完全展开模式 - 内容很多时使用固定高度和滚动条
            setFullyExpandedState();
            container.classList.add('fixed-height');
            if (groupsElement) groupsElement.classList.add('many-groups');
            console.log('应用完全展开模式 - 显示滚动条');
        }
    }, 50);
}

// 设置折叠状态
function setCollapseState() {
    document.body.className = 'collapsed';
    console.log('设置为折叠状态');
}

// 设置展开状态
function setExpandedState() {
    document.body.className = 'expanded';
    console.log('设置为展开状态');
}

// 设置完全展开状态
function setFullyExpandedState() {
    document.body.className = 'fully-expanded';
    console.log('设置为完全展开状态');
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', init);

// 再次分组（强制重新调用API）
async function regroupTabs() {
    if (app.loading) return;
    
    console.log('开始再次分组 - 强制重新调用API');
    
    // 清除缓存，强制重新分组
    await clearCachedGroups();
    app.groups = [];
    
    app.loading = true;
    showLoading('ai');
    showStatusInfo('正在重新分析标签页...');
    
    try {
        const tabs = await chrome.tabs.query({currentWindow: true});
        console.log('获取到标签页:', tabs.length);
        showStatusInfo(`找到 ${tabs.length} 个标签页，正在重新智能分组...`);
        
        const groups = await performAIGrouping(tabs);
        console.log('重新分组完成，组数:', groups.length);
        
        if (groups.length === 0) {
            showStatusInfo('未找到合适的分组');
            showSection('empty');
            await clearCachedGroups();
        } else {
            showStatusInfo(`重新分组为 ${groups.length} 个组`);
            app.groups = groups;
            app.suggestions = [];
            await saveCachedGroups(groups); // 保存新的分组结果
            
            // 保持展开状态并显示重新分组结果
            setExpandedState();
            showSection('groups');
            
            console.log('显示重新分组结果');
        }
        
        updateUI();
    } catch (error) {
        console.error('重新分组失败:', error);
        showError('重新分组失败，请检查API设置');
        showStatusInfo('重新分组失败');
    } finally {
        console.log('重新分组finally块，重置loading状态');
        app.loading = false;
        hideLoading('ai');
        setTimeout(hideStatusInfo, 2000);
    }
}

// 全部分组功能
async function createAllGroups() {
    if (app.loading) return;
    
    console.log('开始全部分组');
    app.loading = true;
    
    try {
        let successCount = 0;
        let failCount = 0;
        
        for (const group of app.groups) {
            try {
                await createTabGroup(group.id);
                successCount++;
            } catch (error) {
                console.error(`创建分组 ${group.name} 失败:`, error);
                failCount++;
            }
        }
        
        if (successCount > 0) {
            showStatus(`成功创建 ${successCount} 个分组${failCount > 0 ? `，${failCount} 个失败` : ''}`);
        } else {
            showError('全部分组失败');
        }
        
    } catch (error) {
        console.error('全部分组失败:', error);
        showError('全部分组失败');
    } finally {
        app.loading = false;
    }
}

// 全局暴露函数
window.app = {
    closeTab,
    createTabGroup,
    highlightGroup,
    closeGroup,
    openSettings,
    aiGrouping,
    cleaningSuggestions,
    regroupTabs,
    createAllGroups
};