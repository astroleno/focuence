// 后台服务脚本 - 增强注意力数据收集
let attentionData = new Map(); // tabId -> 注意力数据
let sessionStartTime = Date.now();
let activeTabId = null;
let tabActivationTime = null;
let tabOpenOrder = 0; // 全局标签页打开顺序

chrome.runtime.onInstalled.addListener((details) => {
    console.log('Focuence智序已安装');
    
    // 初始化默认设置
    const defaultSettings = {
        apiEndpoint: 'https://yunwu.zeabur.app',
        model: 'chatgpt-4o-mini',
        apiKey: '',
        autoGrouping: false,
        cleaningSuggestions: true
    };
    
    chrome.storage.sync.get(['settings'], (result) => {
        if (!result.settings) {
            chrome.storage.sync.set({ settings: defaultSettings });
        }
    });
    
    // 初始化注意力数据收集
    initializeAttentionTracking();
});

// 初始化注意力追踪
async function initializeAttentionTracking() {
    // 获取现有标签页并初始化数据
    const tabs = await chrome.tabs.query({});
    tabs.forEach(tab => {
        initializeTabAttentionData(tab);
    });
    
    // 获取当前活跃标签页
    const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTabs.length > 0) {
        activeTabId = activeTabs[0].id;
        tabActivationTime = Date.now();
    }
    
    console.log('注意力追踪系统已初始化');
}

// 初始化单个标签页的注意力数据
function initializeTabAttentionData(tab) {
    if (!attentionData.has(tab.id)) {
        attentionData.set(tab.id, {
            id: tab.id,
            url: tab.url,
            title: tab.title,
            domain: getDomainFromUrl(tab.url),
            openTime: Date.now(),
            openOrder: ++tabOpenOrder,
            totalActiveTime: 0, // 总活跃时间（毫秒）
            activationCount: 0, // 激活次数
            lastActivated: null,
            averageSessionTime: 0, // 平均会话时间
            attentionScore: 0, // 注意力分数 (0-1)
            accessPattern: [], // 访问模式记录
            recentActivity: {
                lastHour: 0,
                last24Hours: 0,
                lastWeek: 0
            },
            interactions: {
                scrolls: 0,
                clicks: 0,
                typing: 0
            },
            metadata: {
                isPinned: tab.pinned || false,
                isAudible: tab.audible || false,
                windowId: tab.windowId,
                index: tab.index
            }
        });
    }
}

// 监听标签页创建
chrome.tabs.onCreated.addListener((tab) => {
    initializeTabAttentionData(tab);
    console.log(`新标签页创建: ${tab.id}, 顺序: ${tabOpenOrder}`);
});

// 监听标签页更新
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // 更新标签页信息
    if (attentionData.has(tabId)) {
        const data = attentionData.get(tabId);
        data.url = tab.url;
        data.title = tab.title;
        data.domain = getDomainFromUrl(tab.url);
        data.metadata.isPinned = tab.pinned || false;
        data.metadata.isAudible = tab.audible || false;
    } else {
        initializeTabAttentionData(tab);
    }
    
    if (changeInfo.status === 'complete') {
        // 标签页加载完成，记录访问模式
        recordAccessPattern(tabId, 'loaded');
    }
});

// 监听标签页激活
chrome.tabs.onActivated.addListener((activeInfo) => {
    const now = Date.now();
    
    // 记录上一个标签页的活跃时间
    if (activeTabId && tabActivationTime && attentionData.has(activeTabId)) {
        const sessionTime = now - tabActivationTime;
        updateTabActiveTime(activeTabId, sessionTime);
    }
    
    // 切换到新标签页
    activeTabId = activeInfo.tabId;
    tabActivationTime = now;
    
    // 更新新标签页的激活数据
    if (attentionData.has(activeTabId)) {
        const data = attentionData.get(activeTabId);
        data.lastActivated = now;
        data.activationCount++;
        recordAccessPattern(activeTabId, 'activated');
        updateRecentActivity(activeTabId);
        
        console.log(`标签页激活: ${activeTabId}, 激活次数: ${data.activationCount}`);
    }
});

