// 后台服务脚本 - 增强注意力数据收集
let attentionData = new Map(); // tabId -> 注意力数据
let sessionStartTime = Date.now();
let activeTabId = null;
let tabActivationTime = null;
let tabOpenOrder = 0; // 全局标签页打开顺序
let currentWorkMode = 'balanced'; // 当前工作模式 (内部路由规则)
let workModeHistory = []; // 工作模式历史记录

chrome.runtime.onInstalled.addListener((details) => {
    console.log('Focuence智序已安装');
    
    // 初始化默认设置
    const defaultSettings = {
        apiEndpoint: 'https://yunwu.zeabur.app',
        model: 'gpt-4o-mini',
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

// 计算注意力亲和度 - 衡量两个标签页在注意力维度上的相似性
function calculateAttentionAffinity(tab1Data, tab2Data) {
    const weights = {
        temporalProximity: 0.3,  // 时间邻近性
        behaviorSimilarity: 0.25, // 行为相似性
        scoreProximity: 0.2,     // 注意力分数接近度
        contextualRelevance: 0.25 // 上下文相关性
    };
    
    let affinity = 0;
    
    // 1. 时间邻近性 - 基于访问时间的接近程度
    const timeDiff = Math.abs((tab1Data.lastActivated || 0) - (tab2Data.lastActivated || 0));
    const hoursDiff = timeDiff / (1000 * 60 * 60);
    const temporalScore = Math.max(0, 1 - (hoursDiff / 24)); // 24小时内线性衰减
    affinity += temporalScore * weights.temporalProximity;
    
    // 2. 行为相似性 - 基于激活模式和使用时长
    const freq1 = tab1Data.activationCount || 0;
    const freq2 = tab2Data.activationCount || 0;
    const time1 = tab1Data.totalActiveTime || 0;
    const time2 = tab2Data.totalActiveTime || 0;
    
    const freqSimilarity = 1 - Math.abs(freq1 - freq2) / Math.max(freq1 + freq2, 1);
    const timeSimilarity = 1 - Math.abs(time1 - time2) / Math.max(time1 + time2, 1);
    const behaviorScore = (freqSimilarity + timeSimilarity) / 2;
    affinity += behaviorScore * weights.behaviorSimilarity;
    
    // 3. 注意力分数接近度
    const score1 = tab1Data.attentionScore || 0.5;
    const score2 = tab2Data.attentionScore || 0.5;
    const scoreProximity = 1 - Math.abs(score1 - score2);
    affinity += scoreProximity * weights.scoreProximity;
    
    // 4. 上下文相关性 - 基于打开顺序和会话模式
    const order1 = tab1Data.openOrder || 0;
    const order2 = tab2Data.openOrder || 0;
    const orderDiff = Math.abs(order1 - order2);
    const contextScore = Math.max(0, 1 - (orderDiff / 10)); // 开启顺序接近
    affinity += contextScore * weights.contextualRelevance;
    
    return Math.min(affinity, 1);
}

// 基于注意力数据的标签页聚类分析
function analyzeAttentionClusters(tabs) {
    const clusters = [];
    const processed = new Set();
    
    // 按注意力分数降序排列
    const sortedTabs = [...tabs].sort((a, b) => {
        const scoreA = a.attentionData?.attentionScore || 0.5;
        const scoreB = b.attentionData?.attentionScore || 0.5;
        return scoreB - scoreA;
    });
    
    for (const tab of sortedTabs) {
        if (processed.has(tab.id)) continue;
        
        const cluster = [tab];
        processed.add(tab.id);
        
        // 寻找与当前标签页注意力亲和度高的其他标签页
        for (const otherTab of sortedTabs) {
            if (processed.has(otherTab.id)) continue;
            
            const affinity = calculateAttentionAffinity(
                tab.attentionData || {},
                otherTab.attentionData || {}
            );
            
            // 亲和度阈值：0.6以上认为相关
            if (affinity > 0.6) {
                cluster.push(otherTab);
                processed.add(otherTab.id);
            }
        }
        
        // 只有2个或以上标签页才形成聚类
        if (cluster.length >= 2) {
            // 计算聚类的注意力强度
            const clusterStrength = cluster.reduce((sum, t) => 
                sum + (t.attentionData?.attentionScore || 0.5), 0) / cluster.length;
            
            clusters.push({
                tabs: cluster,
                strength: clusterStrength,
                type: clusterStrength > 0.7 ? 'high-attention' : 
                      clusterStrength > 0.5 ? 'medium-attention' : 'low-attention'
            });
        }
    }
    
    return clusters.sort((a, b) => b.strength - a.strength);
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
    
    if (request.action === 'performAIGrouping') {
        // 处理AI智能分组
        performAIGrouping(request.tabs, request.settings).then(result => {
            sendResponse(result);
        }).catch(error => {
            console.error('AI分组处理失败:', error);
            sendResponse({ success: false, error: error.message });
        });
        return true;
    }

    if (request.action === 'getTabsAttentionData') {
        // 获取标签页注意力数据用于清理建议
        chrome.tabs.query({}, (allTabs) => {
            const enrichedTabs = allTabs.map(tab => {
                const attentionInfo = attentionData.get(tab.id) || {};
                
                return {
                    id: tab.id,
                    title: tab.title,
                    url: tab.url,
                    pinned: tab.pinned,
                    lastAccessed: tab.lastAccessed,
                    attentionScore: attentionInfo.attentionScore || 0.5,
                    totalActiveTime: attentionInfo.totalActiveTime || 0,
                    activationCount: attentionInfo.activationCount || 0,
                    lastActivated: attentionInfo.lastActivated,
                    averageSessionTime: attentionInfo.averageSessionTime || 0,
                    openTime: attentionInfo.openTime || Date.now()
                };
            });
            
            sendResponse({ success: true, tabs: enrichedTabs });
        });
        return true;
    }
    
    // 获取使用模式分析
    if (request.action === 'getUsagePatterns') {
        (async () => {
            try {
                const result = await chrome.storage.local.get(['usagePatterns', 'lastAnalysis']);
                
                // 如果没有分析数据或数据过期，重新分析
                if (!result.usagePatterns || !result.lastAnalysis || 
                    (Date.now() - result.lastAnalysis) > 60 * 60 * 1000) {
                    const patterns = await analyzeUsagePatterns();
                    sendResponse({ success: true, patterns });
                } else {
                    sendResponse({ success: true, patterns: result.usagePatterns });
                }
            } catch (error) {
                console.error('获取使用模式失败:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    }
    
    // 应用推荐
    if (request.action === 'applyRecommendation') {
        (async () => {
            try {
                await applyRecommendation(request.recommendation);
                sendResponse({ success: true });
            } catch (error) {
                console.error('应用推荐失败:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    }
    
    // 手动触发使用模式分析
    if (request.action === 'analyzeUsagePatterns') {
        (async () => {
            try {
                const patterns = await analyzeUsagePatterns();
                sendResponse({ success: true, patterns });
            } catch (error) {
                console.error('分析使用模式失败:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    }
    
    // 获取内存统计
    if (request.action === 'getMemoryStats') {
        const stats = memoryManager.getMemoryStats();
        sendResponse({ success: true, stats });
        return true;
    }
    
    // 手动触发内存清理
    if (request.action === 'performMemoryCleanup') {
        (async () => {
            try {
                await memoryManager.performCleanup();
                const stats = memoryManager.getMemoryStats();
                sendResponse({ success: true, stats });
            } catch (error) {
                console.error('手动内存清理失败:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    }
    
    // 优化的标签页查询
    if (request.action === 'getTabsOptimized') {
        (async () => {
            try {
                const tabs = await getTabsOptimized(request.options || {});
                sendResponse({ success: true, tabs });
            } catch (error) {
                console.error('优化标签页查询失败:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    }
    
    // 生成隐私报告
    if (request.action === 'generatePrivacyReport') {
        (async () => {
            try {
                const report = await securityManager.generatePrivacyReport();
                sendResponse({ success: true, report });
            } catch (error) {
                console.error('生成隐私报告失败:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    }
    
    // 清理敏感数据
    if (request.action === 'cleanupSensitiveData') {
        (async () => {
            try {
                await securityManager.cleanupSensitiveStorage();
                const report = await securityManager.generatePrivacyReport();
                sendResponse({ success: true, report });
            } catch (error) {
                console.error('清理敏感数据失败:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    }
    
    // 验证权限
    if (request.action === 'verifyPermissions') {
        (async () => {
            try {
                const permissions = await securityManager.verifyPermissions();
                sendResponse({ success: true, permissions });
            } catch (error) {
                console.error('验证权限失败:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    }
    
    // 获取当前工作模式
    if (request.action === 'getCurrentWorkMode') {
        sendResponse({ success: true, workMode: currentWorkMode });
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

// 快捷键处理
chrome.commands.onCommand.addListener(async (command) => {
    console.log('快捷键触发:', command);
    
    try {
        switch (command) {
            case 'smart_grouping':
                await executeSmartGrouping();
                break;
            case 'cleaning_suggestions':
                await executeCleaningSuggestions();
                break;
            case 'toggle_popup':
                await executeTogglePopup();
                break;
        }
    } catch (error) {
        console.error('执行快捷键命令失败:', error);
    }
});

// 执行智能分组
async function executeSmartGrouping() {
    try {
        const tabs = await chrome.tabs.query({ currentWindow: true });
        console.log('快捷键触发智能分组, 标签页数量:', tabs.length);
        
        // 获取设置
        const result = await chrome.storage.sync.get(['settings']);
        const settings = result.settings || {
            apiEndpoint: 'https://yunwu.zeabur.app',
            model: 'gpt-4o-mini',
            apiKey: ''
        };
        
        // 如果没有API密钥，使用本地分组
        if (!settings.apiKey) {
            console.log('无API密钥，使用本地回退分组');
            const groups = performLocalGrouping(tabs);
            await applyGroupsToChrome(groups);
            showNotification('智能分组完成', `已创建 ${groups.length} 个分组（本地算法）`);
            return;
        }
        
        // 使用AI分组
        const tabData = await buildTabData(tabs);
        const groups = await performAIGroupingRequest(tabData, settings);
        
        if (groups && groups.length > 0) {
            await applyGroupsToChrome(groups);
            showNotification('AI智能分组完成', `已创建 ${groups.length} 个分组`);
        } else {
            // 回退到本地分组
            const localGroups = performLocalGrouping(tabs);
            await applyGroupsToChrome(localGroups);
            showNotification('智能分组完成', `已创建 ${localGroups.length} 个分组（回退算法）`);
        }
    } catch (error) {
        console.error('快捷键智能分组失败:', error);
        showNotification('分组失败', '请检查API设置或网络连接');
    }
}

// 执行清理建议
async function executeCleaningSuggestions() {
    try {
        const tabs = await chrome.tabs.query({ currentWindow: true });
        const suggestions = generateCleaningSuggestions(tabs);
        
        if (suggestions.length === 0) {
            showNotification('清理建议', '当前没有建议清理的标签页');
            return;
        }
        
        // 创建清理建议通知
        let message = `发现 ${suggestions.length} 个可清理的标签页：\n`;
        suggestions.slice(0, 3).forEach(s => {
            message += `• ${s.title}\n`;
        });
        if (suggestions.length > 3) {
            message += `... 等 ${suggestions.length - 3} 个`;
        }
        
        showNotification('清理建议', message);
    } catch (error) {
        console.error('快捷键清理建议失败:', error);
        showNotification('获取清理建议失败', '请稍后重试');
    }
}

// 执行切换弹出窗口（实际上是打开弹出窗口）
async function executeTogglePopup() {
    try {
        // 由于Chrome扩展API限制，我们无法通过脚本直接切换popup
        // 但可以通过打开选项页面或者创建通知来替代
        showNotification('Focuence智序', '请点击扩展图标打开管理面板');
    } catch (error) {
        console.error('快捷键切换popup失败:', error);
    }
}

// 构建标签页数据
async function buildTabData(tabs) {
    const now = Date.now();
    return tabs.map(tab => {
        const attentionInfo = attentionData.get(tab.id) || {};
        let attentionScore = 0.5;
        let timeSinceLastAccess = 0;
        
        if (attentionInfo.attentionScore) {
            attentionScore = attentionInfo.attentionScore;
        } else if (tab.lastAccessed) {
            timeSinceLastAccess = now - tab.lastAccessed;
            const hoursSinceLastAccess = timeSinceLastAccess / (1000 * 60 * 60);
            
            if (hoursSinceLastAccess < 1) attentionScore += 0.3;
            else if (hoursSinceLastAccess < 6) attentionScore += 0.2;
            else if (hoursSinceLastAccess < 24) attentionScore += 0.1;
        }
        
        return {
            id: tab.id,
            title: tab.title,
            url: tab.url,
            domain: tab.url ? new URL(tab.url).hostname : 'unknown',
            isPinned: tab.pinned || false,
            attentionScore: Math.min(attentionScore, 1.0),
            windowId: tab.windowId,
            index: tab.index
        };
    });
}

// 执行本地分组
function performLocalGrouping(tabs) {
    const groups = [];
    const domainGroups = {};
    
    // 按域名分组
    tabs.forEach(tab => {
        const domain = tab.url ? new URL(tab.url).hostname : 'unknown';
        if (!domainGroups[domain]) {
            domainGroups[domain] = [];
        }
        domainGroups[domain].push(tab);
    });
    
    // 只保留有2个或更多标签页的组
    for (const [domain, tabList] of Object.entries(domainGroups)) {
        if (tabList.length >= 2) {
            groups.push({
                id: `group_${domain}_${Date.now()}`,
                name: getDomainName(domain),
                tabs: tabList,
                reason: `相同域名: ${domain}`,
                status: 'normal'
            });
        }
    }
    
    return groups;
}

// 将分组应用到Chrome
async function applyGroupsToChrome(groups) {
    if (!chrome.tabs.group) {
        console.log('浏览器不支持标签页分组API');
        return;
    }
    
    for (const group of groups) {
        try {
            const tabIds = group.tabs.map(tab => tab.id);
            const groupId = await chrome.tabs.group({
                tabIds: tabIds,
                createProperties: {
                    windowId: (await chrome.windows.getCurrent()).id
                }
            });
            
            await chrome.tabGroups.update(groupId, {
                title: group.name,
                color: 'green'
            });
            
            console.log(`已创建Chrome分组: ${group.name}`);
        } catch (error) {
            console.error('创建Chrome分组失败:', error);
        }
    }
}

// 生成清理建议
function generateCleaningSuggestions(tabs) {
    const suggestions = [];
    const now = Date.now();
    
    tabs.forEach(tab => {
        const attentionInfo = attentionData.get(tab.id);
        let shouldSuggestClean = false;
        let reason = '';
        let priority = 'low';
        
        // 基于注意力数据的建议
        if (attentionInfo) {
            const timeSinceLastActive = attentionInfo.lastActivated ? 
                now - attentionInfo.lastActivated : now - attentionInfo.openTime;
            const hoursInactive = timeSinceLastActive / (1000 * 60 * 60);
            
            if (hoursInactive > 2 && attentionInfo.activationCount <= 1) {
                shouldSuggestClean = true;
                priority = 'high';
                reason = '长时间未使用且很少访问';
            } else if (hoursInactive > 1 && attentionInfo.averageSessionTime < 5000) {
                shouldSuggestClean = true;
                priority = 'medium';
                reason = '平均停留时间很短';
            }
        } else if (tab.lastAccessed) {
            // 基于基础数据的建议
            const timeSinceAccess = now - tab.lastAccessed;
            const hoursInactive = timeSinceAccess / (1000 * 60 * 60);
            
            if (hoursInactive > 2) {
                shouldSuggestClean = true;
                priority = 'medium';
                reason = '长时间未访问';
            }
        }
        
        if (shouldSuggestClean && !tab.pinned && !tab.audible) {
            suggestions.push({
                tabId: tab.id,
                title: tab.title,
                url: tab.url,
                reason: reason,
                priority: priority
            });
        }
    });
    
    // 按优先级排序
    suggestions.sort((a, b) => {
        const priorityOrder = { high: 3, medium: 2, low: 1 };
        return priorityOrder[b.priority] - priorityOrder[a.priority];
    });
    
    return suggestions;
}

// 显示系统通知
function showNotification(title, message) {
    if (chrome.notifications) {
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon-48.png',
            title: title,
            message: message
        });
    } else {
        console.log('通知:', title, '-', message);
    }
}

// AI智能分组函数 - 带路由判断的两步法
async function performAIGrouping(tabs, settings) {
    // 添加整体超时控制 (60秒)
    const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('AI分组超时')), 60000)
    );

    try {
        return await Promise.race([
            performAIGroupingInternal(tabs, settings),
            timeout
        ]);
    } catch (error) {
        console.error('AI分组失败:', error);
        
        // 如果AI分组失败，使用本地分组算法作为fallback
        console.log('使用本地分组算法作为fallback');
        return performLocalGroupingFallback(tabs);
    }
}

async function performAIGroupingInternal(tabs, settings) {
    console.log('开始AI分组处理，标签页数量:', tabs.length);
    
    // 检查设置
    if (!settings || !settings.apiKey || !settings.apiEndpoint) {
        return { success: false, error: '请先在设置中配置API密钥和端点' };
    }

    // 第0步：先取消所有现有分组，重新开始分组
    console.log('清除现有分组以便重新组织...');
    try {
        const existingGroups = await chrome.tabGroups.query({});
        if (existingGroups.length > 0) {
            console.log(`发现 ${existingGroups.length} 个现有分组，准备取消`);
            for (const group of existingGroups) {
                try {
                    const groupTabs = await chrome.tabs.query({groupId: group.id});
                    await chrome.tabs.ungroup(groupTabs.map(t => t.id));
                } catch (error) {
                    console.warn(`取消分组 ${group.title || group.id} 失败:`, error);
                }
            }
            console.log('已清除所有现有分组');
        }
    } catch (error) {
        console.warn('清除现有分组时出错:', error);
    }

    // 收集完整的标签页数据（包括注意力数据）
    const enrichedTabs = await enrichTabsWithAttentionData(tabs);
    console.log('已收集注意力数据');

    // 路由判断：分析情况选择分组策略
    const routingDecision = analyzeGroupingContext(enrichedTabs);
    console.log('路由决策:', routingDecision.strategy, '- 权重配置:', routingDecision.weights);

    // 第一步：语义分析 - 分析每个标签页的主题和内容
    console.log('第一步：开始语义分析...');
    let semanticAnalysis = await Promise.race([
        analyzeTabSemantics(enrichedTabs, settings),
        new Promise((_, reject) => setTimeout(() => reject(new Error('语义分析超时')), 30000))
    ]);
    
    // 如果AI分析失败，使用本地语义算法作为fallback
    if (!semanticAnalysis.success) {
        console.log('AI语义分析失败，使用本地算法fallback');
        semanticAnalysis = performLocalSemanticAnalysis(enrichedTabs);
    }
    
    // 第二步：基于路由决策进行智能分组
    console.log('第二步：开始智能分组，策略:', routingDecision.strategy);
    const groupingResult = await Promise.race([
        performAdaptiveGrouping(semanticAnalysis.analysis, enrichedTabs, routingDecision, settings),
        new Promise((_, reject) => setTimeout(() => reject(new Error('智能分组超时')), 30000))
    ]);
    
    if (!groupingResult.success) {
        throw new Error(`智能分组失败: ${groupingResult.error}`);
    }

    console.log('AI分组完成，有效分组数量:', groupingResult.groups.length);
    
    // 优化分组：自适应调整分组策略
    const optimizedGroups = optimizeGroupingStrategy(groupingResult.groups, enrichedTabs);
    console.log('分组优化完成，最终分组数量:', optimizedGroups.length);
    
    return { success: true, groups: optimizedGroups };
}

// 本地分组算法fallback
function performLocalGroupingFallback(tabs) {
    console.log('执行本地分组fallback');
    
    try {
        const groups = [];
        const domainGroups = new Map();
        
        // 按域名分组
        for (const tab of tabs) {
            try {
                const domain = new URL(tab.url).hostname;
                if (!domainGroups.has(domain)) {
                    domainGroups.set(domain, []);
                }
                domainGroups.get(domain).push(tab);
            } catch (e) {
                // 处理无效URL
                if (!domainGroups.has('其他')) {
                    domainGroups.set('其他', []);
                }
                domainGroups.get('其他').push(tab);
            }
        }
        
        // 转换为分组格式
        let groupIndex = 1;
        for (const [domain, domainTabs] of domainGroups.entries()) {
            if (domainTabs.length > 1) {
                groups.push({
                    id: `local-group-${groupIndex++}`,
                    name: `${domain}相关`,
                    description: `${domain}域名下的标签页`,
                    tabs: domainTabs,
                    count: domainTabs.length,
                    confidence: 0.8,
                    groupType: 'domain-based'
                });
            }
        }
        
        console.log('本地分组fallback完成，分组数量:', groups.length);
        return { success: true, groups };
    } catch (error) {
        console.error('本地分组fallback也失败了:', error);
        return { success: false, error: '所有分组方法都失败了' };
    }
}

// 分组策略优化函数 - 自适应调整分组颗粒度
function optimizeGroupingStrategy(groups, enrichedTabs) {
    console.log('开始分组优化，原始分组数:', groups.length);
    
    const totalTabs = enrichedTabs.length;
    const minGroupSize = Math.max(2, Math.floor(totalTabs / 15)); // 动态最小组大小
    const maxGroups = Math.max(3, Math.floor(totalTabs / 4)); // 最大分组数
    
    console.log(`分组优化参数: 总标签页=${totalTabs}, 最小组大小=${minGroupSize}, 最大分组数=${maxGroups}`);
    
    // 第一步：移除过小的组，并准备重新分配
    const validGroups = [];
    const orphanTabs = [];
    
    for (const group of groups) {
        if (group.tabs && group.tabs.length >= minGroupSize) {
            validGroups.push(group);
        } else {
            // 将小组的标签页标记为孤儿，待重新分配
            orphanTabs.push(...(group.tabs || []));
            console.log(`移除小组: ${group.name} (${group.tabs?.length || 0}个标签页)`);
        }
    }
    
    // 第二步：合并相似的组
    const mergedGroups = mergeRelatedGroups(validGroups);
    console.log(`合并后分组数: ${mergedGroups.length}`);
    
    // 第三步：将孤儿标签页重新分配到最匹配的组
    const finalGroups = redistributeOrphanTabs(mergedGroups, orphanTabs, enrichedTabs);
    
    // 第四步：如果分组过多，进行进一步合并
    const optimizedGroups = finalGroups.length > maxGroups ? 
        consolidateGroups(finalGroups, maxGroups) : finalGroups;
    
    // 第五步：按注意力总分排序分组
    optimizedGroups.sort((a, b) => {
        const scoreA = calculateGroupAttentionScore(a);
        const scoreB = calculateGroupAttentionScore(b);
        return scoreB - scoreA;
    });
    
    console.log(`最终优化结果: ${optimizedGroups.length}个分组`);
    return optimizedGroups;
}

// 合并相关分组
function mergeRelatedGroups(groups) {
    if (groups.length <= 1) return groups;
    
    const merged = [...groups];
    let hasChanges = true;
    
    while (hasChanges && merged.length > 1) {
        hasChanges = false;
        
        for (let i = 0; i < merged.length - 1; i++) {
            for (let j = i + 1; j < merged.length; j++) {
                const similarity = calculateGroupSimilarity(merged[i], merged[j]);
                
                // 如果相似度高于阈值，合并这两个组
                if (similarity > 0.6) {
                    console.log(`合并相似分组: "${merged[i].name}" + "${merged[j].name}" (相似度: ${similarity.toFixed(2)})`);
                    
                    const mergedGroup = {
                        id: `merged-${merged[i].id}-${merged[j].id}`,
                        name: selectBetterGroupName(merged[i], merged[j]),
                        description: `${merged[i].description} + ${merged[j].description}`,
                        tabs: [...merged[i].tabs, ...merged[j].tabs],
                        count: merged[i].tabs.length + merged[j].tabs.length,
                        confidence: Math.max(merged[i].confidence || 0.5, merged[j].confidence || 0.5),
                        groupType: 'merged'
                    };
                    
                    // 移除原来的两个组，添加合并后的组
                    merged.splice(j, 1);
                    merged.splice(i, 1);
                    merged.push(mergedGroup);
                    hasChanges = true;
                    break;
                }
            }
            if (hasChanges) break;
        }
    }
    
    return merged;
}

// 计算两个分组的相似度
function calculateGroupSimilarity(group1, group2) {
    // 1. 域名相似度 (权重: 30%)
    const domains1 = new Set(group1.tabs.map(tab => {
        try { return new URL(tab.url).hostname; } catch { return 'unknown'; }
    }));
    const domains2 = new Set(group2.tabs.map(tab => {
        try { return new URL(tab.url).hostname; } catch { return 'unknown'; }
    }));
    
    const domainIntersection = new Set([...domains1].filter(d => domains2.has(d)));
    const domainUnion = new Set([...domains1, ...domains2]);
    const domainSimilarity = domainUnion.size > 0 ? domainIntersection.size / domainUnion.size : 0;
    
    // 2. 关键词相似度 (权重: 40%)
    const keywords1 = extractGroupKeywords(group1);
    const keywords2 = extractGroupKeywords(group2);
    const keywordSimilarity = calculateKeywordSimilarity(keywords1, keywords2);
    
    // 3. 名称相似度 (权重: 30%)
    const nameSimilarity = calculateTextSimilarity(group1.name, group2.name);
    
    const totalSimilarity = domainSimilarity * 0.3 + keywordSimilarity * 0.4 + nameSimilarity * 0.3;
    
    return totalSimilarity;
}

// 提取分组关键词
function extractGroupKeywords(group) {
    const allText = group.tabs.map(tab => `${tab.title} ${tab.url}`).join(' ').toLowerCase();
    
    // 简单的关键词提取（移除常见停用词）
    const stopWords = new Set(['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 
                              'com', 'www', 'http', 'https', '的', '和', '与', '或', '但', '在', '为', '了']);
    
    const words = allText.match(/[\u4e00-\u9fff\w]+/g) || [];
    const keywords = words
        .filter(word => word.length > 2 && !stopWords.has(word))
        .reduce((acc, word) => {
            acc[word] = (acc[word] || 0) + 1;
            return acc;
        }, {});
    
    return Object.entries(keywords)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([word]) => word);
}

// 计算关键词相似度
function calculateKeywordSimilarity(keywords1, keywords2) {
    if (keywords1.length === 0 || keywords2.length === 0) return 0;
    
    const set1 = new Set(keywords1);
    const set2 = new Set(keywords2);
    const intersection = new Set([...set1].filter(k => set2.has(k)));
    const union = new Set([...set1, ...set2]);
    
    return union.size > 0 ? intersection.size / union.size : 0;
}

// 计算文本相似度
function calculateTextSimilarity(text1, text2) {
    if (!text1 || !text2) return 0;
    
    const normalize = (str) => str.toLowerCase().replace(/[^\u4e00-\u9fff\w\s]/g, '');
    const norm1 = normalize(text1);
    const norm2 = normalize(text2);
    
    // 计算编辑距离
    const len1 = norm1.length;
    const len2 = norm2.length;
    
    if (len1 === 0) return len2 === 0 ? 1 : 0;
    if (len2 === 0) return 0;
    
    const matrix = Array(len2 + 1).fill().map(() => Array(len1 + 1).fill(0));
    
    for (let i = 0; i <= len1; i++) matrix[0][i] = i;
    for (let j = 0; j <= len2; j++) matrix[j][0] = j;
    
    for (let j = 1; j <= len2; j++) {
        for (let i = 1; i <= len1; i++) {
            if (norm1[i - 1] === norm2[j - 1]) {
                matrix[j][i] = matrix[j - 1][i - 1];
            } else {
                matrix[j][i] = Math.min(
                    matrix[j - 1][i - 1] + 1,
                    matrix[j][i - 1] + 1,
                    matrix[j - 1][i] + 1
                );
            }
        }
    }
    
    const maxLen = Math.max(len1, len2);
    return maxLen > 0 ? 1 - matrix[len2][len1] / maxLen : 1;
}

// 选择更好的分组名称
function selectBetterGroupName(group1, group2) {
    // 选择更具描述性的名称（长度适中且包含更多信息）
    const name1 = group1.name || '';
    const name2 = group2.name || '';
    
    if (name1.length === 0) return name2;
    if (name2.length === 0) return name1;
    
    // 优先选择包含更多有意义词汇的名称
    const meaningfulWords1 = (name1.match(/[\u4e00-\u9fff\w]+/g) || []).length;
    const meaningfulWords2 = (name2.match(/[\u4e00-\u9fff\w]+/g) || []).length;
    
    if (meaningfulWords1 !== meaningfulWords2) {
        return meaningfulWords1 > meaningfulWords2 ? name1 : name2;
    }
    
    // 选择长度适中的名称
    return name1.length < name2.length ? name1 : name2;
}

// 提取简短的分组名称 - 限制5个字以内
function extractShortName(originalName) {
    if (!originalName || originalName.length <= 5) return originalName;
    
    // 预定义的关键词映射，将常见词汇缩短
    const keywordMap = {
        '工作': '工作',
        '学习': '学习', 
        '娱乐': '娱乐',
        '购物': '购物',
        '资讯': '资讯',
        '新闻': '新闻',
        '技术': '技术',
        '开发': '开发',
        '编程': '编程',
        '设计': '设计',
        '社交': '社交',
        '视频': '视频',
        '音乐': '音乐',
        '游戏': '游戏',
        '文档': '文档',
        '邮件': '邮件',
        '搜索': '搜索',
        '工具': '工具',
        '社区': '社区',
        '论坛': '论坛',
        '博客': '博客',
        '教育': '教育',
        '财经': '财经',
        '健康': '健康',
        '旅游': '旅游',
        '美食': '美食',
        '体育': '体育'
    };
    
    // 尝试匹配关键词
    for (const [keyword, shortForm] of Object.entries(keywordMap)) {
        if (originalName.includes(keyword)) {
            return shortForm;
        }
    }
    
    // 如果没有匹配到关键词，取前5个字符
    let shortName = originalName.substring(0, 5);
    
    // 如果第5个字符是英文的一部分，向前截断到完整单词
    if (/[a-zA-Z]/.test(shortName[4]) && shortName.length > 4) {
        const lastSpaceIndex = shortName.lastIndexOf(' ');
        if (lastSpaceIndex > 0) {
            shortName = shortName.substring(0, lastSpaceIndex);
        }
    }
    
    return shortName.trim() || '分组';
}

// 重新分配孤儿标签页
function redistributeOrphanTabs(groups, orphanTabs, enrichedTabs) {
    if (orphanTabs.length === 0) return groups;
    
    console.log(`重新分配${orphanTabs.length}个孤儿标签页`);
    
    const result = [...groups];
    
    for (const orphanTab of orphanTabs) {
        let bestMatch = null;
        let bestScore = 0;
        
        // 找到最匹配的分组
        for (const group of result) {
            const score = calculateTabGroupCompatibility(orphanTab, group);
            if (score > bestScore && score > 0.3) { // 最低相似度阈值
                bestScore = score;
                bestMatch = group;
            }
        }
        
        if (bestMatch) {
            bestMatch.tabs.push(orphanTab);
            bestMatch.count = bestMatch.tabs.length;
            console.log(`将标签页"${orphanTab.title}"分配到"${bestMatch.name}"`);
        } else {
            // 如果找不到合适的分组，创建新的杂项分组
            let miscGroup = result.find(g => g.groupType === 'miscellaneous');
            if (!miscGroup) {
                miscGroup = {
                    id: 'misc-group',
                    name: '其他相关',
                    description: '无法归类的标签页',
                    tabs: [],
                    count: 0,
                    confidence: 0.5,
                    groupType: 'miscellaneous'
                };
                result.push(miscGroup);
            }
            miscGroup.tabs.push(orphanTab);
            miscGroup.count = miscGroup.tabs.length;
        }
    }
    
    return result.filter(group => group.tabs.length > 0);
}

// 计算标签页与分组的兼容性
function calculateTabGroupCompatibility(tab, group) {
    if (!group.tabs || group.tabs.length === 0) return 0;
    
    let totalScore = 0;
    
    for (const groupTab of group.tabs) {
        // 域名匹配 (权重: 40%)
        const tabDomain = extractDomain(tab.url);
        const groupTabDomain = extractDomain(groupTab.url);
        const domainScore = tabDomain === groupTabDomain ? 1 : 0;
        
        // 标题相似性 (权重: 60%)
        const titleScore = calculateTextSimilarity(tab.title, groupTab.title);
        
        const compatibility = domainScore * 0.4 + titleScore * 0.6;
        totalScore += compatibility;
    }
    
    return totalScore / group.tabs.length;
}

// 合并过多的分组
function consolidateGroups(groups, maxGroups) {
    if (groups.length <= maxGroups) return groups;
    
    console.log(`分组过多(${groups.length}个)，合并到${maxGroups}个`);
    
    // 按注意力分数排序，保留最重要的分组
    const sortedGroups = [...groups].sort((a, b) => 
        calculateGroupAttentionScore(b) - calculateGroupAttentionScore(a)
    );
    
    const keepGroups = sortedGroups.slice(0, maxGroups - 1);
    const mergeGroups = sortedGroups.slice(maxGroups - 1);
    
    if (mergeGroups.length > 0) {
        // 将剩余分组合并为一个"其他"分组
        const consolidatedGroup = {
            id: 'consolidated-group',
            name: '其他标签页',
            description: '其他相关标签页',
            tabs: mergeGroups.flatMap(g => g.tabs),
            count: mergeGroups.reduce((sum, g) => sum + g.tabs.length, 0),
            confidence: 0.6,
            groupType: 'consolidated'
        };
        keepGroups.push(consolidatedGroup);
    }
    
    return keepGroups;
}

// 计算分组的总注意力分数
function calculateGroupAttentionScore(group) {
    if (!group.tabs || group.tabs.length === 0) return 0;
    
    const totalScore = group.tabs.reduce((sum, tab) => {
        const tabAttention = attentionData.get(tab.id);
        return sum + (tabAttention?.attention || 0.1);
    }, 0);
    
    return totalScore / group.tabs.length; // 平均注意力分数
}

// 提取域名的辅助函数
function extractDomain(url) {
    try {
        return new URL(url).hostname;
    } catch {
        return 'unknown';
    }
}

// 收集完整的标签页数据（包括注意力数据）
async function enrichTabsWithAttentionData(tabs) {
    const enrichedTabs = [];
    
    for (const tab of tabs) {
        const attentionInfo = attentionData.get(tab.id) || {};
        const now = Date.now();
        
        enrichedTabs.push({
            // 基础信息
            id: tab.id,
            title: tab.title,
            url: tab.url,
            domain: getDomainFromUrl(tab.url),
            
            // 注意力数据
            attention: {
                totalActiveTime: attentionInfo.totalActiveTime || 0,
                activationCount: attentionInfo.activationCount || 0,
                attentionScore: attentionInfo.attentionScore || 0.5,
                averageSessionTime: attentionInfo.averageSessionTime || 0,
                lastActivated: attentionInfo.lastActivated,
                timeSinceLastActive: attentionInfo.lastActivated ? now - attentionInfo.lastActivated : null,
                openTime: attentionInfo.openTime || now,
                openOrder: attentionInfo.openOrder || 0,
                timeSinceOpen: now - (attentionInfo.openTime || now)
            },
            
            // 行为模式
            behavior: {
                recentActivity: attentionInfo.recentActivity || { lastHour: 0, last24Hours: 0, lastWeek: 0 },
                interactions: attentionInfo.interactions || { scrolls: 0, clicks: 0, typing: 0 },
                accessPattern: (attentionInfo.accessPattern || []).slice(-10) // 最近10次访问
            },
            
            // 元数据
            metadata: {
                isPinned: tab.pinned || false,
                isAudible: tab.audible || false,
                windowId: tab.windowId,
                index: tab.index
            }
        });
    }
    
    return enrichedTabs;
}

// 路由判断：分析情况选择分组策略（增强版）
function analyzeGroupingContext(enrichedTabs) {
    const stats = {
        totalTabs: enrichedTabs.length,
        uniqueDomains: new Set(enrichedTabs.map(t => t.domain)).size,
        avgAttentionScore: enrichedTabs.reduce((sum, t) => sum + t.attention.attentionScore, 0) / enrichedTabs.length,
        attentionVariance: 0,
        recentOpenCount: 0,
        sequentialPattern: 0,
        timeClusterStrength: 0,
        workflowDetected: false,
        domainDiversity: 0,
        contentTypeVariety: 0
    };

    // 计算注意力分数方差
    const attentionScores = enrichedTabs.map(t => t.attention.attentionScore);
    const mean = stats.avgAttentionScore;
    stats.attentionVariance = attentionScores.reduce((sum, score) => sum + Math.pow(score - mean, 2), 0) / attentionScores.length;

    // 分析最近打开的标签页数量（1小时内）
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    stats.recentOpenCount = enrichedTabs.filter(t => t.attention.openTime > oneHourAgo).length;

    // 分析顺序模式强度（连续打开的相关性）
    const sortedByOrder = [...enrichedTabs].sort((a, b) => a.attention.openOrder - b.attention.openOrder);
    let sequentialSimilarity = 0;
    for (let i = 1; i < sortedByOrder.length; i++) {
        const curr = sortedByOrder[i];
        const prev = sortedByOrder[i-1];
        // 简单的域名和时间接近性检查
        if (curr.domain === prev.domain || 
            Math.abs(curr.attention.openTime - prev.attention.openTime) < 5 * 60 * 1000) {
            sequentialSimilarity++;
        }
    }
    stats.sequentialPattern = sequentialSimilarity / Math.max(1, enrichedTabs.length - 1);

    // 分析时间聚集强度
    const openTimes = enrichedTabs.map(t => t.attention.openTime).sort();
    let clusters = 0;
    for (let i = 1; i < openTimes.length; i++) {
        if (openTimes[i] - openTimes[i-1] < 10 * 60 * 1000) { // 10分钟内
            clusters++;
        }
    }
    stats.timeClusterStrength = clusters / Math.max(1, enrichedTabs.length - 1);

    // 分析域名多样性 (Shannon熵)
    const domainCounts = {};
    enrichedTabs.forEach(tab => {
        domainCounts[tab.domain] = (domainCounts[tab.domain] || 0) + 1;
    });
    stats.domainDiversity = Object.values(domainCounts).reduce((entropy, count) => {
        const p = count / enrichedTabs.length;
        return entropy - p * Math.log2(p);
    }, 0);

    // 检测工作流模式（连续打开的相关标签页）
    const workflowPatterns = [];
    for (let i = 0; i < enrichedTabs.length - 1; i++) {
        const curr = enrichedTabs[i];
        const next = enrichedTabs[i + 1];
        const timeDiff = Math.abs(curr.attention.openTime - next.attention.openTime);
        const domainRelated = curr.domain === next.domain || 
                             curr.url.includes(next.domain) || 
                             next.url.includes(curr.domain);
        
        if (timeDiff < 30000 && domainRelated) { // 30秒内打开的相关标签页
            workflowPatterns.push({ curr, next, timeDiff });
        }
    }
    stats.workflowDetected = workflowPatterns.length > Math.max(2, enrichedTabs.length * 0.2);

    // 内容类型多样性分析
    const contentTypes = new Set();
    enrichedTabs.forEach(tab => {
        if (tab.url.includes('github') || tab.url.includes('stackoverflow')) contentTypes.add('development');
        else if (tab.url.includes('youtube') || tab.url.includes('bilibili')) contentTypes.add('video');
        else if (tab.url.includes('docs') || tab.url.includes('wiki')) contentTypes.add('documentation');
        else if (tab.url.includes('news') || tab.url.includes('article')) contentTypes.add('news');
        else if (tab.url.includes('shop') || tab.url.includes('buy')) contentTypes.add('shopping');
        else contentTypes.add('general');
    });
    stats.contentTypeVariety = contentTypes.size / 6; // 标准化到0-1

    // 增强的路由决策逻辑
    let strategy, weights;

    // 专注模式：工作流明显 + 低域名多样性 + 高注意力集中
    if (stats.workflowDetected && stats.domainDiversity < 1.5 && stats.attentionVariance < 0.1) {
        strategy = 'behavior-dominant';
        weights = { semantic: 0.25, attention: 0.5, temporal: 0.25 };
    }
    // 研究模式：高域名多样性 + 高内容类型多样性 + 分散注意力
    else if (stats.domainDiversity > 2.0 && stats.contentTypeVariety > 0.5 && stats.uniqueDomains / stats.totalTabs > 0.7) {
        strategy = 'semantic-dominant';  
        weights = { semantic: 0.7, attention: 0.2, temporal: 0.1 };
    }
    // 开发模式：特定域名聚集 + 中等注意力差异
    else if (stats.contentTypeVariety > 0.3 && (stats.uniqueDomains / stats.totalTabs < 0.4) && stats.sequentialPattern > 0.2) {
        strategy = 'semantic-dominant';
        weights = { semantic: 0.6, attention: 0.3, temporal: 0.1 };
    }
    // 任务切换模式：时间聚集 + 中等域名多样性
    else if (stats.timeClusterStrength > 0.3 && stats.domainDiversity > 1.0 && stats.domainDiversity < 2.5) {
        strategy = 'behavior-dominant';
        weights = { semantic: 0.3, attention: 0.4, temporal: 0.3 };
    }
    // 平衡模式：混合情况
    else {
        strategy = 'balanced';
        weights = { 
            semantic: 0.4 + (stats.domainDiversity / 10), // 根据多样性动态调整
            attention: 0.35 - (stats.attentionVariance / 10),
            temporal: 0.25 + (stats.timeClusterStrength / 10)
        };
    }

    return {
        strategy,
        weights,
        stats,
        reasoning: generateRoutingReasoning(strategy, stats)
    };
}

// 生成路由决策说明（增强版）
function generateRoutingReasoning(strategy, stats) {
    const domainRatio = (stats.uniqueDomains / stats.totalTabs * 100).toFixed(1);
    const diversityScore = stats.domainDiversity.toFixed(2);
    
    switch (strategy) {
        case 'behavior-dominant':
            if (stats.workflowDetected) {
                return `检测到工作流模式：连续任务处理，域名集中度高，采用注意力主导策略`;
            } else {
                return `检测到任务切换模式：时间聚集${(stats.timeClusterStrength*100).toFixed(1)}%，多样性${diversityScore}，采用行为主导策略`;
            }
        case 'semantic-dominant':
            if (stats.contentTypeVariety > 0.5) {
                return `检测到研究模式：内容高度多样化(${(stats.contentTypeVariety*100).toFixed(1)}%)，${stats.uniqueDomains}个域名，采用语义主导策略`;
            } else {
                return `检测到开发模式：特定领域聚焦，域名占比${domainRatio}%，采用语义主导策略`;
            }
        case 'balanced':
            return `检测到混合模式：多样性${diversityScore}，时间聚集${(stats.timeClusterStrength*100).toFixed(1)}%，采用动态平衡策略`;
        default:
            return '默认平衡策略';
    }
}

// 第一步：语义分析函数（加入注意力权重）
async function analyzeTabSemantics(enrichedTabs, settings) {
    try {
        const systemPrompt = `你是一个专业的网页内容语义分析专家。基于标题、URL和用户行为数据，分析每个标签页的语义特征。

【分析要求】
- 主要基于标题和URL识别核心主题（如：天气、购物、编程、新闻等）
- 考虑注意力数据判断内容重要性和用户关注度
- 提取关键语义标签，为后续分组提供依据

【注意力权重说明】
- attentionScore: 用户注意力分数 (0-1)，越高表示越重要
- totalActiveTime: 总活跃时长，反映用户投入程度  
- activationCount: 激活次数，反映访问频率
- 这些数据作为语义重要性的权重参考

【输出格式】
返回JSON数组，每个元素包含：
- id: 标签页ID
- theme: 核心主题（如"天气预报"、"在线购物"、"技术文档"等）
- contentType: 内容类型（如"工具"、"资讯"、"文档"、"娱乐"等）
- keywords: 关键词数组
- semanticTags: 语义标签数组  
- importance: 基于注意力数据的重要性评分 (0-1)
- userEngagement: 用户参与度 ("high"|"medium"|"low")

【示例】
[
  {
    "id": 123,
    "theme": "天气预报",
    "contentType": "工具",
    "keywords": ["天气", "预报", "温度"],
    "semanticTags": ["weather", "forecast"],
    "importance": 0.8,
    "userEngagement": "high"
  }
]`;

        const userPrompt = `请分析以下标签页的语义信息（包含注意力数据）：

${JSON.stringify(enrichedTabs.map(tab => ({
    id: tab.id,
    title: tab.title,
    url: tab.url,
    domain: tab.domain,
    attention: tab.attention
})), null, 2)}`;

        const response = await callAIAPI(systemPrompt, userPrompt, settings);
        const analysis = parseAIResponse(response);
        
        return { success: true, analysis };
    } catch (error) {
        console.error('语义分析失败:', error);
        return { success: false, error: error.message };
    }
}

// 第二步：自适应分组函数（基于路由决策调整策略）
async function performAdaptiveGrouping(semanticAnalysis, enrichedTabs, routingDecision, settings) {
    try {
        const { strategy, weights, reasoning } = routingDecision;

        let systemPrompt;
        
        if (strategy === 'semantic-dominant') {
            systemPrompt = `你是一个语义主导的智能分组专家。主要基于内容主题进行分组。

【当前策略】语义主导 - ${reasoning}
【权重配置】语义:${(weights.semantic*100).toFixed(0)}% | 注意力:${(weights.attention*100).toFixed(0)}% | 时间:${(weights.temporal*100).toFixed(0)}%

【分组原则】
1. **语义主题相似性**（主导）：相同或相关主题的标签页必须分为一组
2. **内容类型相关性**：相同类型内容优先分组
3. **用户关注度**：作为辅助权重，重要标签页作为组核心
4. **时间顺序**：仅作为次要参考

【特别要求】
- 严格按主题分组，不同网站的相同主题内容应归为一组
- 注意力分数仅用于确定组内核心标签页
- 忽略域名限制，专注语义相似性`;

        } else if (strategy === 'behavior-dominant') {
            systemPrompt = `你是一个行为主导的智能分组专家。主要基于用户行为模式进行分组。

【当前策略】行为主导 - ${reasoning}  
【权重配置】语义:${(weights.semantic*100).toFixed(0)}% | 注意力:${(weights.attention*100).toFixed(0)}% | 时间:${(weights.temporal*100).toFixed(0)}%

【分组原则】
1. **用户注意力模式**（主导）：注意力分数相近的标签页分为一组
2. **时间访问模式**：时间接近、顺序相关的标签页分组
3. **工作流相关性**：连续打开的标签页可能属于同一任务
4. **语义相似性**：作为辅助验证分组合理性

【特别要求】
- 优先考虑高注意力分数的标签页组合
- 重视打开顺序和时间聚集模式
- 语义仅用于验证分组是否合理`;

        } else { // balanced
            systemPrompt = `你是一个平衡策略的智能分组专家。综合考虑多个维度进行分组。

【当前策略】平衡模式 - ${reasoning}
【权重配置】语义:${(weights.semantic*100).toFixed(0)}% | 注意力:${(weights.attention*100).toFixed(0)}% | 时间:${(weights.temporal*100).toFixed(0)}%

【分组原则】
1. **语义主题相似性**：相同主题优先分组
2. **用户行为权重**：注意力分数影响分组优先级
3. **时间访问模式**：时间相关性作为重要参考
4. **综合评估**：平衡各维度进行最优分组

【特别要求】
- 同等重视语义和行为数据
- 综合评估每个分组的合理性
- 避免过度依赖单一维度`;
        }

        systemPrompt += `

【输出格式】
{
  "groups": [
    {
      "name": "分组名称(必须5个字以内，简明扼要)",
      "tabs": [标签页ID数组],
      "reason": "分组理由",
      "primaryFactor": "主要分组因子(semantic|attention|temporal|mixed)",
      "confidence": "分组置信度(0-1)"
    }
  ]
}

【智能分组要求】
- 优先考虑用户工作流：连续访问的相关页面应归为一组
- 识别任务上下文：如"查资料→做笔记→写文档"的完整任务链
- 考虑使用频率：高频使用的页面给予更高权重
- 平衡专业性：技术类、工作类页面细分，娱乐类页面可粗分

【分组命名要求】
- 分组名称必须控制在5个字以内
- 要求简明扼要，一目了然  
- 使用准确的核心词汇，如：开发、学习、资讯、工具、娱乐等
- 优先使用领域专业词汇而非通用词汇

【质量标准】
- 每组至少2个标签页，最多12个标签页
- 总组数控制在3-8个之间，避免过度碎片化
- 组内相关性 > 80%，组间差异性 > 60%
- 返回纯JSON格式`;

        const userPrompt = `基于以下数据和策略进行分组：

语义分析结果：
${JSON.stringify(semanticAnalysis, null, 2)}

完整标签页数据：
${JSON.stringify(enrichedTabs.map(tab => ({
    id: tab.id,
    title: tab.title,
    domain: tab.domain,
    attention: {
        attentionScore: tab.attention.attentionScore,
        totalActiveTime: tab.attention.totalActiveTime,
        openOrder: tab.attention.openOrder,
        openTime: tab.attention.openTime,
        timeSinceOpen: tab.attention.timeSinceOpen
    }
})), null, 2)}`;

        const response = await callAIAPI(systemPrompt, userPrompt, settings);
        const groupingResult = parseAIResponse(response);

        // 验证和清理分组数据
        const validGroups = [];
        const tabIdSet = new Set(enrichedTabs.map(tab => tab.id));
        
        for (const group of groupingResult.groups) {
            if (!group.name || !Array.isArray(group.tabs) || group.tabs.length < 2) {
                console.warn('跳过无效分组:', group);
                continue;
            }
            
            const validTabIds = group.tabs.filter(id => tabIdSet.has(id));
            if (validTabIds.length >= 2) {
                const groupTabs = validTabIds.map(id => enrichedTabs.find(tab => tab.id === id)).filter(Boolean);
                
                // 确保分组名称在5个字以内
                let groupName = group.name;
                if (groupName.length > 5) {
                    // 如果名称过长，尝试提取关键词缩短
                    groupName = extractShortName(groupName);
                    console.log(`分组名称过长，已缩短: "${group.name}" -> "${groupName}"`);
                }

                validGroups.push({
                    name: groupName,
                    tabs: groupTabs,
                    reason: group.reason || `${strategy}策略分组`,
                    primaryFactor: group.primaryFactor || strategy.split('-')[0],
                    confidence: group.confidence || 0.7,
                    strategy: strategy
                });
            }
        }

        // 后处理：智能优化分组结果
        const optimizedGroups = postProcessGroups(validGroups, enrichedTabs);
        
        return { success: true, groups: optimizedGroups };
    } catch (error) {
        console.error('自适应分组失败:', error);
        return { success: false, error: error.message };
    }
}

// 后处理：智能优化分组结果
function postProcessGroups(groups, enrichedTabs) {
    console.log('开始后处理分组结果...');
    
    // 1. 合并过小的分组
    let processedGroups = groups.filter(group => group.tabs.length >= 2);
    const orphanTabs = [];
    
    // 收集被过滤掉的单标签页
    groups.forEach(group => {
        if (group.tabs.length < 2) {
            orphanTabs.push(...group.tabs);
        }
    });
    
    // 2. 将孤儿标签页重新分配到最相似的组
    orphanTabs.forEach(orphanTab => {
        let bestGroup = null;
        let bestScore = 0;
        
        processedGroups.forEach(group => {
            const score = calculateTabGroupSimilarity(orphanTab, group);
            if (score > bestScore && score > 0.3) { // 相似度阈值
                bestScore = score;
                bestGroup = group;
            }
        });
        
        if (bestGroup) {
            bestGroup.tabs.push(orphanTab);
        } else {
            // 如果找不到合适的组，创建"其他"组
            let miscGroup = processedGroups.find(g => g.name === '其他' || g.name === '杂项');
            if (!miscGroup) {
                miscGroup = {
                    name: '其他',
                    tabs: [],
                    reason: '无法归类的标签页',
                    primaryFactor: 'mixed',
                    confidence: 0.5
                };
                processedGroups.push(miscGroup);
            }
            miscGroup.tabs.push(orphanTab);
        }
    });
    
    // 3. 重新排序组（按重要性和大小）
    processedGroups.sort((a, b) => {
        const scoreA = a.tabs.reduce((sum, tab) => sum + tab.attention.attentionScore, 0) / a.tabs.length;
        const scoreB = b.tabs.reduce((sum, tab) => sum + tab.attention.attentionScore, 0) / b.tabs.length;
        return (scoreB * b.tabs.length) - (scoreA * a.tabs.length);
    });
    
    // 4. 限制分组数量，合并相似度高的小组
    if (processedGroups.length > 8) {
        processedGroups = mergeSimilarSmallGroups(processedGroups, 8);
    }
    
    console.log(`后处理完成：${groups.length} -> ${processedGroups.length} 个分组`);
    return processedGroups.filter(group => group.tabs.length >= 2);
}

// 计算标签页与分组的相似度
function calculateTabGroupSimilarity(tab, group) {
    let score = 0;
    const groupTabs = group.tabs;
    
    // 域名相似度
    const domainMatches = groupTabs.filter(t => t.domain === tab.domain).length;
    score += (domainMatches / groupTabs.length) * 0.4;
    
    // 标题关键词相似度
    const tabKeywords = tab.title.toLowerCase().split(/\s+/);
    const groupKeywords = groupTabs.flatMap(t => t.title.toLowerCase().split(/\s+/));
    const commonKeywords = tabKeywords.filter(keyword => 
        keyword.length > 2 && groupKeywords.includes(keyword)
    ).length;
    score += (commonKeywords / Math.max(tabKeywords.length, 1)) * 0.3;
    
    // 访问时间相似度
    const avgGroupTime = groupTabs.reduce((sum, t) => sum + t.attention.openTime, 0) / groupTabs.length;
    const timeDiff = Math.abs(tab.attention.openTime - avgGroupTime);
    const timeSimilarity = Math.max(0, 1 - (timeDiff / (60 * 60 * 1000))); // 1小时内为满分
    score += timeSimilarity * 0.3;
    
    return score;
}

// 合并相似的小分组
function mergeSimilarSmallGroups(groups, targetCount) {
    let result = [...groups];
    
    while (result.length > targetCount) {
        let bestPair = null;
        let bestSimilarity = 0;
        
        // 找最相似的两个小组
        for (let i = 0; i < result.length; i++) {
            for (let j = i + 1; j < result.length; j++) {
                if (result[i].tabs.length + result[j].tabs.length <= 12) {
                    const similarity = calculateGroupSimilarity(result[i], result[j]);
                    if (similarity > bestSimilarity) {
                        bestSimilarity = similarity;
                        bestPair = [i, j];
                    }
                }
            }
        }
        
        if (!bestPair || bestSimilarity < 0.3) break;
        
        // 合并分组
        const [i, j] = bestPair;
        const mergedGroup = {
            name: selectBetterGroupName(result[i], result[j]),
            tabs: [...result[i].tabs, ...result[j].tabs],
            reason: `合并分组: ${result[i].name} + ${result[j].name}`,
            primaryFactor: 'mixed',
            confidence: Math.max(result[i].confidence || 0.5, result[j].confidence || 0.5)
        };
        
        result.splice(j, 1);
        result.splice(i, 1);
        result.push(mergedGroup);
    }
    
    return result;
}

// 计算两个分组的相似度
function calculateGroupSimilarity(group1, group2) {
    const domains1 = new Set(group1.tabs.map(t => t.domain));
    const domains2 = new Set(group2.tabs.map(t => t.domain));
    const commonDomains = new Set([...domains1].filter(d => domains2.has(d)));
    
    const domainSimilarity = commonDomains.size / Math.max(domains1.size, domains2.size);
    
    const keywords1 = group1.tabs.flatMap(t => t.title.toLowerCase().split(/\s+/));
    const keywords2 = group2.tabs.flatMap(t => t.title.toLowerCase().split(/\s+/));
    const commonKeywords = keywords1.filter(k => k.length > 2 && keywords2.includes(k));
    
    const keywordSimilarity = commonKeywords.length / Math.max(keywords1.length, keywords2.length);
    
    return domainSimilarity * 0.6 + keywordSimilarity * 0.4;
}

// 本地语义分析算法 (AI失败时的fallback)
function performLocalSemanticAnalysis(enrichedTabs) {
    const analysis = enrichedTabs.map(tab => {
        const theme = classifyLocalTheme(tab.title, tab.url);
        const contentType = classifyContentType(tab.url, tab.domain);
        const keywords = extractKeywords(tab.title);
        const importance = calculateLocalImportance(tab);
        
        return {
            id: tab.id,
            theme: theme,
            contentType: contentType,
            keywords: keywords,
            semanticTags: generateSemanticTags(theme, keywords),
            importance: importance,
            userEngagement: importance > 0.7 ? 'high' : importance > 0.4 ? 'medium' : 'low'
        };
    });
    
    return { success: true, analysis };
}

// 本地主题分类
function classifyLocalTheme(title, url) {
    const titleLower = title.toLowerCase();
    const urlLower = url.toLowerCase();
    
    // 天气相关
    if (titleLower.match(/天气|weather|预报|forecast|气温|temperature/)) {
        return '天气预报';
    }
    
    // 购物相关
    if (titleLower.match(/购物|shopping|商城|mall|淘宝|京东|amazon|ebay/)) {
        return '在线购物';
    }
    
    // 开发相关
    if (titleLower.match(/github|代码|code|programming|developer|stackoverflow|编程|开发/)) {
        return '编程开发';
    }
    
    // 文档相关
    if (titleLower.match(/文档|documentation|docs|manual|教程|tutorial/)) {
        return '技术文档';
    }
    
    // 新闻相关
    if (titleLower.match(/新闻|news|资讯|头条|财经/)) {
        return '新闻资讯';
    }
    
    // 娱乐相关
    if (titleLower.match(/视频|video|电影|movie|音乐|music|游戏|game/)) {
        return '娱乐内容';
    }
    
    // 社交相关
    if (titleLower.match(/微博|weibo|twitter|facebook|社交|chat|聊天/)) {
        return '社交媒体';
    }
    
    // 学习相关
    if (titleLower.match(/学习|study|课程|course|教育|education|知识|knowledge/)) {
        return '学习教育';
    }
    
    // 基于域名的分类
    if (urlLower.includes('github.com')) return '编程开发';
    if (urlLower.includes('stackoverflow.com')) return '编程开发';
    if (urlLower.includes('youtube.com')) return '娱乐内容';
    if (urlLower.includes('bilibili.com')) return '娱乐内容';
    
    return '其他内容';
}

// 内容类型分类
function classifyContentType(url, domain) {
    const urlLower = url.toLowerCase();
    
    if (urlLower.includes('/search') || urlLower.includes('?q=')) return '搜索';
    if (urlLower.includes('/docs/') || urlLower.includes('documentation')) return '文档';
    if (urlLower.includes('/video/') || urlLower.includes('/watch')) return '视频';
    if (urlLower.includes('/news/') || urlLower.includes('/article/')) return '资讯';
    if (urlLower.includes('/shop/') || urlLower.includes('/product/')) return '购物';
    if (urlLower.includes('/tool') || urlLower.includes('calculator')) return '工具';
    
    return '网页';
}

// 关键词提取
function extractKeywords(title) {
    const stopWords = ['的', '是', '在', '有', '和', '与', '或', '但', '这', '那', '了', '着', 'the', 'is', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for'];
    const words = title.toLowerCase()
        .replace(/[^\w\s\u4e00-\u9fa5]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 1 && !stopWords.includes(word))
        .slice(0, 5);
    
    return words;
}

// 生成语义标签
function generateSemanticTags(theme, keywords) {
    const tags = [];
    
    // 基于主题生成标签
    const themeTagMap = {
        '天气预报': ['weather', 'forecast', 'climate'],
        '在线购物': ['shopping', 'ecommerce', 'retail'],
        '编程开发': ['programming', 'development', 'code'],
        '技术文档': ['documentation', 'technical', 'manual'],
        '新闻资讯': ['news', 'information', 'current-events'],
        '娱乐内容': ['entertainment', 'media', 'leisure'],
        '社交媒体': ['social', 'communication', 'networking'],
        '学习教育': ['education', 'learning', 'knowledge']
    };
    
    tags.push(...(themeTagMap[theme] || []));
    tags.push(...keywords.slice(0, 3));
    
    return [...new Set(tags)].slice(0, 5);
}

// 本地重要性计算
function calculateLocalImportance(tab) {
    let importance = tab.attention.attentionScore;
    
    // 基于活跃时间调整
    const activeTimeMinutes = tab.attention.totalActiveTime / (1000 * 60);
    if (activeTimeMinutes > 10) importance += 0.2;
    else if (activeTimeMinutes > 5) importance += 0.1;
    
    // 基于激活次数调整
    if (tab.attention.activationCount > 5) importance += 0.15;
    else if (tab.attention.activationCount > 2) importance += 0.1;
    
    // 固定标签页加权
    if (tab.metadata.isPinned) importance += 0.1;
    
    return Math.min(importance, 1.0);
}

// 解析AI响应，处理代码块格式
function parseAIResponse(response) {
    let content = response.trim();
    
    // 移除可能的代码块标记
    if (content.startsWith('```json')) {
        content = content.replace(/^```json\s*/i, '');
    }
    if (content.startsWith('```')) {
        content = content.replace(/^```\s*/, '');
    }
    if (content.endsWith('```')) {
        content = content.replace(/\s*```$/, '');
    }
    
    // 尝试解析JSON
    try {
        return JSON.parse(content);
    } catch (parseError) {
        console.error('JSON解析失败，原始内容:', content.substring(0, 200));
        throw new Error(`AI返回的内容不是有效的JSON格式: ${parseError.message}`);
    }
}

// 通用AI API调用函数
async function callAIAPI(systemPrompt, userPrompt, settings) {
    const response = await fetch(`${settings.apiEndpoint}/v1/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${settings.apiKey}`
        },
        body: JSON.stringify({
            model: settings.model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            temperature: 0.1,
            max_tokens: 3000
        })
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`API调用失败: ${response.status} ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json();
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        throw new Error('AI响应格式无效');
    }

    return data.choices[0].message.content;
}

// 工作模式管理系统
const WORK_MODES = {
    focus: {
        name: '专注', 
        description: '专注核心任务，自动清理干扰',
        groupingStrategy: 'attention-dominant',
        maxTabs: 8,
        autoClose: true,
        focusMode: true
    },
    research: {
        name: '研究',
        description: '支持大量标签页，按主题分组',
        groupingStrategy: 'semantic-dominant', 
        maxTabs: 50,
        autoClose: false,
        focusMode: false
    },
    development: {
        name: '开发',
        description: '开发工具和文档管理',
        groupingStrategy: 'semantic-dominant',
        maxTabs: 30,
        autoClose: false,
        focusMode: false
    },
    balanced: {
        name: '平衡',
        description: '智能平衡各种需求，综合策略',
        groupingStrategy: 'balanced',
        maxTabs: 35,
        autoClose: false,
        focusMode: false
    },
    casual: {
        name: '日常',
        description: '轻松浏览，适度管理',
        groupingStrategy: 'semantic-dominant',
        maxTabs: 25,
        autoClose: false,
        focusMode: false
    }
};

// 自动检测工作模式
function detectWorkMode(tabs) {
    const analysis = analyzeTabsContent(tabs);
    
    // 开发模式检测
    if (analysis.developmentRatio > 0.6) {
        return 'development';
    }
    
    // 研究模式检测
    if (analysis.documentationRatio > 0.4 || tabs.length > 25) {
        return 'research';
    }
    
    // 专注模式检测
    if (analysis.focusIndicator > 0.7 || (tabs.length < 10 && analysis.taskCoherence > 0.8)) {
        return 'focus';
    }
    
    // 休闲模式检测
    if (analysis.entertainmentRatio > 0.5) {
        return 'casual';
    }
    
    return 'balanced';
}

// 分析标签页内容
function analyzeTabsContent(tabs) {
    let developmentCount = 0;
    let documentationCount = 0; 
    let entertainmentCount = 0;
    let highAttentionCount = 0;
    
    tabs.forEach(tab => {
        const url = tab.url?.toLowerCase() || '';
        const title = tab.title?.toLowerCase() || '';
        
        // 开发相关
        if (url.includes('github.com') || 
            url.includes('stackoverflow.com') ||
            url.includes('developer.mozilla.org') ||
            title.includes('code') || 
            title.includes('programming')) {
            developmentCount++;
        }
        
        // 文档相关
        if (url.includes('/docs/') || 
            url.includes('documentation') ||
            title.includes('tutorial') ||
            title.includes('guide')) {
            documentationCount++;
        }
        
        // 娱乐相关
        if (url.includes('youtube.com') ||
            url.includes('bilibili.com') ||
            url.includes('netflix.com') ||
            title.includes('video')) {
            entertainmentCount++;
        }
        
        // 高注意力标签页
        const attentionInfo = attentionData.get(tab.id);
        if (attentionInfo && attentionInfo.attentionScore > 0.7) {
            highAttentionCount++;
        }
    });
    
    const total = tabs.length || 1;
    
    return {
        developmentRatio: developmentCount / total,
        documentationRatio: documentationCount / total,
        entertainmentRatio: entertainmentCount / total,
        focusIndicator: highAttentionCount / total,
        taskCoherence: calculateTaskCoherence(tabs)
    };
}

// 计算任务一致性
function calculateTaskCoherence(tabs) {
    // 简化的一致性计算
    const domains = new Set();
    tabs.forEach(tab => {
        if (tab.url) {
            try {
                domains.add(new URL(tab.url).hostname);
            } catch (e) {}
        }
    });
    
    // 域名越少，一致性越高
    return Math.max(0, 1 - (domains.size / tabs.length));
}

// 切换工作模式
async function switchWorkMode(newMode, reason = 'manual') {
    if (!WORK_MODES[newMode] || newMode === currentWorkMode) {
        return;
    }
    
    const oldMode = currentWorkMode;
    currentWorkMode = newMode;
    
    // 记录模式切换历史
    workModeHistory.push({
        from: oldMode,
        to: newMode,
        timestamp: Date.now(),
        reason: reason
    });
    
    // 保持最近50条记录
    if (workModeHistory.length > 50) {
        workModeHistory = workModeHistory.slice(-50);
    }
    
    console.log(`工作模式切换: ${oldMode} -> ${newMode} (${reason})`);
    
    // 应用新模式的配置
    await applyWorkModeSettings(newMode);
    
    // 通知用户
    showNotification('工作模式已切换', `当前模式: ${WORK_MODES[newMode].name}`);
}

// 应用工作模式设置
async function applyWorkModeSettings(mode) {
    const modeConfig = WORK_MODES[mode];
    if (!modeConfig) return;
    
    // 如果是专注模式且开启了自动清理
    if (modeConfig.autoClose && mode === 'focus') {
        const tabs = await chrome.tabs.query({});
        const suggestions = generateCleaningSuggestions(tabs);
        
        // 自动关闭低注意力标签页
        const lowAttentionTabs = suggestions
            .filter(s => s.type === 'low_attention')
            .flatMap(s => s.tabs)
            .slice(0, 5); // 最多关闭5个
            
        for (const tab of lowAttentionTabs) {
            try {
                await chrome.tabs.remove(tab.id);
                console.log(`专注模式自动关闭标签页: ${tab.title}`);
            } catch (e) {
                console.error('关闭标签页失败:', e);
            }
        }
    }
}

// 定时检查是否需要自动切换模式
setInterval(async () => {
    try {
        // 获取设置
        const result = await chrome.storage.sync.get(['settings']);
        const settings = result.settings || {};
        
        if (!settings.autoModeSwitch) return;
        
        const tabs = await chrome.tabs.query({});
        const suggestedMode = detectWorkMode(tabs);
        
        if (suggestedMode !== currentWorkMode) {
            await switchWorkMode(suggestedMode, 'auto-detection');
        }
    } catch (error) {
        console.error('自动模式切换检查失败:', error);
    }
}, 5 * 60 * 1000); // 每5分钟检查一次

// 系统健康检查
setInterval(async () => {
    try {
        await performHealthCheck();
    } catch (error) {
        console.error('健康检查失败:', error);
    }
}, 10 * 60 * 1000); // 每10分钟检查一次

async function performHealthCheck() {
    const healthStatus = {
        timestamp: Date.now(),
        tabCount: 0,
        attentionDataSize: attentionData.size,
        memoryUsage: 'unknown',
        apiStatus: 'unknown',
        issues: []
    };

    // 检查标签页数量
    try {
        const tabs = await chrome.tabs.query({});
        healthStatus.tabCount = tabs.length;
        
        if (tabs.length > 100) {
            healthStatus.issues.push('tab_overload');
        }
    } catch (e) {
        healthStatus.issues.push('tab_query_failed');
    }

    // 检查注意力数据完整性
    if (attentionData.size === 0 && healthStatus.tabCount > 0) {
        healthStatus.issues.push('attention_data_missing');
        // 尝试重新初始化
        await initializeAttentionTracking();
    }
    
    // 检查内存使用情况
    try {
        if (chrome.system && chrome.system.memory) {
            const memInfo = await chrome.system.memory.getInfo();
            const usedMemoryPercent = ((memInfo.capacity - memInfo.availableCapacity) / memInfo.capacity) * 100;
            healthStatus.memoryUsage = `${usedMemoryPercent.toFixed(1)}%`;
            
            if (usedMemoryPercent > 85) {
                healthStatus.issues.push('memory_high');
            }
        } else {
            // 使用简单的数据大小检查作为内存指标
            const dataSize = attentionData.size;
            if (dataSize > 1000) {
                healthStatus.issues.push('memory_high');
            }
            healthStatus.memoryUsage = `${dataSize} items`;
        }
    } catch (e) {
        console.log('无法获取内存信息，使用数据大小估算');
        healthStatus.memoryUsage = `${attentionData.size} items`;
    }

    // 检查API连通性（如果配置了）
    try {
        const result = await chrome.storage.sync.get(['settings']);
        const settings = result.settings || {};
        
        if (settings.apiKey && settings.apiEndpoint) {
            const testResponse = await fetch(`${settings.apiEndpoint}/v1/models`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${settings.apiKey}`,
                    'Content-Type': 'application/json'
                },
                signal: AbortSignal.timeout(5000)
            });
            
            healthStatus.apiStatus = testResponse.ok ? 'healthy' : 'error';
            if (!testResponse.ok) {
                healthStatus.issues.push('api_connection_failed');
            }
        }
    } catch (e) {
        healthStatus.apiStatus = 'error';
        healthStatus.issues.push('api_timeout');
    }

    // 存储健康状态
    await chrome.storage.local.set({ healthStatus });

    // 如果有严重问题，显示通知
    if (healthStatus.issues.length > 0) {
        const criticalIssues = healthStatus.issues.filter(issue => 
            ['attention_data_missing', 'tab_overload'].includes(issue)
        );
        
        if (criticalIssues.length > 0) {
            showNotification('系统提醒', '检测到性能问题，建议清理标签页');
        }
    }
    
    console.log('系统健康检查完成:', healthStatus);
    
    // 执行自动恢复
    if (healthStatus.issues.length > 0) {
        await performAutoRecovery(healthStatus.issues);
    }
}

// 自动恢复机制
async function performAutoRecovery(issues) {
    console.log('开始自动恢复:', issues);
    
    for (const issue of issues) {
        try {
            switch (issue) {
                case 'attention_data_missing':
                    await recoverAttentionData();
                    break;
                case 'tab_overload':
                    await performEmergencyCleanup();
                    break;
                case 'memory_high':
                    await clearOldData();
                    break;
                case 'api_connection_failed':
                    // 切换到本地模式
                    console.log('API连接失败，切换到本地语义分析模式');
                    break;
            }
        } catch (error) {
            console.error(`恢复操作失败 (${issue}):`, error);
        }
    }
}

// 恢复注意力数据
async function recoverAttentionData() {
    console.log('恢复注意力数据...');
    
    try {
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
            if (!attentionData.has(tab.id)) {
                attentionData.set(tab.id, {
                    url: tab.url,
                    title: tab.title,
                    visits: 1,
                    totalTime: 0,
                    lastActiveTime: Date.now(),
                    attention: 0.1, // 默认低注意力值
                    domain: new URL(tab.url).hostname,
                    category: 'unknown'
                });
            }
        }
        
        showNotification('系统恢复', '注意力数据已恢复');
    } catch (error) {
        console.error('恢复注意力数据失败:', error);
    }
}

// 紧急清理
async function performEmergencyCleanup() {
    console.log('执行紧急清理...');
    
    try {
        const tabs = await chrome.tabs.query({});
        const suggestions = generateCleaningSuggestions(tabs);
        
        // 自动关闭最不重要的标签页
        const autoCloseTabs = suggestions
            .filter(s => s.type === 'duplicate' || s.type === 'unused')
            .flatMap(s => s.tabs)
            .slice(0, Math.max(10, Math.floor(tabs.length * 0.2))); // 最多关闭20%
        
        let closedCount = 0;
        for (const tab of autoCloseTabs) {
            try {
                await chrome.tabs.remove(tab.id);
                closedCount++;
            } catch (e) {
                console.error('关闭标签页失败:', tab.id, e);
            }
        }
        
        if (closedCount > 0) {
            showNotification('自动清理', `已关闭${closedCount}个不常用的标签页`);
        }
    } catch (error) {
        console.error('紧急清理失败:', error);
    }
}

// 清理旧数据
async function clearOldData() {
    console.log('清理旧数据...');
    
    const now = Date.now();
    const oneWeekAgo = now - (7 * 24 * 60 * 60 * 1000);
    
    // 清理旧的注意力数据
    let clearedCount = 0;
    for (const [tabId, data] of attentionData.entries()) {
        if (data.lastActiveTime < oneWeekAgo) {
            attentionData.delete(tabId);
            clearedCount++;
        }
    }
    
    // 清理旧的存储数据
    try {
        const result = await chrome.storage.local.get(null);
        const keysToRemove = [];
        
        for (const [key, value] of Object.entries(result)) {
            if (key.startsWith('tab_') && value.timestamp && value.timestamp < oneWeekAgo) {
                keysToRemove.push(key);
            }
        }
        
        if (keysToRemove.length > 0) {
            await chrome.storage.local.remove(keysToRemove);
        }
        
        console.log(`清理完成: ${clearedCount}个注意力记录, ${keysToRemove.length}个存储项`);
    } catch (error) {
        console.error('清理旧数据失败:', error);
    }
}

// 使用模式分析
async function analyzeUsagePatterns() {
    const now = Date.now();
    const patterns = {
        timeDistribution: {},
        domainDistribution: {},
        categoryDistribution: {},
        sessionPatterns: [],
        recommendations: []
    };

    // 分析时间分布
    const hourCounts = new Array(24).fill(0);
    const dayOfWeekCounts = new Array(7).fill(0);
    
    // 分析域名和类别分布
    const domainStats = new Map();
    const categoryStats = new Map();
    
    for (const [tabId, data] of attentionData.entries()) {
        if (!data.lastActiveTime) continue;
        
        const date = new Date(data.lastActiveTime);
        const hour = date.getHours();
        const dayOfWeek = date.getDay();
        
        hourCounts[hour] += data.attention || 0;
        dayOfWeekCounts[dayOfWeek] += data.attention || 0;
        
        // 域名统计
        if (data.domain) {
            if (!domainStats.has(data.domain)) {
                domainStats.set(data.domain, {
                    visits: 0,
                    totalTime: 0,
                    attention: 0,
                    lastVisit: 0
                });
            }
            const domainData = domainStats.get(data.domain);
            domainData.visits += data.visits || 1;
            domainData.totalTime += data.totalTime || 0;
            domainData.attention += data.attention || 0;
            domainData.lastVisit = Math.max(domainData.lastVisit, data.lastActiveTime || 0);
        }
        
        // 类别统计
        if (data.category && data.category !== 'unknown') {
            if (!categoryStats.has(data.category)) {
                categoryStats.set(data.category, { count: 0, attention: 0 });
            }
            const categoryData = categoryStats.get(data.category);
            categoryData.count++;
            categoryData.attention += data.attention || 0;
        }
    }
    
    // 时间分布
    const peakHour = hourCounts.indexOf(Math.max(...hourCounts));
    const peakDay = dayOfWeekCounts.indexOf(Math.max(...dayOfWeekCounts));
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    
    patterns.timeDistribution = {
        peakHour,
        peakDay,
        peakDayName: weekdays[peakDay],
        hourlyDistribution: hourCounts,
        weeklyDistribution: dayOfWeekCounts
    };
    
    // 域名分布（前10）
    const topDomains = Array.from(domainStats.entries())
        .sort((a, b) => b[1].attention - a[1].attention)
        .slice(0, 10)
        .map(([domain, stats]) => ({ domain, ...stats }));
    patterns.domainDistribution = topDomains;
    
    // 类别分布
    const topCategories = Array.from(categoryStats.entries())
        .sort((a, b) => b[1].attention - a[1].attention)
        .map(([category, stats]) => ({ category, ...stats }));
    patterns.categoryDistribution = topCategories;
    
    // 生成推荐
    patterns.recommendations = generateRecommendations(patterns, domainStats, categoryStats);
    
    // 存储分析结果
    await chrome.storage.local.set({ 
        usagePatterns: patterns,
        lastAnalysis: now
    });
    
    console.log('使用模式分析完成:', patterns);
    return patterns;
}

// 生成个性化推荐
function generateRecommendations(patterns, domainStats, categoryStats) {
    const recommendations = [];
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    const oneWeek = 7 * oneDay;
    
    // 推荐1: 基于时间模式的工作模式建议
    if (patterns.timeDistribution.peakHour >= 9 && patterns.timeDistribution.peakHour <= 17) {
        recommendations.push({
            type: 'workMode',
            priority: 'high',
            title: '工作时间优化建议',
            description: `您的活跃时间主要在${patterns.timeDistribution.peakHour}点左右，建议在此时段使用专注模式以提高效率。`,
            action: 'switch_to_focus_mode',
            timeRange: [9, 17]
        });
    }
    
    // 推荐2: 长期未访问的域名清理
    const staleThreshold = now - oneWeek;
    const staleDomains = Array.from(domainStats.entries())
        .filter(([domain, stats]) => stats.lastVisit < staleThreshold && stats.attention < 0.3)
        .map(([domain]) => domain);
        
    if (staleDomains.length > 0) {
        recommendations.push({
            type: 'cleanup',
            priority: 'medium',
            title: '清理久未使用网站',
            description: `检测到${staleDomains.length}个网站超过一周未访问，建议清理相关标签页。`,
            action: 'cleanup_stale_domains',
            domains: staleDomains.slice(0, 5)
        });
    }
    
    // 推荐3: 高频域名的专用分组建议
    const highFrequencyDomains = Array.from(domainStats.entries())
        .filter(([domain, stats]) => stats.visits > 10 && stats.attention > 1.0)
        .slice(0, 3);
        
    if (highFrequencyDomains.length > 0) {
        recommendations.push({
            type: 'grouping',
            priority: 'medium',
            title: '常用网站分组建议',
            description: '为您的常用网站创建专门的标签页组，提高访问效率。',
            action: 'create_frequent_domains_group',
            domains: highFrequencyDomains.map(([domain]) => domain)
        });
    }
    
    // 推荐4: 基于类别的工作流优化
    const topCategory = patterns.categoryDistribution[0];
    if (topCategory && topCategory.attention > 2.0) {
        const workModeMap = {
            'development': 'development',
            'research': 'research',
            'entertainment': 'casual',
            'social': 'balanced'
        };
        const suggestedMode = workModeMap[topCategory.category];
        
        if (suggestedMode) {
            recommendations.push({
                type: 'workMode',
                priority: 'medium',
                title: `${topCategory.category}模式建议`,
                description: `基于您的使用习惯，建议切换到${WORK_MODES[suggestedMode]?.name || suggestedMode}模式。`,
                action: 'switch_work_mode',
                mode: suggestedMode
            });
        }
    }
    
    return recommendations.sort((a, b) => {
        const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1 };
        return priorityOrder[b.priority] - priorityOrder[a.priority];
    });
}

// 定期分析使用模式（每小时一次）
setInterval(async () => {
    try {
        await analyzeUsagePatterns();
    } catch (error) {
        console.error('使用模式分析失败:', error);
    }
}, 60 * 60 * 1000); // 每小时分析一次

// 应用推荐
async function applyRecommendation(recommendation) {
    try {
        switch (recommendation.action) {
            case 'switch_to_focus_mode':
            case 'switch_work_mode':
                const mode = recommendation.mode || 'focus';
                await switchWorkMode(mode, 'recommendation');
                break;
                
            case 'cleanup_stale_domains':
                const tabs = await chrome.tabs.query({});
                const tabsToClose = tabs.filter(tab => {
                    try {
                        const domain = new URL(tab.url).hostname;
                        return recommendation.domains.includes(domain);
                    } catch {
                        return false;
                    }
                }).slice(0, 10); // 限制最多10个
                
                for (const tab of tabsToClose) {
                    await chrome.tabs.remove(tab.id);
                }
                
                showNotification('推荐应用', `已清理${tabsToClose.length}个久未使用的标签页`);
                break;
                
            case 'create_frequent_domains_group':
                // 这将由前端处理，创建基于域名的分组
                showNotification('推荐提示', '请在分组功能中为常用网站创建专门分组');
                break;
        }
    } catch (error) {
        console.error('应用推荐失败:', error);
        showNotification('推荐应用失败', error.message);
    }
}

// 性能优化：批量处理标签页
class TabBatchProcessor {
    constructor(batchSize = 50, delay = 100) {
        this.batchSize = batchSize;
        this.delay = delay;
        this.queue = [];
        this.processing = false;
    }
    
    // 添加任务到队列
    enqueue(task) {
        return new Promise((resolve, reject) => {
            this.queue.push({ task, resolve, reject });
            if (!this.processing) {
                this.processQueue();
            }
        });
    }
    
    // 处理队列
    async processQueue() {
        if (this.processing || this.queue.length === 0) return;
        
        this.processing = true;
        
        while (this.queue.length > 0) {
            const batch = this.queue.splice(0, this.batchSize);
            
            try {
                await Promise.all(batch.map(async ({ task, resolve, reject }) => {
                    try {
                        const result = await task();
                        resolve(result);
                    } catch (error) {
                        reject(error);
                    }
                }));
            } catch (error) {
                console.error('批量处理失败:', error);
            }
            
            // 避免阻塞主线程
            if (this.queue.length > 0) {
                await new Promise(resolve => setTimeout(resolve, this.delay));
            }
        }
        
        this.processing = false;
    }
}

// 创建批量处理器实例
const tabProcessor = new TabBatchProcessor(30, 50); // 每批30个，延迟50ms

// 优化的注意力数据更新
async function batchUpdateAttentionData(updates) {
    const tasks = updates.map(({ tabId, data }) => 
        () => updateTabAttention(tabId, data)
    );
    
    return Promise.all(tasks.map(task => tabProcessor.enqueue(task)));
}

// 内存优化：定期清理和压缩数据
class MemoryManager {
    constructor() {
        this.maxEntries = 1000; // 最大条目数
        this.compressionThreshold = 800; // 压缩阈值
        this.lastCleanup = Date.now();
        this.cleanupInterval = 30 * 60 * 1000; // 30分钟
    }
    
    // 检查是否需要清理
    shouldCleanup() {
        return (
            attentionData.size > this.compressionThreshold ||
            (Date.now() - this.lastCleanup) > this.cleanupInterval
        );
    }
    
    // 执行内存清理
    async performCleanup() {
        if (!this.shouldCleanup()) return;
        
        console.log('开始内存清理，当前条目数:', attentionData.size);
        const startTime = Date.now();
        
        // 1. 移除过期和无效数据
        const now = Date.now();
        const twoWeeksAgo = now - (14 * 24 * 60 * 60 * 1000);
        const validTabIds = new Set();
        
        try {
            const tabs = await chrome.tabs.query({});
            tabs.forEach(tab => validTabIds.add(tab.id));
        } catch (error) {
            console.error('获取标签页列表失败:', error);
        }
        
        let removedCount = 0;
        for (const [tabId, data] of attentionData.entries()) {
            const shouldRemove = (
                !validTabIds.has(tabId) || // 标签页不存在
                !data.lastActiveTime || 
                data.lastActiveTime < twoWeeksAgo || // 超过两周未使用
                data.attention < 0.1 // 注意力值过低
            );
            
            if (shouldRemove) {
                attentionData.delete(tabId);
                removedCount++;
            }
        }
        
        // 2. 如果仍然超过限制，保留最重要的数据
        if (attentionData.size > this.maxEntries) {
            const sortedEntries = Array.from(attentionData.entries())
                .sort((a, b) => {
                    // 按重要性排序：注意力值 + 最近使用时间
                    const scoreA = (a[1].attention || 0) + 
                                  (a[1].lastActiveTime || 0) / (24 * 60 * 60 * 1000);
                    const scoreB = (b[1].attention || 0) + 
                                  (b[1].lastActiveTime || 0) / (24 * 60 * 60 * 1000);
                    return scoreB - scoreA;
                });
            
            // 只保留前N个最重要的条目
            attentionData.clear();
            sortedEntries.slice(0, this.maxEntries).forEach(([tabId, data]) => {
                attentionData.set(tabId, data);
            });
            
            removedCount += sortedEntries.length - this.maxEntries;
        }
        
        // 3. 压缩剩余数据（移除不必要的字段）
        let compressedCount = 0;
        for (const [tabId, data] of attentionData.entries()) {
            const compressed = this.compressAttentionData(data);
            if (compressed !== data) {
                attentionData.set(tabId, compressed);
                compressedCount++;
            }
        }
        
        this.lastCleanup = Date.now();
        const duration = Date.now() - startTime;
        
        console.log(`内存清理完成: 移除${removedCount}个条目, 压缩${compressedCount}个条目, 用时${duration}ms, 当前大小:${attentionData.size}`);
        
        // 更新健康状态
        try {
            await chrome.storage.local.set({
                memoryCleanup: {
                    lastCleanup: this.lastCleanup,
                    removedCount,
                    compressedCount,
                    currentSize: attentionData.size,
                    duration
                }
            });
        } catch (error) {
            console.error('保存清理状态失败:', error);
        }
    }
    
    // 压缩注意力数据
    compressAttentionData(data) {
        const compressed = { ...data };
        
        // 限制访问模式历史长度
        if (compressed.accessPattern && compressed.accessPattern.length > 20) {
            compressed.accessPattern = compressed.accessPattern.slice(-20);
        }
        
        // 移除过时的交互数据
        if (compressed.interactions) {
            const now = Date.now();
            const oneWeekAgo = now - (7 * 24 * 60 * 60 * 1000);
            
            if (compressed.interactions.timestamps) {
                compressed.interactions.timestamps = compressed.interactions.timestamps
                    .filter(timestamp => timestamp > oneWeekAgo);
            }
        }
        
        // 清理空或无效的字段
        Object.keys(compressed).forEach(key => {
            const value = compressed[key];
            if (value === null || value === undefined || 
                (Array.isArray(value) && value.length === 0) ||
                (typeof value === 'object' && Object.keys(value).length === 0)) {
                delete compressed[key];
            }
        });
        
        return compressed;
    }
    
    // 获取内存使用统计
    getMemoryStats() {
        const stats = {
            totalEntries: attentionData.size,
            memoryEstimate: this.estimateMemoryUsage(),
            lastCleanup: this.lastCleanup,
            needsCleanup: this.shouldCleanup()
        };
        
        return stats;
    }
    
    // 估算内存使用量
    estimateMemoryUsage() {
        let totalSize = 0;
        for (const [tabId, data] of attentionData.entries()) {
            totalSize += JSON.stringify(data).length * 2; // 粗略估算，字符*2字节
        }
        return totalSize;
    }
}

// 创建内存管理器实例
const memoryManager = new MemoryManager();

// 定期执行内存清理
setInterval(async () => {
    try {
        await memoryManager.performCleanup();
    } catch (error) {
        console.error('定期内存清理失败:', error);
    }
}, 15 * 60 * 1000); // 每15分钟检查一次

// 优化的标签页查询（支持分页和过滤）
async function getTabsOptimized(options = {}) {
    const {
        limit = 100,
        offset = 0,
        sortBy = 'lastAccessed',
        filter = null,
        includeAttentionData = true
    } = options;
    
    try {
        const allTabs = await chrome.tabs.query({});
        let filteredTabs = allTabs;
        
        // 应用过滤器
        if (filter) {
            filteredTabs = allTabs.filter(filter);
        }
        
        // 排序
        filteredTabs.sort((a, b) => {
            switch (sortBy) {
                case 'attention':
                    const attentionA = attentionData.get(a.id)?.attention || 0;
                    const attentionB = attentionData.get(b.id)?.attention || 0;
                    return attentionB - attentionA;
                case 'lastAccessed':
                default:
                    return (b.lastAccessed || 0) - (a.lastAccessed || 0);
            }
        });
        
        // 分页
        const pagedTabs = filteredTabs.slice(offset, offset + limit);
        
        // 添加注意力数据（如果需要）
        if (includeAttentionData) {
            return pagedTabs.map(tab => ({
                ...tab,
                attentionData: attentionData.get(tab.id) || {}
            }));
        }
        
        return pagedTabs;
    } catch (error) {
        console.error('获取优化标签页数据失败:', error);
        return [];
    }
}

// 安全性和隐私保护模块
class SecurityManager {
    constructor() {
        this.sensitiveDataTypes = [
            'password', 'ssn', 'credit-card', 'bank', 'api-key', 'token'
        ];
        this.encryptionKey = null;
        this.initializeEncryption();
    }
    
    // 初始化加密密钥
    async initializeEncryption() {
        try {
            const result = await chrome.storage.local.get(['encryptionKey']);
            if (!result.encryptionKey) {
                // 生成新的加密密钥
                this.encryptionKey = this.generateEncryptionKey();
                await chrome.storage.local.set({ encryptionKey: this.encryptionKey });
            } else {
                this.encryptionKey = result.encryptionKey;
            }
        } catch (error) {
            console.error('初始化加密失败:', error);
            this.encryptionKey = this.generateEncryptionKey();
        }
    }
    
    // 生成加密密钥
    generateEncryptionKey() {
        const array = new Uint8Array(32);
        crypto.getRandomValues(array);
        return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    }
    
    // 简单的数据混淆（用于敏感数据保护）
    obfuscateData(data) {
        if (typeof data !== 'string') return data;
        
        const encoded = btoa(data);
        return encoded.split('').reverse().join('');
    }
    
    // 解混淆数据
    deobfuscateData(obfuscatedData) {
        if (typeof obfuscatedData !== 'string') return obfuscatedData;
        
        try {
            const reversed = obfuscatedData.split('').reverse().join('');
            return atob(reversed);
        } catch {
            return obfuscatedData; // 如果解码失败，返回原数据
        }
    }
    
    // 检测敏感数据
    containsSensitiveData(text) {
        if (!text || typeof text !== 'string') return false;
        
        const lowerText = text.toLowerCase();
        return this.sensitiveDataTypes.some(type => {
            switch (type) {
                case 'password':
                    return /password|passwd|pwd|secret/i.test(lowerText);
                case 'credit-card':
                    return /\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}/.test(text);
                case 'ssn':
                    return /\d{3}-\d{2}-\d{4}/.test(text);
                case 'api-key':
                    return /api[_-]?key|token|bearer/i.test(lowerText) && 
                           text.length > 20;
                default:
                    return lowerText.includes(type);
            }
        });
    }
    
    // 清理敏感数据
    sanitizeData(data) {
        if (!data || typeof data !== 'object') return data;
        
        const sanitized = { ...data };
        
        // 清理标题和URL中的敏感信息
        if (sanitized.title && this.containsSensitiveData(sanitized.title)) {
            sanitized.title = this.redactSensitiveText(sanitized.title);
        }
        
        if (sanitized.url && this.containsSensitiveData(sanitized.url)) {
            // 对于包含敏感信息的URL，只保留域名
            try {
                const url = new URL(sanitized.url);
                sanitized.url = `${url.protocol}//${url.hostname}`;
            } catch {
                sanitized.url = '[已过滤]';
            }
        }
        
        return sanitized;
    }
    
    // 编辑敏感文本
    redactSensitiveText(text) {
        let redacted = text;
        
        // 编辑邮箱地址
        redacted = redacted.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, 
                                  (match) => match.charAt(0) + '***@' + match.split('@')[1]);
        
        // 编辑信用卡号
        redacted = redacted.replace(/\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}/g, 
                                  '****-****-****-****');
        
        // 编辑可能的密码或token
        redacted = redacted.replace(/[a-zA-Z0-9]{20,}/g, match => 
            match.substring(0, 3) + '*'.repeat(Math.min(match.length - 3, 10))
        );
        
        return redacted;
    }
    
    // 数据导出时的隐私保护
    prepareDataForExport(data, includePrivate = false) {
        if (!includePrivate) {
            // 创建清理后的副本
            const cleaned = JSON.parse(JSON.stringify(data));
            
            // 移除敏感字段
            delete cleaned.apiKey;
            delete cleaned.apiEndpoint;
            delete cleaned.personalData;
            
            // 清理注意力数据中的敏感信息
            if (cleaned.attentionData) {
                for (const [tabId, tabData] of Object.entries(cleaned.attentionData)) {
                    cleaned.attentionData[tabId] = this.sanitizeData(tabData);
                }
            }
            
            return cleaned;
        }
        
        return data;
    }
    
    // 验证权限
    async verifyPermissions() {
        const requiredPermissions = ['tabs', 'storage', 'notifications'];
        const permissions = {
            granted: [],
            missing: []
        };
        
        for (const permission of requiredPermissions) {
            const hasPermission = await chrome.permissions.contains({
                permissions: [permission]
            });
            
            if (hasPermission) {
                permissions.granted.push(permission);
            } else {
                permissions.missing.push(permission);
            }
        }
        
        return permissions;
    }
    
    // 清理本地存储中的敏感数据
    async cleanupSensitiveStorage() {
        try {
            const items = await chrome.storage.local.get(null);
            const keysToRemove = [];
            
            for (const [key, value] of Object.entries(items)) {
                if (typeof value === 'string' && this.containsSensitiveData(value)) {
                    keysToRemove.push(key);
                } else if (typeof value === 'object' && value !== null) {
                    // 检查对象中的敏感数据
                    const stringified = JSON.stringify(value);
                    if (this.containsSensitiveData(stringified)) {
                        keysToRemove.push(key);
                    }
                }
            }
            
            if (keysToRemove.length > 0) {
                await chrome.storage.local.remove(keysToRemove);
                console.log(`清理了${keysToRemove.length}个包含敏感数据的存储项`);
            }
        } catch (error) {
            console.error('清理敏感存储数据失败:', error);
        }
    }
    
    // 生成隐私报告
    async generatePrivacyReport() {
        const report = {
            timestamp: Date.now(),
            dataTypes: {
                attentionData: attentionData.size,
                cachedTabs: 0,
                settings: 0,
                analytics: 0
            },
            permissions: await this.verifyPermissions(),
            sensitiveDataFound: false,
            recommendations: []
        };
        
        // 检查存储的数据
        try {
            const storageData = await chrome.storage.local.get(null);
            const syncData = await chrome.storage.sync.get(null);
            
            report.dataTypes.cachedTabs = Object.keys(storageData).filter(key => 
                key.startsWith('tab_')).length;
            report.dataTypes.settings = Object.keys(syncData).length;
            
            // 检查是否有敏感数据
            const allData = JSON.stringify({ ...storageData, ...syncData });
            report.sensitiveDataFound = this.containsSensitiveData(allData);
            
            if (report.sensitiveDataFound) {
                report.recommendations.push('发现敏感数据，建议定期清理存储');
            }
            
            if (report.permissions.missing.length > 0) {
                report.recommendations.push('缺少必要权限，功能可能受限');
            }
            
            if (report.dataTypes.attentionData > 1000) {
                report.recommendations.push('注意力数据较多，建议清理过期数据');
            }
        } catch (error) {
            console.error('生成隐私报告失败:', error);
        }
        
        return report;
    }
}

// 创建安全管理器实例
const securityManager = new SecurityManager();

// 定期安全检查（每天一次）
setInterval(async () => {
    try {
        await securityManager.cleanupSensitiveStorage();
        const report = await securityManager.generatePrivacyReport();
        console.log('隐私安全检查完成:', report);
    } catch (error) {
        console.error('定期安全检查失败:', error);
    }
}, 24 * 60 * 60 * 1000); // 每24小时检查一次

// 覆盖原有的数据存储，添加安全保护
const originalUpdateTabAttention = updateTabAttention;
function updateTabAttention(tabId, newData) {
    // 在存储前清理敏感数据
    const sanitizedData = securityManager.sanitizeData(newData);
    return originalUpdateTabAttention(tabId, sanitizedData);
}