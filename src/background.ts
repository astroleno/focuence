import { TabInfo, ChromeMessage, InteractionEvent } from './types';
import { AttentionGraph } from './lib/attention-graph';
import { StorageManager } from './lib/storage';
import { AIGrouper } from './lib/ai-grouper';

class BackgroundService {
  private attentionGraph: AttentionGraph;
  private storageManager: StorageManager;
  private activeTabId: number | null = null;
  private tabActivationTimes: Map<number, number> = new Map();
  private sessionTabs: Set<number> = new Set();
  private groupingInProgress: boolean = false;

  constructor() {
    this.attentionGraph = new AttentionGraph();
    this.storageManager = StorageManager.getInstance();
    this.init();
  }

  private async init() {
    // 确保Chrome API可用
    if (typeof chrome === 'undefined' || !chrome.tabs) {
      console.error('Chrome API not available');
      return;
    }

    // 监听标签页事件
    chrome.tabs.onActivated.addListener(this.handleTabActivated.bind(this));
    chrome.tabs.onUpdated.addListener(this.handleTabUpdated.bind(this));
    chrome.tabs.onCreated.addListener(this.handleTabCreated.bind(this));
    chrome.tabs.onRemoved.addListener(this.handleTabRemoved.bind(this));
    
    // 监听窗口焦点变化
    chrome.windows.onFocusChanged.addListener(this.handleWindowFocusChanged.bind(this));
    
    // 监听来自popup的消息
    chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));
    
    // 定期清理数据和更新注意力分数
    setInterval(() => {
      this.updateAttentionScores();
      this.storageManager.cleanupOldData();
    }, 5 * 60 * 1000); // 每5分钟
    
    console.log('Focuence Background Service 已启动');
  }

  /**
   * 处理标签页激活
   */
  private async handleTabActivated(activeInfo: chrome.tabs.TabActiveInfo) {
    const { tabId, windowId } = activeInfo;
    const previousTabId = this.activeTabId;
    
    // 记录前一个标签页的停留时间
    if (previousTabId && this.tabActivationTimes.has(previousTabId)) {
      const dwellTime = Date.now() - this.tabActivationTimes.get(previousTabId)!;
      this.attentionGraph.recordDwellTime(previousTabId, dwellTime);
      await this.updateTabDwellTime(previousTabId, dwellTime);
    }
    
    // 记录新标签页激活
    this.activeTabId = tabId;
    this.tabActivationTimes.set(tabId, Date.now());
    this.sessionTabs.add(tabId);
    
    // 记录标签页切换事件
    this.attentionGraph.recordTabActivation(tabId, previousTabId || undefined);
    
    // 更新标签页数据
    await this.updateTabActivity(tabId);
    
    console.log(`标签页切换: ${previousTabId} -> ${tabId}`);
  }

  /**
   * 处理标签页更新
   */
  private async handleTabUpdated(
    tabId: number, 
    changeInfo: chrome.tabs.TabChangeInfo, 
    tab: chrome.tabs.Tab
  ) {
    if (changeInfo.status === 'complete' && tab.url && !tab.url.startsWith('chrome://')) {
      await this.ensureTabDataExists(tab);
      
      // 如果是当前活跃标签页，增加访问计数
      if (tabId === this.activeTabId) {
        await this.incrementTabVisitCount(tabId);
      }
    }
  }

  /**
   * 处理标签页创建
   */
  private async handleTabCreated(tab: chrome.tabs.Tab) {
    if (tab.id && tab.url && !tab.url.startsWith('chrome://')) {
      await this.ensureTabDataExists(tab);
      console.log(`新标签页创建: ${tab.id} - ${tab.title}`);
    }
  }

  /**
   * 处理标签页移除
   */
  private async handleTabRemoved(tabId: number) {
    // 记录最后的停留时间
    if (this.tabActivationTimes.has(tabId)) {
      const dwellTime = Date.now() - this.tabActivationTimes.get(tabId)!;
      this.attentionGraph.recordDwellTime(tabId, dwellTime);
    }
    
    // 清理内存数据
    this.tabActivationTimes.delete(tabId);
    this.sessionTabs.delete(tabId);
    
    if (this.activeTabId === tabId) {
      this.activeTabId = null;
    }
    
    console.log(`标签页已关闭: ${tabId}`);
  }

  /**
   * 处理窗口焦点变化
   */
  private async handleWindowFocusChanged(windowId: number) {
    if (typeof chrome === 'undefined' || !chrome.windows || !chrome.tabs) {
      return;
    }

    if (windowId === chrome.windows.WINDOW_ID_NONE) {
      // 失去焦点，记录当前标签页停留时间
      if (this.activeTabId && this.tabActivationTimes.has(this.activeTabId)) {
        const dwellTime = Date.now() - this.tabActivationTimes.get(this.activeTabId)!;
        this.attentionGraph.recordDwellTime(this.activeTabId, dwellTime);
        await this.updateTabDwellTime(this.activeTabId, dwellTime);
      }
    } else {
      // 获得焦点，更新当前活跃标签页的激活时间
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, windowId });
        if (activeTab?.id) {
          this.tabActivationTimes.set(activeTab.id, Date.now());
        }
      } catch (error) {
        console.error('获取活跃标签页失败:', error);
      }
    }
  }

  /**
   * 处理来自popup的消息
   */
  private handleMessage(
    message: ChromeMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: any) => void
  ) {
    console.log('收到消息:', message.type);
    
    // 使用立即执行异步函数
    (async () => {
      try {
        switch (message.type) {
          case 'GET_TABS':
            console.log('处理GET_TABS请求');
            const tabs = await this.getAllTabsWithAttention();
            console.log('获取到标签页数据:', tabs.length, '个');
            const response = { success: true, data: tabs };
            console.log('发送响应:', response);
            sendResponse(response);
            break;
            
          case 'PERFORM_GROUPING':
            console.log('处理PERFORM_GROUPING请求');
            if (this.groupingInProgress) {
              console.log('分组正在进行中，忽略重复请求');
              sendResponse({ success: false, error: '分组正在进行中，请稍候...' });
              return;
            }
            this.groupingInProgress = true;
            try {
              const groups = await this.performAIGrouping(message.payload.tabs, message.payload.existingGroups);
              sendResponse({ success: true, data: groups });
            } finally {
              this.groupingInProgress = false;
            }
            break;
            
          case 'APPLY_GROUPS':
            console.log('处理APPLY_GROUPS请求');
            await this.applyTabGroups(message.payload.groups);
            sendResponse({ success: true });
            break;
            
          case 'GET_GROUPS':
            console.log('处理GET_GROUPS请求');
            const savedGroups = await this.storageManager.getGroups();
            sendResponse({ success: true, data: savedGroups });
            break;
            
          case 'UPDATE_GROUP':
            console.log('处理UPDATE_GROUP请求');
            await this.updateGroup(message.payload.groupId, message.payload.updates);
            sendResponse({ success: true });
            break;
            
          case 'DELETE_GROUP':
            console.log('处理DELETE_GROUP请求');
            await this.deleteGroup(message.payload.groupId);
            sendResponse({ success: true });
            break;
            
          default:
            console.warn('未知消息类型:', message.type);
            sendResponse({ success: false, error: '未知消息类型' });
        }
      } catch (error) {
        console.error('处理消息失败:', error);
        sendResponse({ success: false, error: error.message || error.toString() });
      }
    })();
    
    return true; // 保持消息通道开放以支持异步响应
  }

  /**
   * 确保标签页数据存在
   */
  private async ensureTabDataExists(tab: chrome.tabs.Tab) {
    if (!tab.id || !tab.url || tab.url.startsWith('chrome://')) return;
    
    const existingData = await this.storageManager.getTabData(tab.id);
    
    if (!existingData) {
      const domain = this.extractDomain(tab.url);
      const path = this.extractPath(tab.url);
      
      const tabData: TabInfo = {
        id: tab.id,
        title: tab.title || '',
        url: tab.url,
        windowId: tab.windowId,
        domain,
        path,
        attentionScore: 0.1,
        createTime: Date.now(),
        lastAccessTime: Date.now(),
        activeTime: 0,
        visitCount: 1,
        totalDwellTime: 0,
        switchSequence: [],
        interactionEvents: []
      };
      
      await this.storageManager.saveTabData(tab.id, tabData);
    }
  }

  /**
   * 更新标签页活动状态
   */
  private async updateTabActivity(tabId: number) {
    const tabData = await this.storageManager.getTabData(tabId);
    if (!tabData) return;
    
    tabData.lastAccessTime = Date.now();
    tabData.visitCount = (tabData.visitCount || 0) + 1;
    
    await this.storageManager.saveTabData(tabId, tabData);
  }

  /**
   * 更新标签页停留时间
   */
  private async updateTabDwellTime(tabId: number, dwellTime: number) {
    const tabData = await this.storageManager.getTabData(tabId);
    if (!tabData) return;
    
    tabData.totalDwellTime = (tabData.totalDwellTime || 0) + dwellTime;
    tabData.activeTime = (tabData.activeTime || 0) + dwellTime;
    
    await this.storageManager.saveTabData(tabId, tabData);
  }

  /**
   * 增加标签页访问次数
   */
  private async incrementTabVisitCount(tabId: number) {
    const tabData = await this.storageManager.getTabData(tabId);
    if (!tabData) return;
    
    tabData.visitCount = (tabData.visitCount || 0) + 1;
    await this.storageManager.saveTabData(tabId, tabData);
  }

  /**
   * 更新所有标签页的注意力分数
   */
  private async updateAttentionScores() {
    const allTabs = await this.storageManager.getAllTabsData();
    
    for (const tabData of allTabs) {
      if (!tabData) continue;
      
      const newScore = this.attentionGraph.calculateAttentionScore(tabData);
      const currentScore = tabData.attentionScore || 0;
      
      if (Math.abs(newScore - currentScore) > 0.01) {
        tabData.attentionScore = newScore;
        await this.storageManager.saveTabData(tabData.id, tabData);
      }
    }
  }

  /**
   * 获取当前窗口的标签页及其注意力分数
   */
  private async getAllTabsWithAttention(): Promise<TabInfo[]> {
    console.log('开始获取当前窗口标签页数据...');
    if (typeof chrome === 'undefined' || !chrome.tabs) {
      console.log('Chrome API不可用');
      return [];
    }

    // 获取当前活跃窗口（popup触发的窗口）
    const currentWindow = await chrome.windows.getCurrent({ populate: false });
    const lastFocusedWindow = await chrome.windows.getLastFocused({ populate: false });
    const targetWindowId = lastFocusedWindow?.id || currentWindow?.id;

    const [chromeTabsResult, storedTabsData] = await Promise.all([
      chrome.tabs.query({ windowId: targetWindowId }),
      this.storageManager.getAllTabsData()
    ]);

    console.log('当前窗口标签页数量:', chromeTabsResult.length);
    console.log('存储的标签页数据数量:', storedTabsData.length);

    const storedTabsMap = new Map(storedTabsData.filter(tab => tab !== null).map(tab => [tab.id, tab]));
    const result: TabInfo[] = [];

    for (const chromeTab of chromeTabsResult) {
      if (!chromeTab.id || !chromeTab.url || chromeTab.url.startsWith('chrome://')) {
        continue;
      }

      const storedData = storedTabsMap.get(chromeTab.id);
      
      if (storedData) {
        // 更新实时信息
        storedData.title = chromeTab.title || storedData.title;
        storedData.url = chromeTab.url;
        storedData.attentionScore = this.attentionGraph.calculateAttentionScore(storedData);
        result.push(storedData);
      } else {
        // 创建新的标签页数据
        await this.ensureTabDataExists(chromeTab);
        const newData = await this.storageManager.getTabData(chromeTab.id);
        if (newData) {
          result.push(newData);
        }
      }
    }

    console.log('最终处理后的当前窗口标签页数量:', result.length);
    return result.sort((a, b) => (b.attentionScore || 0) - (a.attentionScore || 0));
  }

  /**
   * 执行AI分组
   */
  private async performAIGrouping(tabs: TabInfo[], existingGroups = []) {
    const settings = await this.storageManager.getSettings();
    
    console.log('=== AI分组流程开始 ===');
    console.log('AI启用状态:', settings.ai.enabled);
    console.log('AI配置:', {
      provider: settings.ai.provider,
      model: settings.ai.model,
      apiUrl: settings.ai.apiUrl,
      hasApiKey: !!settings.ai.apiKey
    });
    
    if (!settings.ai.enabled) {
      console.log('AI未启用，使用本地算法');
      return this.performLocalGrouping(tabs);
    }

    if (!settings.ai.apiKey) {
      console.log('API密钥未配置，使用本地算法');
      return this.performLocalGrouping(tabs);
    }

    try {
      console.log('开始创建AIGrouper实例...');
      
      const aiGrouper = new AIGrouper(settings.ai);
      console.log('调用AI分组，标签页数量:', tabs.length);
      
      const result = await aiGrouper.performSemanticGrouping(tabs, existingGroups);
      console.log('AI分组成功，结果:', result);
      
      // 保存分组结果
      await this.storageManager.saveGroups(result.groups);
      console.log('=== AI分组流程完成 ===');
      
      return result;
    } catch (error) {
      console.error('=== AI分组失败，使用本地算法 ===');
      console.error('错误详情:', error);
      console.error('错误堆栈:', error.stack);
      return this.performLocalGrouping(tabs);
    }
  }

  /**
   * 本地分组算法（降级方案）
   */
  private async performLocalGrouping(tabs: TabInfo[]) {
    const { clusters, insights } = this.attentionGraph.identifyWorkClusters(tabs);
    const groups: any[] = [];
    
    for (let i = 0; i < clusters.length; i++) {
      const cluster = clusters[i];
      if (cluster.length >= 2) {
        const clusterTabs = tabs.filter(tab => cluster.includes(tab.id));
        const domains = [...new Set(clusterTabs.map(tab => tab.domain))];
        const avgScore = clusterTabs.reduce((sum, tab) => sum + (tab.attentionScore || 0), 0) / clusterTabs.length;
        
        groups.push({
          id: `local_group_${Date.now()}_${i}`,
          name: domains.length === 1 ? this.cleanDomainName(domains[0]) : `工作区 ${i + 1}`,
          description: `${clusterTabs.length}个关联标签页`,
          tabIds: cluster,
          confidence: Math.min(0.8, avgScore + 0.2),
          reasoning: '基于注意力模式的本地分组',
          createdAt: Date.now(),
          aiGenerated: false,
          attentionWeight: avgScore
        });
      }
    }

    const usedTabIds = new Set(groups.flatMap(g => g.tabIds));
    const ungrouped = tabs.map(t => t.id).filter(id => !usedTabIds.has(id));

    return {
      groups,
      ungrouped,
      actions: { reuse: [], rename: [], merge: [] },
      insights: insights || '基于注意力模式完成本地分组'
    };
  }

  /**
   * 清理域名显示
   */
  private cleanDomainName(domain: string): string {
    return domain.replace('www.', '').split('.')[0];
  }

  /**
   * 应用标签页分组（仅当前窗口）
   */
  private async applyTabGroups(groups: any[]) {
    if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabGroups) {
      return;
    }

    // 获取当前活跃窗口（popup触发的窗口）
    const currentWindow = await chrome.windows.getCurrent({ populate: false });
    const lastFocusedWindow = await chrome.windows.getLastFocused({ populate: false });
    const targetWindowId = lastFocusedWindow?.id || currentWindow?.id;

    for (const group of groups) {
      if (group.tabIds && group.tabIds.length > 1) {
        try {
          // 验证所有标签页都在当前窗口
          const tabs = await chrome.tabs.query({ windowId: targetWindowId });
          const targetWindowTabIds = tabs.map(tab => tab.id);
          const validTabIds = group.tabIds.filter(id => targetWindowTabIds.includes(id));
          
          if (validTabIds.length > 1) {
            const groupId = await chrome.tabs.group({ tabIds: validTabIds });
            await chrome.tabGroups.update(groupId, { 
              title: group.name,
              color: this.getGroupColor(group.name)
            });
          }
        } catch (error) {
          console.error('应用分组失败:', error);
        }
      }
    }
  }

  /**
   * 更新分组
   */
  private async updateGroup(groupId: string, updates: any) {
    const groups = await this.storageManager.getGroups();
    const groupIndex = groups.findIndex(group => group.id === groupId);
    
    if (groupIndex !== -1) {
      groups[groupIndex] = { ...groups[groupIndex], ...updates };
      await this.storageManager.saveGroups(groups);
      
      if (updates.name && typeof chrome !== 'undefined' && chrome.tabGroups) {
        try {
          const chromeGroups = await chrome.tabGroups.query({ title: groups[groupIndex].name });
          for (const chromeGroup of chromeGroups) {
            await chrome.tabGroups.update(chromeGroup.id, { title: updates.name });
          }
        } catch (error) {
          console.error('更新Chrome分组名称失败:', error);
        }
      }
    }
  }

  /**
   * 删除分组
   */
  private async deleteGroup(groupId: string) {
    const groups = await this.storageManager.getGroups();
    const group = groups.find(g => g.id === groupId);
    
    if (group && typeof chrome !== 'undefined' && chrome.tabGroups) {
      try {
        const chromeGroups = await chrome.tabGroups.query({ title: group.name });
        for (const chromeGroup of chromeGroups) {
          await chrome.tabGroups.ungroup(group.tabIds.filter(id => {
            return chrome.tabs.get(id).then(() => true).catch(() => false);
          }));
        }
      } catch (error) {
        console.error('解除Chrome分组失败:', error);
      }
    }

    const updatedGroups = groups.filter(g => g.id !== groupId);
    await this.storageManager.saveGroups(updatedGroups);
  }

  /**
   * 根据分组名称选择颜色
   */
  private getGroupColor(groupName: string): chrome.tabGroups.ColorEnum {
    const colors: chrome.tabGroups.ColorEnum[] = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
    const hash = groupName.split('').reduce((a, b) => {
      a = ((a << 5) - a) + b.charCodeAt(0);
      return a & a;
    }, 0);
    return colors[Math.abs(hash) % colors.length];
  }

  /**
   * 提取域名
   */
  private extractDomain(url: string): string {
    try {
      return new URL(url).hostname.replace('www.', '');
    } catch {
      return '';
    }
  }

  /**
   * 提取路径
   */
  private extractPath(url: string): string {
    try {
      return new URL(url).pathname;
    } catch {
      return '';
    }
  }
}

// 启动后台服务
new BackgroundService();