// 监听标签页移除
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    // 记录最后的活跃时间
    if (tabId === activeTabId && tabActivationTime) {
        const sessionTime = Date.now() - tabActivationTime;
        updateTabActiveTime(tabId, sessionTime);
    }
    
    // 保存数据到持久化存储（可选，用于历史分析）
    if (attentionData.has(tabId)) {
        const data = attentionData.get(tabId);
        saveTabDataToHistory(data);
        attentionData.delete(tabId);
    }
    
    if (tabId === activeTabId) {
        activeTabId = null;
        tabActivationTime = null;
    }
    
    console.log(`标签页关闭: ${tabId}`);
});

// 监听窗口焦点变化
chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
        // 窗口失去焦点，暂停计时
        if (activeTabId && tabActivationTime) {
            const sessionTime = Date.now() - tabActivationTime;
            updateTabActiveTime(activeTabId, sessionTime);
            tabActivationTime = null; // 暂停计时
        }
    } else {
        // 窗口获得焦点，重新开始计时
        if (activeTabId) {
            tabActivationTime = Date.now();
        }
    }
});

// 更新标签页活跃时间
function updateTabActiveTime(tabId, sessionTime) {
    if (!attentionData.has(tabId)) return;
    
    const data = attentionData.get(tabId);
    data.totalActiveTime += sessionTime;
    
    // 计算平均会话时间
    if (data.activationCount > 0) {
        data.averageSessionTime = data.totalActiveTime / data.activationCount;
    }
    
    // 计算注意力分数 (0-1)
    data.attentionScore = calculateAttentionScore(data);
    
    console.log(`更新活跃时间: 标签页${tabId}, 会话时长: ${sessionTime}ms, 总时长: ${data.totalActiveTime}ms`);
}

// 记录访问模式
function recordAccessPattern(tabId, action) {
    if (!attentionData.has(tabId)) return;
    
    const data = attentionData.get(tabId);
    const now = Date.now();
    
    data.accessPattern.push({
        timestamp: now,
        action: action, // 'activated', 'loaded', 'closed'
        sessionOrder: data.accessPattern.length + 1
    });
    
    // 保持最近50次访问记录
    if (data.accessPattern.length > 50) {
        data.accessPattern = data.accessPattern.slice(-50);
    }
}

// 更新最近活动
function updateRecentActivity(tabId) {
    if (!attentionData.has(tabId)) return;
    
    const data = attentionData.get(tabId);
    const now = Date.now();
    
    // 最近1小时
    if (now - data.lastActivated < 60 * 60 * 1000) {
        data.recentActivity.lastHour++;
    }
    
    // 最近24小时
    if (now - data.lastActivated < 24 * 60 * 60 * 1000) {
        data.recentActivity.last24Hours++;
    }
    
    // 最近一周
    if (now - data.lastActivated < 7 * 24 * 60 * 60 * 1000) {
        data.recentActivity.lastWeek++;
    }
}

// 计算注意力分数
function calculateAttentionScore(data) {
    const now = Date.now();
    const timeSinceOpen = now - data.openTime;
    const timeSinceLastActive = data.lastActivated ? now - data.lastActivated : timeSinceOpen;
    
    let score = 0.5; // 基础分数
    
    // 总活跃时间权重 (30%)
    const activeTimeRatio = Math.min(data.totalActiveTime / (5 * 60 * 1000), 1); // 最大5分钟
    score += activeTimeRatio * 0.3;
    
    // 激活频率权重 (25%)
    const activationFrequency = Math.min(data.activationCount / 10, 1); // 最大10次
    score += activationFrequency * 0.25;
    
    // 最近活跃度权重 (25%)
    const recencyScore = Math.max(0, 1 - (timeSinceLastActive / (60 * 60 * 1000))); // 1小时内
    score += recencyScore * 0.25;
    
    // 平均会话时长权重 (15%)
    const sessionScore = Math.min(data.averageSessionTime / (2 * 60 * 1000), 1); // 最大2分钟
    score += sessionScore * 0.15;
    
    // 特殊状态加分 (5%)
    if (data.metadata.isPinned) score += 0.03;
    if (data.metadata.isAudible) score += 0.02;
    
    return Math.min(score, 1);
}

