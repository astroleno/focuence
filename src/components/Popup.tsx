import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { TabInfo, GroupResult, TabGroup, Settings, Workspace } from '../types';
import { StorageManager } from '../lib/storage';

export const Popup: React.FC = () => {
  console.log('=== Popup组件开始渲染 ===');
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [groups, setGroups] = useState<TabGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [insights, setInsights] = useState<string>('');
  const [cleanupSuggestions, setCleanupSuggestions] = useState<TabInfo[]>([]);
  const [error, setError] = useState('');
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [showWorkspaceDialog, setShowWorkspaceDialog] = useState(false);
  const [showWorkspaceList, setShowWorkspaceList] = useState(false);

  // 自动清除错误信息
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => {
        setError('');
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const storageManager = StorageManager.getInstance();
  console.log('=== Popup状态初始化完成 ===');

  useEffect(() => {
    // 调试信息
    console.log('🚀 Popup组件加载 - 版本2025-08-21');
    console.log('Chrome API可用:', typeof chrome !== 'undefined');
    if (typeof chrome !== 'undefined') {
      console.log('Chrome runtime可用:', !!chrome.runtime);
      console.log('Chrome tabs可用:', !!chrome.tabs);
      console.log('Chrome storage可用:', !!chrome.storage);
    }
    
    // 检查Chrome API是否可用
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.storage) {
      setError('Chrome扩展环境不可用');
      return;
    }
    
    loadSettings();
    loadTabs();
    loadGroups();
  }, []);

  /**
   * 加载设置
   */
  const loadSettings = async () => {
    try {
      const loadedSettings = await storageManager.getSettings();
      console.log('设置加载成功:', loadedSettings);
      console.log('AI功能启用状态:', loadedSettings.ai.enabled);
      console.log('AI配置完整信息:', {
        enabled: loadedSettings.ai.enabled,
        provider: loadedSettings.ai.provider,
        apiKey: loadedSettings.ai.apiKey ? '已设置' : '未设置',
        apiUrl: loadedSettings.ai.apiUrl
      });
      setSettings(loadedSettings);
    } catch (err) {
      console.error('加载设置失败:', err);
      // 使用默认设置
      const defaultSettings = storageManager.getDefaultSettings();
      console.log('使用默认设置:', defaultSettings);
      setSettings(defaultSettings);
    }
  };

  /**
   * 加载标签页数据
   */
  const loadTabs = useCallback(async () => {
    console.log('开始加载标签页数据...');
    if (typeof chrome === 'undefined' || !chrome.runtime) {
      console.error('Chrome API不可用');
      setError('Chrome API不可用');
      return;
    }

    try {
      console.log('发送GET_TABS消息到background...');
      const response = await chrome.runtime.sendMessage({ type: 'GET_TABS' });
      console.log('收到background响应:', response);
      
      if (response && response.success) {
        console.log('标签页加载成功:', response.data.length, '个');
        setTabs(response.data);
        setError(''); // 清除错误
      } else {
        console.error('标签页加载失败，响应:', response);
        setError(response?.error || '加载标签页数据失败');
      }
    } catch (err) {
      console.error('加载标签页异常:', err);
      setError('加载标签页数据失败: ' + err.message);
    }
  }, []);

  /**
   * 加载分组数据
   */
  const loadGroups = async () => {
    if (typeof chrome === 'undefined' || !chrome.runtime) {
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_GROUPS' });
      if (response && response.success) {
        setGroups(response.data);
      }
    } catch (err) {
      console.error('加载分组失败:', err);
    }
  };

  /**
   * 执行智能分组
   */
  const handleSmartGrouping = async () => {
    console.log('=== 智能分组按钮点击 ===');
    console.log('当前设置:', settings);
    console.log('标签页数量:', tabs.length);
    
    if (typeof chrome === 'undefined' || !chrome.runtime) {
      setError('Chrome API不可用');
      return;
    }

    if (tabs.length < 2) {
      setError('至少需要2个标签页才能进行分组');
      return;
    }

    setLoading(true);
    setLoadingMessage('AI正在分析标签页...');
    setError('');

    try {
      console.log('发送PERFORM_GROUPING消息到background...');
      const response = await chrome.runtime.sendMessage({
        type: 'PERFORM_GROUPING',
        payload: { tabs, existingGroups: groups }
      });
      
      console.log('收到分组响应:', response);

      if (response && response.success) {
        const result: GroupResult = response.data;
        console.log('分组结果:', result);
        setGroups(result.groups);
        setInsights(result.insights);
        
        // 自动应用分组
        if (result.groups.length > 0) {
          console.log('应用分组到Chrome...');
          await applyGroups(result.groups);
        } else {
          console.log('没有找到分组');
        }
      } else {
        console.error('分组失败，响应:', response);
        const errorMsg = response?.error || 'AI分组失败，请检查设置';
        
        // 特殊处理429和分组中的错误
        if (errorMsg.includes('分组正在进行中')) {
          setError('分组正在进行中，请稍候...');
        } else if (errorMsg.includes('多次使用无效令牌') || errorMsg.includes('请等待')) {
          setError('API使用过于频繁，请等待2分钟后再试');
        } else {
          setError(errorMsg);
        }
      }
    } catch (err) {
      console.error('智能分组异常:', err);
      const errorMessage = err instanceof Error ? err.message : '未知错误';
      
      if (errorMessage.includes('多次使用无效令牌') || errorMessage.includes('请等待')) {
        setError('API使用过于频繁，请等待2分钟后再试');
      } else {
        setError('执行智能分组时出错: ' + errorMessage);
      }
    } finally {
      setLoading(false);
      setLoadingMessage('');
    }
  };

  /**
   * 应用分组到Chrome
   */
  const applyGroups = async (groupsToApply: TabGroup[]) => {
    if (typeof chrome === 'undefined' || !chrome.runtime) {
      setError('Chrome API不可用');
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'APPLY_GROUPS',
        payload: { groups: groupsToApply }
      });

      if (!response || !response.success) {
        setError('应用分组失败');
      }
    } catch (err) {
      console.error('应用分组失败:', err);
      setError('应用分组时出错');
    }
  };

  /**
   * 清理建议
   */
  const handleCleanSuggestions = () => {
    const lowAttentionTabs = tabs
      .filter(tab => (tab.attentionScore || 0) < 0.3)
      .sort((a, b) => (a.attentionScore || 0) - (b.attentionScore || 0))
      .slice(0, 5);

    if (lowAttentionTabs.length === 0) {
      setInsights('所有标签页都具有较高的注意力分数，暂无清理建议');
      setCleanupSuggestions([]);
      return;
    }

    setInsights(`发现${lowAttentionTabs.length}个低活跃度标签页，建议关闭以提升浏览效率`);
    setCleanupSuggestions(lowAttentionTabs);
  };

  /**
   * 关闭单个标签页
   */
  const closeSingleTab = async (tabId: number) => {
    if (typeof chrome === 'undefined' || !chrome.tabs) {
      setError('Chrome API不可用');
      return;
    }

    try {
      console.log('准备关闭标签页:', tabId);
      await chrome.tabs.remove(tabId);
      console.log('标签页关闭成功:', tabId);
      
      // 从清理建议中移除该标签页
      const updatedSuggestions = cleanupSuggestions.filter(tab => tab.id !== tabId);
      setCleanupSuggestions(updatedSuggestions);
      
      // 重新加载标签页数据
      setTimeout(async () => {
        await loadTabs();
      }, 100);
      
      if (updatedSuggestions.length === 0) {
        setInsights('已清理完所有建议的标签页');
      }
    } catch (err) {
      console.error('关闭标签页失败:', err);
      setError(`关闭标签页失败: ${err.message || '未知错误'}`);
    }
  };

  /**
   * 关闭所有低活跃度标签页
   */
  const closeAllLowAttentionTabs = async () => {
    if (typeof chrome === 'undefined' || !chrome.tabs) {
      setError('Chrome API不可用');
      return;
    }

    if (cleanupSuggestions.length === 0) {
      setError('没有可关闭的标签页');
      return;
    }

    if (!confirm(`确定要关闭这${cleanupSuggestions.length}个低活跃度标签页吗？`)) {
      return;
    }

    try {
      console.log('准备批量关闭标签页:', cleanupSuggestions.length, '个');
      const tabIds = cleanupSuggestions.map(tab => tab.id);
      await chrome.tabs.remove(tabIds);
      console.log('批量关闭成功');
      
      // 清空清理建议
      setCleanupSuggestions([]);
      setInsights('已关闭所有低活跃度标签页');
      
      // 重新加载标签页数据
      setTimeout(async () => {
        await loadTabs();
      }, 200);
      
    } catch (err) {
      console.error('批量关闭标签页失败:', err);
      setError(`批量关闭标签页失败: ${err.message || '未知错误'}`);
    }
  };

  /**
   * 打开设置页面
   */
  const openOptions = () => {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.openOptionsPage();
    }
  };

  /**
   * 更新分组
   */
  const handleGroupUpdate = async (groupId: string, updates: Partial<TabGroup>) => {
    const updatedGroups = groups.map(group => 
      group.id === groupId ? { ...group, ...updates } : group
    );
    setGroups(updatedGroups);

    if (typeof chrome !== 'undefined' && chrome.runtime) {
      try {
        await chrome.runtime.sendMessage({
          type: 'UPDATE_GROUP',
          payload: { groupId, updates }
        });
      } catch (err) {
        console.error('更新分组失败:', err);
        setError('更新分组失败');
      }
    }
  };

  /**
   * 删除分组
   */
  const handleGroupDelete = async (groupId: string) => {
    const updatedGroups = groups.filter(group => group.id !== groupId);
    setGroups(updatedGroups);

    if (typeof chrome !== 'undefined' && chrome.runtime) {
      try {
        await chrome.runtime.sendMessage({
          type: 'DELETE_GROUP',
          payload: { groupId }
        });
        
        await loadTabs();
      } catch (err) {
        console.error('删除分组失败:', err);
        setError('删除分组失败');
      }
    }
  };

  /**
   * 保存工作区
   */
  const handleSaveWorkspace = async () => {
    const name = window.prompt('请输入工作区名称：', `工作区_${new Date().toLocaleDateString()}`);
    if (!name) return;

    try {
      const workspace: Workspace = {
        id: `workspace_${Date.now()}`,
        name: name,
        description: `保存于${new Date().toLocaleString()}`,
        groups: groups,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isTemplate: false,
        tags: [],
        metadata: {
          totalTabs: tabs.length,
          avgAttentionScore: parseFloat(stats.avgAttention) / 100,
          workflowType: 'custom'
        }
      };

      const response = await chrome.runtime.sendMessage({
        type: 'SAVE_WORKSPACE',
        payload: { workspace }
      });

      if (!response || !response.success) {
        setError('保存工作区失败');
        return;
      }

      setInsights(`工作区"${name}"已保存`);
      await loadWorkspaces();
    } catch (err) {
      console.error('保存工作区失败:', err);
      setError('保存工作区时出错');
    }
  };

  /**
   * 显示工作区列表
   */
  const handleShowWorkspaceList = async () => {
    await loadWorkspaces();
    setShowWorkspaceList(!showWorkspaceList);
  };

  /**
   * 加载工作区列表
   */
  const loadWorkspaces = async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_WORKSPACES'
      });

      if (!response || !response.success) {
        setError('获取工作区列表失败');
        return;
      }

      setWorkspaces(response.data || []);
    } catch (err) {
      console.error('获取工作区列表失败:', err);
      setError('获取工作区列表时出错');
    }
  };

  /**
   * 加载工作区
   */
  const handleLoadWorkspace = async (workspaceId: string) => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'LOAD_WORKSPACE',
        payload: { workspaceId }
      });

      if (!response || !response.success) {
        setError('加载工作区失败');
        return;
      }

      setInsights(`已加载工作区"${response.data.name}"`);
      setShowWorkspaceList(false);
      await loadTabs();
      await loadGroups();
    } catch (err) {
      console.error('加载工作区失败:', err);
      setError('加载工作区时出错');
    }
  };

  /**
   * 删除工作区
   */
  const handleDeleteWorkspace = async (workspaceId: string, workspaceName: string) => {
    if (!window.confirm(`确定要删除工作区"${workspaceName}"吗？`)) {
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'DELETE_WORKSPACE',
        payload: { workspaceId }
      });

      if (!response || !response.success) {
        setError('删除工作区失败');
        return;
      }

      setInsights(`已删除工作区"${workspaceName}"`);
      await loadWorkspaces();
    } catch (err) {
      console.error('删除工作区失败:', err);
      setError('删除工作区时出错');
    }
  };

  /**
   * 计算总体统计 (memoized)
   */
  const stats = useMemo(() => ({
    totalTabs: tabs.length,
    avgAttention: tabs.length > 0 
      ? (tabs.reduce((sum, tab) => sum + (tab.attentionScore || 0), 0) / tabs.length).toFixed(2)
      : '0.00'
  }), [tabs]);

  return (
    <div className="container">
      {/* 头部 */}
      <div className="header">
        <div className="logo">
          <div className="logo-dot"></div>
          <span>Focuence智序</span>
        </div>
      </div>

      {/* 统计信息 */}
      <div className="stats">
        <div className="stat-item">
          <div className="stat-value">{stats.totalTabs}</div>
          <div className="stat-label">当前标签页</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{stats.avgAttention}</div>
          <div className="stat-label">平均注意力</div>
        </div>
      </div>
      
      {/* 调试信息 */}
      <div style={{fontSize: '11px', color: '#666', padding: '5px', borderTop: '1px solid #eee'}}>
        调试: AI={settings?.ai?.enabled ? '启用' : '禁用'} | 标签数={tabs.length} | 设置={settings ? '已加载' : '未加载'}
      </div>

      {/* 操作按钮 */}
      <div className="actions">
        <button 
          className="btn btn-primary" 
          onClick={handleSmartGrouping}
          disabled={loading || tabs.length < 2 || !settings?.ai?.enabled}
          title={!settings?.ai?.enabled ? '请先在设置中启用AI功能' : ''}
        >
          {loading ? loadingMessage.slice(0, 6) + '...' : (settings?.ai?.enabled ? '智能分组' : '请先启用AI功能')}
        </button>
        <button 
          className="btn" 
          onClick={handleCleanSuggestions}
          disabled={loading || tabs.length === 0}
        >
          清理建议
        </button>
        <button 
          className="btn" 
          onClick={handleSaveWorkspace}
          disabled={loading || groups.length === 0}
          title="保存当前分组为工作区"
        >
          保存工作区
        </button>
        <button 
          className="btn" 
          onClick={handleShowWorkspaceList}
          disabled={loading}
          title="管理工作区"
        >
          工作区管理
        </button>
        <button 
          className="btn" 
          onClick={loadTabs}
          disabled={loading}
          title="刷新标签页数据"
          style={{ fontSize: '12px', padding: '6px 8px' }}
        >
          🔄
        </button>
      </div>

      {/* 错误提示 */}
      {error && (
        <div style={{ 
          padding: '8px 20px', 
          background: '#fee2e2', 
          color: '#dc2626', 
          fontSize: '13px',
          borderLeft: '3px solid #dc2626'
        }}>
          {error}
        </div>
      )}

      {/* 洞察信息 */}
      {insights && (
        <div className="insights">
          <div className="insights-text">{insights}</div>
        </div>
      )}

      {/* 清理建议 */}
      {cleanupSuggestions.length > 0 && (
        <div className="cleanup-suggestions" style={{ 
          margin: '12px 20px',
          padding: '12px',
          backgroundColor: '#fff5f5',
          border: '1px solid #fed7d7',
          borderRadius: '6px'
        }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            marginBottom: '8px'
          }}>
            <div style={{ fontWeight: 'bold', color: '#c53030' }}>
              建议关闭的低活跃度标签页
            </div>
            <button
              style={{
                background: '#dc2626',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                padding: '4px 8px',
                fontSize: '11px',
                cursor: 'pointer'
              }}
              onClick={closeAllLowAttentionTabs}
            >
              全部关闭
            </button>
          </div>
          {cleanupSuggestions.map((tab) => (
            <div key={tab.id} style={{ 
              display: 'flex', 
              alignItems: 'center', 
              marginBottom: '4px',
              padding: '6px',
              backgroundColor: 'white',
              borderRadius: '4px',
              fontSize: '12px',
              border: '1px solid #fed7d7'
            }}>
              <img 
                src={`https://www.google.com/s2/favicons?domain=${tab.domain}&sz=16`}
                style={{ width: '16px', height: '16px', marginRight: '8px' }}
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.style.display = 'none';
                }}
              />
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <div style={{ 
                  whiteSpace: 'nowrap', 
                  overflow: 'hidden', 
                  textOverflow: 'ellipsis',
                  fontWeight: '500'
                }}>
                  {tab.title || '无标题'}
                </div>
                <div style={{ color: '#666', fontSize: '11px' }}>
                  {tab.domain} · 分数: {(tab.attentionScore * 100).toFixed(0)}%
                </div>
              </div>
              <button
                style={{
                  background: '#ef4444',
                  color: 'white',
                  border: 'none',
                  borderRadius: '3px',
                  padding: '3px 8px',
                  fontSize: '10px',
                  marginLeft: '8px',
                  cursor: 'pointer'
                }}
                onClick={() => closeSingleTab(tab.id)}
              >
                关闭
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 工作区管理 */}
      {showWorkspaceList && (
        <div className="workspace-list" style={{ 
          margin: '12px 20px',
          padding: '12px',
          backgroundColor: '#f0f9ff',
          border: '1px solid #bae6fd',
          borderRadius: '6px'
        }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            marginBottom: '12px'
          }}>
            <div style={{ fontWeight: 'bold', color: '#0369a1' }}>
              工作区管理 ({workspaces.length})
            </div>
            <button
              style={{
                background: '#0284c7',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                padding: '4px 8px',
                fontSize: '11px',
                cursor: 'pointer'
              }}
              onClick={() => setShowWorkspaceList(false)}
            >
              关闭
            </button>
          </div>
          
          {workspaces.length === 0 ? (
            <div style={{ 
              padding: '20px', 
              textAlign: 'center', 
              color: '#64748b',
              fontSize: '13px'
            }}>
              暂无保存的工作区<br/>
              <span style={{ fontSize: '11px' }}>
                点击"保存工作区"按钮保存当前分组状态
              </span>
            </div>
          ) : (
            workspaces.map((workspace) => (
              <div key={workspace.id} style={{ 
                display: 'flex', 
                alignItems: 'center', 
                marginBottom: '8px',
                padding: '8px',
                backgroundColor: 'white',
                borderRadius: '4px',
                fontSize: '12px',
                border: '1px solid #e0f2fe'
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: '500', color: '#0c4a6e' }}>
                    {workspace.name}
                  </div>
                  <div style={{ color: '#64748b', fontSize: '11px' }}>
                    {workspace.groups.length}个分组 · {workspace.metadata.totalTabs}个标签页 · {new Date(workspace.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    style={{
                      background: '#059669',
                      color: 'white',
                      border: 'none',
                      borderRadius: '3px',
                      padding: '3px 6px',
                      fontSize: '10px',
                      cursor: 'pointer'
                    }}
                    onClick={() => handleLoadWorkspace(workspace.id)}
                    title="加载工作区"
                  >
                    加载
                  </button>
                  <button
                    style={{
                      background: '#dc2626',
                      color: 'white',
                      border: 'none',
                      borderRadius: '3px',
                      padding: '3px 6px',
                      fontSize: '10px',
                      cursor: 'pointer'
                    }}
                    onClick={() => handleDeleteWorkspace(workspace.id, workspace.name)}
                    title="删除工作区"
                  >
                    删除
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* 分组列表 */}
      <div className="groups">
        {loading ? (
          <div className="loading">
            <div className="spinner"></div>
            <span>{loadingMessage || 'AI正在分析...'}</span>
          </div>
        ) : groups.length > 0 ? (
          groups.map((group, index) => (
            <GroupItem 
              key={group.id} 
              group={group} 
              tabs={tabs}
              onGroupUpdate={handleGroupUpdate}
              onGroupDelete={handleGroupDelete}
            />
          ))
        ) : tabs.length > 0 ? (
          <div className="empty-state">
            <div className="empty-text">
              点击"智能分组"开始<br/>
              AI会根据注意力模式<br/>
              为您智能整理标签页
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-text">
              暂无标签页数据<br/>
              请打开一些网页后重试
            </div>
          </div>
        )}
      </div>

      {/* 底部 */}
      <div className="footer">
        <button className="footer-link" onClick={openOptions}>
          设置
        </button>
      </div>
    </div>
  );
};

/**
 * 分组项组件
 */
const GroupItem: React.FC<{ 
  group: TabGroup; 
  tabs: TabInfo[];
  onGroupUpdate: (groupId: string, updates: Partial<TabGroup>) => void;
  onGroupDelete: (groupId: string) => void;
}> = ({ group, tabs, onGroupUpdate, onGroupDelete }) => {
  const [expanded, setExpanded] = useState(false);
  const [hoveredTab, setHoveredTab] = useState<TabInfo | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editingName, setEditingName] = useState(group.name);
  const [showGroupActions, setShowGroupActions] = useState(false);
  const groupTabs = tabs.filter(tab => group.tabIds.includes(tab.id));
  const avgScore = group.attentionWeight || group.confidence;

  const switchToTab = async (tabId: number) => {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      try {
        await chrome.tabs.update(tabId, { active: true });
        await chrome.windows.getCurrent().then(window => {
          if (window.id) {
            chrome.windows.update(window.id, { focused: true });
          }
        });
      } catch (err) {
        console.error('切换标签页失败:', err);
      }
    }
  };

  const handleNameEdit = () => {
    setIsEditing(true);
    setEditingName(group.name);
  };

  const handleNameSave = () => {
    if (editingName.trim() && editingName !== group.name) {
      onGroupUpdate(group.id, { name: editingName.trim() });
    }
    setIsEditing(false);
  };

  const handleNameCancel = () => {
    setEditingName(group.name);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleNameSave();
    } else if (e.key === 'Escape') {
      handleNameCancel();
    }
  };

  const handleGroupDelete = () => {
    if (confirm(`确定要删除分组"${group.name}"吗？标签页将回到未分组状态。`)) {
      onGroupDelete(group.id);
    }
  };

  return (
    <div 
      className="group-item"
      onMouseEnter={() => setShowGroupActions(true)}
      onMouseLeave={() => setShowGroupActions(false)}
    >
      <div className="group-indicator" style={{
        background: `hsl(${Math.floor(avgScore * 120)}, 50%, 50%)`
      }}></div>
      
      <div className="group-content">
        <div className="group-header" onClick={() => !isEditing && setExpanded(!expanded)}>
          {isEditing ? (
            <input
              type="text"
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onBlur={handleNameSave}
              onKeyDown={handleKeyDown}
              className="group-name-input"
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <div className="group-name" onDoubleClick={handleNameEdit}>
              {group.name}
            </div>
          )}
          <div className="group-header-actions">
            {showGroupActions && !isEditing && (
              <div className="group-actions">
                <button
                  className="group-action-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleNameEdit();
                  }}
                  title="编辑分组名称"
                >
                  ✏️
                </button>
                <button
                  className="group-action-btn group-delete-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleGroupDelete();
                  }}
                  title="删除分组"
                >
                  🗑️
                </button>
              </div>
            )}
            <div className="group-expand-icon" style={{
              transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s ease'
            }}>
              ▶
            </div>
          </div>
        </div>
        <div className="group-info">
          {group.tabIds.length}个标签页 · {group.description}
        </div>
        
        {expanded && (
          <div className="tab-list">
            {groupTabs.map((tab) => (
              <div 
                key={tab.id} 
                className="tab-item"
                onClick={() => switchToTab(tab.id)}
                onMouseEnter={() => setHoveredTab(tab)}
                onMouseLeave={() => setHoveredTab(null)}
                title={`${tab.title}\n${tab.url}\n注意力分数: ${(tab.attentionScore * 100).toFixed(0)}%`}
              >
                <img 
                  src={tab.favIconUrl || `https://www.google.com/s2/favicons?domain=${tab.domain}&sz=16`}
                  style={{ 
                    width: '16px', 
                    height: '16px', 
                    marginRight: '8px',
                    borderRadius: '2px'
                  }}
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.src = `https://www.google.com/s2/favicons?domain=${tab.domain}&sz=16`;
                  }}
                />
                <div className="tab-content">
                  <div className="tab-title">
                    {tab.title || '无标题'}
                  </div>
                  <div className="tab-url">
                    {tab.domain}
                  </div>
                </div>
                <div className="tab-attention-score" style={{
                  background: `hsl(${Math.floor((tab.attentionScore || 0) * 120)}, 50%, 90%)`,
                  color: `hsl(${Math.floor((tab.attentionScore || 0) * 120)}, 50%, 30%)`
                }}>
                  {((tab.attentionScore || 0) * 100).toFixed(0)}%
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      
      <div className="group-score">
        <div className="score-bar">
          <div 
            className="score-fill" 
            style={{ width: `${avgScore * 100}%` }}
          ></div>
        </div>
        <div className="score-text" title="注意力分数">
          {(avgScore * 100).toFixed(0)}%
        </div>
      </div>
    </div>
  );
};