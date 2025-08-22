import { TabInfo, TabGroup, Settings, WorkSession, Workspace } from '../types';

/**
 * Chrome存储管理器
 */
export class StorageManager {
  private static instance: StorageManager;
  
  static getInstance(): StorageManager {
    if (!this.instance) {
      this.instance = new StorageManager();
    }
    return this.instance;
  }

  /**
   * 保存标签页数据
   */
  async saveTabData(tabId: number, data: Partial<TabInfo>): Promise<void> {
    const key = `tab_${tabId}`;
    await chrome.storage.local.set({ [key]: data });
  }

  /**
   * 获取标签页数据
   */
  async getTabData(tabId: number): Promise<TabInfo | null> {
    const key = `tab_${tabId}`;
    const result = await chrome.storage.local.get([key]);
    return result[key] || null;
  }

  /**
   * 批量获取标签页数据
   */
  async getAllTabsData(): Promise<TabInfo[]> {
    const result = await chrome.storage.local.get(null);
    const tabsData: TabInfo[] = [];
    
    for (const key in result) {
      if (key.startsWith('tab_') && result[key]) {
        tabsData.push(result[key]);
      }
    }
    
    return tabsData.sort((a, b) => (b.attentionScore || 0) - (a.attentionScore || 0));
  }

  /**
   * 保存分组数据
   */
  async saveGroups(groups: TabGroup[]): Promise<void> {
    await chrome.storage.local.set({ 
      groups: groups,
      groups_updated_at: Date.now()
    });
  }

  /**
   * 获取分组数据
   */
  async getGroups(): Promise<TabGroup[]> {
    const result = await chrome.storage.local.get(['groups']);
    return result.groups || [];
  }

  /**
   * 保存设置
   */
  async saveSettings(settings: Settings): Promise<void> {
    // 加密敏感信息
    const encryptedSettings = { ...settings };
    if (settings.ai.apiKey) {
      encryptedSettings.ai.apiKey = this.encrypt(settings.ai.apiKey);
    }
    
    await chrome.storage.local.set({ settings: encryptedSettings });
  }

  /**
   * 获取设置
   */
  async getSettings(): Promise<Settings> {
    const result = await chrome.storage.local.get(['settings']);
    const settings = result.settings || this.getDefaultSettings();
    
    // 解密敏感信息
    if (settings.ai.apiKey) {
      try {
        settings.ai.apiKey = this.decrypt(settings.ai.apiKey);
      } catch (e) {
        // 解密失败，重置API密钥
        settings.ai.apiKey = '';
      }
    }
    
    return settings;
  }

  /**
   * 获取默认设置
   */
  public getDefaultSettings(): Settings {
    return {
      ai: {
        enabled: false,
        provider: 'custom',
        model: 'gpt-4o-mini',
        apiKey: '',
        apiUrl: 'https://yunwu.zeabur.app',
        temperature: 0.2,
        maxTokens: 2000
      },
      attention: {
        trackingEnabled: true,
        sessionTimeout: 30 * 60 * 1000, // 30分钟
        decayRate: 0.98,
        minScore: 0.01
      },
      grouping: {
        autoGrouping: true,
        minGroupSize: 2,
        maxGroupSize: 8,
        confidenceThreshold: 0.4
      },
      ui: {
        theme: 'light',
        compactMode: false,
        showScores: true
      }
    };
  }

  /**
   * 保存工作会话
   */
  async saveWorkSession(session: WorkSession): Promise<void> {
    const sessions = await this.getWorkSessions();
    sessions.push(session);
    
    // 保留最近30天的会话
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recentSessions = sessions.filter(s => s.startTime > thirtyDaysAgo);
    
    await chrome.storage.local.set({ work_sessions: recentSessions });
  }

  /**
   * 获取工作会话
   */
  async getWorkSessions(): Promise<WorkSession[]> {
    const result = await chrome.storage.local.get(['work_sessions']);
    return result.work_sessions || [];
  }

  /**
   * 清理过期数据
   */
  async cleanupOldData(): Promise<void> {
    const settings = await this.getSettings();
    const retentionDays = 7; // 保留7天数据
    const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
    
    const allData = await chrome.storage.local.get(null);
    const keysToRemove: string[] = [];
    
    for (const key in allData) {
      if (key.startsWith('tab_')) {
        const tabData = allData[key];
        if (tabData && tabData.lastAccessTime < cutoffTime) {
          keysToRemove.push(key);
        }
      }
    }
    
    if (keysToRemove.length > 0) {
      await chrome.storage.local.remove(keysToRemove);
      console.log(`清理了 ${keysToRemove.length} 个过期标签页数据`);
    }
  }

  /**
   * 导出数据
   */
  async exportData(): Promise<string> {
    const allData = await chrome.storage.local.get(null);
    
    // 移除敏感信息
    const exportData = { ...allData };
    if (exportData.settings?.ai?.apiKey) {
      delete exportData.settings.ai.apiKey;
    }
    
    return JSON.stringify(exportData, null, 2);
  }