// 保存标签页数据到历史记录
async function saveTabDataToHistory(data) {
    try {
        const historyKey = `tab_history_${Date.now()}`;
        const historyData = {
            ...data,
            closedTime: Date.now(),
            sessionDuration: Date.now() - data.openTime
        };
        
        await chrome.storage.local.set({ [historyKey]: historyData });
        
        // 清理旧历史记录（保留最近7天）
        cleanupOldHistory();
    } catch (error) {
        console.error('保存历史数据失败:', error);
    }
}

// 清理旧历史记录
async function cleanupOldHistory() {
    try {
        const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
        const allData = await chrome.storage.local.get();
        const keysToRemove = [];
        
        for (const key in allData) {
            if (key.startsWith('tab_history_')) {
                const timestamp = parseInt(key.split('_')[2]);
                if (timestamp < sevenDaysAgo) {
                    keysToRemove.push(key);
                }
            }
        }
        
        if (keysToRemove.length > 0) {
            await chrome.storage.local.remove(keysToRemove);
            console.log(`清理了 ${keysToRemove.length} 条过期历史记录`);
        }
    } catch (error) {
        console.error('清理历史记录失败:', error);
    }
}

// 获取域名
function getDomainFromUrl(url) {
    try {
        return new URL(url).hostname;
    } catch {
        return 'unknown';
    }
}

// 处理来自popup或options的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getTabsData') {
        chrome.tabs.query({}, (tabs) => {
            sendResponse({ tabs: tabs });
        });
        return true; // 保持消息通道开放
    }
    
    if (request.action === 'getAttentionData') {
        // 返回增强的注意力数据
        chrome.tabs.query({}, (tabs) => {
            const enhancedTabs = tabs.map(tab => {
                const attentionInfo = attentionData.get(tab.id) || {};
                return {
                    ...tab,
                    attentionData: {
                        openOrder: attentionInfo.openOrder || 0,
                        totalActiveTime: attentionInfo.totalActiveTime || 0,
                        activationCount: attentionInfo.activationCount || 0,
                        lastActivated: attentionInfo.lastActivated || tab.lastAccessed,
                        averageSessionTime: attentionInfo.averageSessionTime || 0,
                        attentionScore: attentionInfo.attentionScore || 0.5,
                        accessPattern: attentionInfo.accessPattern || [],
                        recentActivity: attentionInfo.recentActivity || {
                            lastHour: 0,
                            last24Hours: 0,
                            lastWeek: 0
                        },
                        interactions: attentionInfo.interactions || {
                            scrolls: 0,
                            clicks: 0,
                            typing: 0
                        },
                        timeSinceOpen: Date.now() - (attentionInfo.openTime || Date.now()),
                        timeSinceLastActive: attentionInfo.lastActivated ? 
                            Date.now() - attentionInfo.lastActivated : 0,
                        workflowContext: analyzeWorkflowContext(tab.id),
                        contentCategory: categorizeContent(tab.url, tab.title)
                    }
                };
            });
            
            sendResponse({ 
                tabs: enhancedTabs,
                sessionStartTime: sessionStartTime,
                currentActiveTab: activeTabId,
                dataQuality: assessDataQuality()
            });
        });
        return true;
    }
    
    if (request.action === 'groupTabs') {
        // 处理标签页分组逻辑
        groupTabsLogic(request.tabs).then(groups => {
            sendResponse({ groups: groups });
        });
        return true;
    }
});

