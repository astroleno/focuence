// 应用状态
const app = {
    tabCount: 0,
    attentionScore: 0,
    groups: [],
    suggestions: [],
    loading: false,
    hasCachedGroups: false, // 是否有缓存的分组结果
    settings: {
        apiEndpoint: 'https://yunwu.zeabur.app',
        model: 'chatgpt-4o-mini',
        apiKey: ''
    }
};

// 初始化应用
async function init() {
    await loadSettings();
    await getTabInfo();
    setupEventListeners();
}

// 设置事件监听器
function setupEventListeners() {
    document.querySelector('.settings-btn').addEventListener('click', openSettings);
    document.getElementById('aiGroupingBtn').addEventListener('click', aiGrouping);
    document.getElementById('cleaningBtn').addEventListener('click', cleaningSuggestions);
    document.getElementById('groupsBackBtn').addEventListener('click', () => {
        app.loading = false; // 重置loading状态
        app.hasCachedGroups = false; // 清除缓存
        showSection('empty');
        updateUI(); // 更新UI状态
    });
    document.getElementById('suggestionsBackBtn').addEventListener('click', () => {
        app.loading = false; // 重置loading状态
        showSection('empty');
        updateUI(); // 更新UI状态
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

// 获取标签页信息
async function getTabInfo() {
    try {
        const tabs = await chrome.tabs.query({currentWindow: true});
        app.tabCount = tabs.length;
        app.attentionScore = calculateAttentionScore(tabs);
        updateUI();
    } catch (error) {
        console.error('获取标签页信息失败:', error);
    }
}

// 计算注意力分数
function calculateAttentionScore(tabs) {
    if (tabs.length === 0) return 0;
    
    const now = Date.now();
    let totalScore = 0;
    
    tabs.forEach(tab => {
        let score = 0.5; // 基础分数
        
        // 根据最后访问时间调整分数
        if (tab.lastAccessed) {
            const timeDiff = now - tab.lastAccessed;
            const hoursDiff = timeDiff / (1000 * 60 * 60);
            if (hoursDiff < 1) score += 0.3;
            else if (hoursDiff < 6) score += 0.2;
            else if (hoursDiff < 24) score += 0.1;
        }
        
        // 根据标题长度调整分数
        if (tab.title && tab.title.length > 20) score += 0.1;
        
        totalScore += Math.min(score, 1.0);
    });
    
    return totalScore / tabs.length;
}

// AI分组
async function aiGrouping() {
    if (app.loading) return;
    
    console.log('开始AI分组');
    app.loading = true;
    showLoading('ai');
    showStatusInfo('正在分析标签页...');
    
    try {
        const tabs = await chrome.tabs.query({currentWindow: true});
        console.log('获取到标签页:', tabs.length);
        
        // 如果有缓存的分组结果，直接显示
        if (app.hasCachedGroups && app.groups.length > 0) {
            console.log('显示缓存的分组结果');
            showStatusInfo(`显示缓存的分组结果 (${app.groups.length} 个组)`);
            app.suggestions = [];
            showSection('groups');
            updateUI();
            return;
        }
        
        showStatusInfo(`找到 ${tabs.length} 个标签页，正在智能分组...`);
        
        const groups = await performAIGrouping(tabs);
        console.log('AI分组完成，组数:', groups.length);
        
        if (groups.length === 0) {
            showStatusInfo('未找到合适的分组');
            showSection('empty');
            app.hasCachedGroups = false;
        } else {
            showStatusInfo(`成功分组为 ${groups.length} 个组`);
            app.groups = groups;
            app.suggestions = [];
            app.hasCachedGroups = true; // 标记有缓存
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

// 执行AI分组
async function performAIGrouping(tabs) {
    if (!app.settings.apiKey) {
        console.log('API密钥未设置，使用回退策略');
        return fallbackGrouping(tabs);
    }
    
    console.log('开始AI分组，标签页数量:', tabs.length);
    
    // 构建增强版标签页数据
    const now = Date.now();
    const tabData = tabs.map(tab => {
        let attentionScore = 0.5;
        let timeSinceLastAccess = 0;
        
        if (tab.lastAccessed) {
            timeSinceLastAccess = now - tab.lastAccessed;
            const hoursSinceLastAccess = timeSinceLastAccess / (1000 * 60 * 60);
            
            // 计算注意力分数
            if (hoursSinceLastAccess < 1) attentionScore += 0.3;
            else if (hoursSinceLastAccess < 6) attentionScore += 0.2;
            else if (hoursSinceLastAccess < 24) attentionScore += 0.1;
        }
        
        // 时间自然语言化
        let timeSinceLastAccessText = '未知';
        if (tab.lastAccessed) {
            const minutes = Math.floor(timeSinceLastAccess / (1000 * 60));
            const hours = Math.floor(timeSinceLastAccess / (1000 * 60 * 60));
            const days = Math.floor(timeSinceLastAccess / (1000 * 60 * 60 * 24));
            
            if (minutes < 1) {
                timeSinceLastAccessText = '刚刚';
            } else if (minutes < 60) {
                timeSinceLastAccessText = `${minutes}分钟前`;
            } else if (hours < 24) {
                timeSinceLastAccessText = `${hours}小时前`;
            } else {
                timeSinceLastAccessText = `${days}天前`;
            }
        }
        
        return {
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
    });
    
    console.log('发送给AI的标签页数据:', tabData);
    
    // 优化后的提示词
    const systemPrompt = `你是一个专业的智能标签页分组助手。你的目标是：基于用户的浏览行为和注意力模式，将标签页分成逻辑上相关的工作组，并返回严格 JSON 格式的结果。

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
你的回答必须是纯粹的 JSON 代码，不包含任何解释性文字或代码块标记。

如果有些标签页实在无法与任何其他页面形成有意义的分组，将它们放入一个名为 "杂项标签页" 的组中。

禁止产生空的 tabs 数组。`;

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
                        content: `请将以下${tabs.length}个标签页进行智能分组。考虑它们的打开顺序、域名、访问时间和注意力模式：

${JSON.stringify(tabData, null, 2)}

请提供合理的分组建议。`
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
            
            // 尝试找到JSON对象的开始和结束
            const jsonStart = cleanJson.indexOf('{');
            const jsonEnd = cleanJson.lastIndexOf('}');
            
            if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
                cleanJson = cleanJson.substring(jsonStart, jsonEnd + 1);
            }
            
            console.log('清理后的JSON:', cleanJson);
            
            const groupsData = JSON.parse(cleanJson);
            console.log('解析后的分组数据:', groupsData);
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
    
    groupList.forEach((group, index) => {
        if (group.tabs && Array.isArray(group.tabs) && group.tabs.length > 0) {
            const groupTabs = group.tabs
                .map(tabId => tabMap.get(tabId))
                .filter(tab => tab);
            
            if (groupTabs.length >= 2) { // 只保留有2个或更多标签页的组
                groups.push({
                    id: `ai-group-${index}`,
                    name: group.name || `AI分组 ${index + 1}`,
                    reason: group.reason || 'AI智能分组',
                    status: group.status || 'normal',
                    tabs: groupTabs.map(tab => ({
                        id: tab.id,
                        title: tab.title,
                        url: tab.url
                    }))
                });
                console.log(`创建AI分组: ${group.name}, 包含 ${groupTabs.length} 个标签页`);
            }
        }
    });
    
    // 将未分组的标签页按域名分组
    const groupedTabIds = new Set(groups.flatMap(g => g.tabs.map(t => t.id)));
    const ungroupedTabs = tabs.filter(tab => !groupedTabIds.has(tab.id));
    
    if (ungroupedTabs.length > 0) {
        console.log('未分组的标签页:', ungroupedTabs.length, '个');
        const domainGroups = groupByDomain(ungroupedTabs);
        groups.push(...domainGroups);
    }
    
    console.log('最终转换结果:', groups.length, '个组');
    return groups;
}

// 智能回退分组策略
function fallbackGrouping(tabs) {
    console.log('使用回退分组策略，标签页数量:', tabs.length);
    
    const groups = [];
    
    // 策略1: 按域名分组（最可靠）
    const domainGroups = groupByDomain(tabs);
    groups.push(...domainGroups);
    console.log('域名分组结果:', domainGroups.length, '个组');
    
    // 获取未分组的标签页
    const groupedTabIds = new Set(groups.flatMap(g => g.tabs.map(t => t.id)));
    const ungroupedTabs = tabs.filter(tab => !groupedTabIds.has(tab.id));
    console.log('未分组的标签页:', ungroupedTabs.length);
    
    // 策略2: 按时间序列分组
    if (ungroupedTabs.length > 0) {
        const timeGroups = groupByTimeSequence(ungroupedTabs);
        groups.push(...timeGroups);
        console.log('时间分组结果:', timeGroups.length, '个组');
    }
    
    // 更新未分组标签页
    const groupedTabIdsAfterTime = new Set(groups.flatMap(g => g.tabs.map(t => t.id)));
    const stillUngroupedTabs = tabs.filter(tab => !groupedTabIdsAfterTime.has(tab.id));
    console.log('仍然未分组的标签页:', stillUngroupedTabs.length);
    
    // 策略3: 按标题关键词分组
    if (stillUngroupedTabs.length > 0) {
        const keywordGroups = groupByKeywords(stillUngroupedTabs);
        groups.push(...keywordGroups);
        console.log('关键词分组结果:', keywordGroups.length, '个组');
    }
    
    console.log('最终分组结果:', groups.length, '个组');
    return groups;
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
                tabs: groupTabs.map(t => ({ id: t.id, title: t.title, url: t.url }))
            });
        }
    });
    
    return groups;
}

// 按时间序列分组
function groupByTimeSequence(tabs) {
    const groups = [];
    const sortedTabs = [...tabs].sort((a, b) => (a.index || 0) - (b.index || 0));
    
    if (sortedTabs.length < 2) return groups;
    
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
            if (currentGroup.length >= 2) {
                groups.push({
                    id: `time-group-${groups.length}`,
                    name: getSmartGroupName(currentGroup),
                    tabs: currentGroup.map(t => ({ id: t.id, title: t.title, url: t.url }))
                });
            }
            currentGroup = [currentTab];
        }
    }
    
    // 处理最后一组
    if (currentGroup.length >= 2) {
        groups.push({
            id: `time-group-${groups.length}`,
            name: getSmartGroupName(currentGroup),
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
function groupByDomain(tabs) {
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
    
    // 只返回有2个或更多标签页的组
    return Object.entries(domainGroups)
        .filter(([_, tabs]) => tabs.length >= 2)
        .map(([domain, tabs]) => ({
            id: `domain-${domain}`,
            name: getSmartGroupName(tabs),
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
    const uniqueDomains = [...new Set(domains)];
    
    // 策略1: 如果都是同一个域名，使用域名作为组名
    if (uniqueDomains.length === 1) {
        return getEnhancedDomainName(uniqueDomains[0], titles);
    }
    
    // 策略2: 分析标题关键词
    const keywords = extractKeywords(titles);
    if (keywords.length > 0) {
        return keywords.join(' & ');
    }
    
    // 策略3: 多域名组合
    if (uniqueDomains.length <= 3) {
        return uniqueDomains.map(d => getDomainName(d)).join(' & ');
    }
    
    // 策略4: 基于注意力模式
    const attentionPattern = analyzeAttentionPattern(tabs);
    if (attentionPattern) {
        return attentionPattern;
    }
    
    return '相关标签页';
}

// 增强的域名命名
function getEnhancedDomainName(domain, titles) {
    const baseName = getDomainName(domain);
    
    // 分析标题是否有共同主题
    const titleKeywords = extractCommonKeywords(titles);
    if (titleKeywords.length > 0) {
        return `${baseName} - ${titleKeywords.join(' ')}`;
    }
    
    return baseName;
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
    document.getElementById('attentionScore').textContent = app.attentionScore.toFixed(1);
    
    // 更新按钮状态
    document.getElementById('aiGroupingBtn').disabled = app.loading;
    document.getElementById('cleaningBtn').disabled = app.loading;
    
    // 更新分组区域
    const groupsContainer = document.getElementById('groupsContainer');
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
    } else {
        suggestionsContainer.innerHTML = '';
    }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', init);

// 再次分组（重新向AI请求）
async function regroupTabs() {
    if (app.loading) return;
    
    console.log('开始再次分组');
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
            app.hasCachedGroups = false;
        } else {
            showStatusInfo(`重新分组为 ${groups.length} 个组`);
            app.groups = groups;
            app.suggestions = [];
            app.hasCachedGroups = true;
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