  /**
   * 导入数据
   */
  async importData(jsonData: string): Promise<boolean> {
    try {
      const data = JSON.parse(jsonData);
      
      // 验证数据格式
      if (typeof data !== 'object' || data === null) {
        throw new Error('无效的数据格式');
      }
      
      // 清除现有数据（保留设置中的API密钥）
      const currentSettings = await this.getSettings();
      await chrome.storage.local.clear();
      
      // 导入新数据
      await chrome.storage.local.set(data);
      
      // 恢复API密钥
      if (currentSettings.ai.apiKey) {
        const newSettings = await this.getSettings();
        newSettings.ai.apiKey = currentSettings.ai.apiKey;
        await this.saveSettings(newSettings);
      }
      
      return true;
    } catch (error) {
      console.error('导入数据失败:', error);
      return false;
    }
  }

  /**
   * 清除所有数据
   */
  async clearAllData(): Promise<void> {
    await chrome.storage.local.clear();
  }

  /**
   * 获取存储使用情况
   */
  async getStorageUsage(): Promise<{used: number, quota: number}> {
    const usage = await chrome.storage.local.getBytesInUse();
    return {
      used: usage,
      quota: chrome.storage.local.QUOTA_BYTES
    };
  }

  /**
   * 简单加密（仅混淆，不是真正的安全加密）
   */
  private encrypt(text: string): string {
    console.log('=== 加密调试 ===');
    console.log('原始文本长度:', text.length);
    console.log('原始文本前10字符:', text.substring(0, 10));
    const encrypted = btoa(encodeURIComponent(text));
    console.log('加密后长度:', encrypted.length);
    console.log('加密后前10字符:', encrypted.substring(0, 10));
    console.log('===============');
    return encrypted;
  }

  /**
   * 简单解密
   */
  private decrypt(encryptedText: string): string {
    console.log('=== 解密调试 ===');
    console.log('加密文本长度:', encryptedText.length);
    console.log('加密文本前10字符:', encryptedText.substring(0, 10));
    try {
      const decrypted = decodeURIComponent(atob(encryptedText));
      console.log('解密后长度:', decrypted.length);
      console.log('解密后前10字符:', decrypted.substring(0, 10));
      console.log('===============');
      return decrypted;
    } catch (e) {
      console.error('解密失败:', e);
      console.log('===============');
      throw e;
    }
  }

  /**
   * 保存工作区
   */
  async saveWorkspace(workspace: Workspace): Promise<void> {
    const workspaces = await this.getAllWorkspaces();
    const existingIndex = workspaces.findIndex(w => w.id === workspace.id);
    
    if (existingIndex !== -1) {
      workspaces[existingIndex] = { ...workspace, updatedAt: Date.now() };
    } else {
      workspaces.push(workspace);
    }
    
    await chrome.storage.local.set({ 'workspaces': workspaces });
  }

  /**
   * 获取所有工作区
   */
  async getAllWorkspaces(): Promise<Workspace[]> {
    const result = await chrome.storage.local.get(['workspaces']);
    return result.workspaces || [];
  }

  /**
   * 获取工作区
   */
  async getWorkspace(workspaceId: string): Promise<Workspace | null> {
    const workspaces = await this.getAllWorkspaces();
    return workspaces.find(w => w.id === workspaceId) || null;
  }

  /**
   * 删除工作区
   */
  async deleteWorkspace(workspaceId: string): Promise<void> {
    const workspaces = await this.getAllWorkspaces();
    const filteredWorkspaces = workspaces.filter(w => w.id !== workspaceId);
    await chrome.storage.local.set({ 'workspaces': filteredWorkspaces });
  }

  /**
   * 创建工作区模板
   */
  async createWorkspaceTemplate(name: string, description: string, groups: TabGroup[], tags: string[] = []): Promise<Workspace> {
    const totalTabs = groups.reduce((sum, group) => sum + group.tabIds.length, 0);
    const avgAttentionScore = groups.length > 0 
      ? groups.reduce((sum, group) => sum + group.attentionWeight, 0) / groups.length
      : 0;
    
    const workspace: Workspace = {
      id: `workspace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name,
      description,
      groups: groups.map(g => ({ ...g, id: `${g.id}_template` })),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isTemplate: true,
      tags,
      metadata: {
        totalTabs,
        avgAttentionScore,
        workflowType: this.inferWorkflowType(groups)
      }
    };
    
    await this.saveWorkspace(workspace);
    return workspace;
  }

  /**
   * 推断工作流类型
   */
  private inferWorkflowType(groups: TabGroup[]): string {
    const groupNames = groups.map(g => g.name.toLowerCase());
    const allText = groupNames.join(' ');
    
    if (allText.includes('github') || allText.includes('code') || allText.includes('dev')) {
      return 'development';
    } else if (allText.includes('research') || allText.includes('paper') || allText.includes('study')) {
      return 'research';
    } else if (allText.includes('design') || allText.includes('figma') || allText.includes('sketch')) {
      return 'design';
    } else {
      return 'general';
    }
  }

  /**
   * 监听存储变化
   */
  onStorageChanged(callback: (changes: {[key: string]: chrome.storage.StorageChange}) => void): void {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local') {
        callback(changes);
      }
    });
  }
}