// 分析工作流上下文
function analyzeWorkflowContext(tabId) {
    if (!attentionData.has(tabId)) return null;
    
    const data = attentionData.get(tabId);
    const recentPattern = data.accessPattern.slice(-10); // 最近10次访问
    
    // 分析访问频率和规律
    const accessFrequency = recentPattern.length > 0 ? 
        recentPattern.length / ((Date.now() - recentPattern[0].timestamp) / (60 * 1000)) : 0; // 每分钟访问次数
    
    // 判断使用模式
    let usagePattern = 'unknown';
    if (data.activationCount > 10 && data.averageSessionTime > 30000) {
        usagePattern = 'intensive'; // 深度使用
    } else if (data.activationCount > 5 && data.averageSessionTime < 10000) {
        usagePattern = 'scanning'; // 快速浏览
    } else if (data.activationCount <= 2) {
        usagePattern = 'reference'; // 参考资料
    } else {
        usagePattern = 'regular'; // 常规使用
    }
    
    return {
        accessFrequency: accessFrequency,
        usagePattern: usagePattern,
        continuityScore: calculateContinuityScore(recentPattern),
        relationshipStrength: calculateRelationshipStrength(tabId)
    };
}

// 计算连续性分数
function calculateContinuityScore(pattern) {
    if (pattern.length < 2) return 0;
    
    let totalGap = 0;
    for (let i = 1; i < pattern.length; i++) {
        totalGap += pattern[i].timestamp - pattern[i-1].timestamp;
    }
    
    const averageGap = totalGap / (pattern.length - 1);
    // 间隔越小，连续性越高
    return Math.max(0, 1 - (averageGap / (5 * 60 * 1000))); // 5分钟为基准
}

// 计算关系强度
function calculateRelationshipStrength(tabId) {
    if (!attentionData.has(tabId)) return 0;
    
    const currentData = attentionData.get(tabId);
    const currentDomain = currentData.domain;
    let relationshipScore = 0;
    let relatedTabs = 0;
    
    // 与其他标签页的关联度
    for (const [otherTabId, otherData] of attentionData.entries()) {
        if (otherTabId === tabId) continue;
        
        // 相同域名强关联
        if (otherData.domain === currentDomain) {
            relationshipScore += 0.3;
            relatedTabs++;
        }
        
        // 相近的打开时间
        const timeDiff = Math.abs(currentData.openTime - otherData.openTime);
        if (timeDiff < 5 * 60 * 1000) { // 5分钟内
            relationshipScore += 0.1;
        }
        
        // 相近的访问模式
        if (currentData.accessPattern.length > 0 && otherData.accessPattern.length > 0) {
            const timingCorrelation = calculateTimingCorrelation(
                currentData.accessPattern, 
                otherData.accessPattern
            );
            relationshipScore += timingCorrelation * 0.2;
        }
    }
    
    return Math.min(relationshipScore, 1);
}

// 计算时间相关性
function calculateTimingCorrelation(pattern1, pattern2) {
    if (pattern1.length === 0 || pattern2.length === 0) return 0;
    
    let correlations = 0;
    const threshold = 2 * 60 * 1000; // 2分钟阈值
    
    for (const access1 of pattern1) {
        for (const access2 of pattern2) {
            if (Math.abs(access1.timestamp - access2.timestamp) < threshold) {
                correlations++;
                break;
            }
        }
    }
    
    return correlations / Math.max(pattern1.length, pattern2.length);
}

// 内容分类
function categorizeContent(url, title) {
    const text = (url + ' ' + title).toLowerCase();
    
    const categories = {
        development: ['github', 'stackoverflow', 'code', 'programming', 'developer', 'api', 'documentation'],
        learning: ['tutorial', 'course', 'learn', 'education', 'guide', 'training'],
        communication: ['mail', 'slack', 'teams', 'zoom', 'meeting', 'chat'],
        productivity: ['notion', 'trello', 'asana', 'calendar', 'drive', 'docs'],
        entertainment: ['youtube', 'netflix', 'bilibili', 'video', 'music', 'game'],
        shopping: ['amazon', 'shop', 'buy', 'cart', 'price', 'product'],
        social: ['twitter', 'facebook', 'linkedin', 'reddit', 'weibo', 'zhihu'],
        news: ['news', 'article', 'blog', 'medium', 'journalist']
    };
    
    for (const [category, keywords] of Object.entries(categories)) {
        if (keywords.some(keyword => text.includes(keyword))) {
            return category;
        }
    }
    
    return 'general';
}

// 评估数据质量
function assessDataQuality() {
    const totalTabs = attentionData.size;
    if (totalTabs === 0) return { score: 0, level: 'insufficient' };
    
    let tabsWithRichData = 0;
    let totalAttentionScore = 0;
    let totalActivations = 0;
    
    for (const [tabId, data] of attentionData.entries()) {
        totalAttentionScore += data.attentionScore;
        totalActivations += data.activationCount;
        
        // 数据丰富度判断
        if (data.activationCount > 0 && 
            data.totalActiveTime > 0 && 
            data.accessPattern.length > 0) {
            tabsWithRichData++;
        }
    }
    
    const richDataRatio = tabsWithRichData / totalTabs;
    const avgAttentionScore = totalAttentionScore / totalTabs;
    const avgActivations = totalActivations / totalTabs;
    
    // 计算数据质量分数
    let qualityScore = 0;
    qualityScore += richDataRatio * 0.4; // 丰富数据比例
    qualityScore += avgAttentionScore * 0.3; // 平均注意力分数
    qualityScore += Math.min(avgActivations / 5, 1) * 0.2; // 平均激活次数
    qualityScore += Math.min(totalTabs / 10, 1) * 0.1; // 标签页数量
    
    let level;
    if (qualityScore >= 0.8) level = 'excellent';
    else if (qualityScore >= 0.6) level = 'good';
    else if (qualityScore >= 0.4) level = 'fair';
    else if (qualityScore >= 0.2) level = 'poor';
    else level = 'insufficient';
    
    return {
        score: qualityScore,
        level: level,
        totalTabs: totalTabs,
        richDataTabs: tabsWithRichData,
        avgAttentionScore: avgAttentionScore,
        avgActivations: avgActivations,
        recommendedGroupingLevel: getRecommendedGroupingLevel(qualityScore, totalTabs)
    };
}

// 推荐分组级别
function getRecommendedGroupingLevel(qualityScore, totalTabs) {
    if (qualityScore >= 0.7 && totalTabs >= 10) {
        return 'fine'; // 精细分组
    } else if (qualityScore >= 0.5 && totalTabs >= 6) {
        return 'moderate'; // 适中分组
    } else if (totalTabs >= 4) {
        return 'coarse'; // 粗略分组
    } else {
        return 'basic'; // 基础分组
    }
}

// 简单的标签页分组逻辑
async function groupTabsLogic(tabs) {
    const groups = {};
    
    tabs.forEach(tab => {
        try {
            const url = new URL(tab.url);
            const domain = url.hostname;
            
            if (!groups[domain]) {
                groups[domain] = {
                    id: domain,
                    name: getDomainName(domain),
                    tabs: []
                };
            }
            
            groups[domain].tabs.push({
                id: tab.id,
                title: tab.title,
                url: tab.url
            });
        } catch (error) {
            // 忽略无效URL
        }
    });
    
    return Object.values(groups);
}

function getDomainName(domain) {
    const parts = domain.split('.');
    if (parts.length > 2) {
        return parts[parts.length - 2].charAt(0).toUpperCase() + parts[parts.length - 2].slice(1);
    }
    return domain.charAt(0).toUpperCase() + domain.slice(1);
}