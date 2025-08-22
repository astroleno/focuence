import React, { useState, useEffect } from 'react';
import { Settings } from '../types';
import { StorageManager } from '../lib/storage';
import { AIGrouper } from '../lib/ai-grouper';

export const Options: React.FC = () => {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [stats, setStats] = useState<any>({});
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const storageManager = StorageManager.getInstance();

  useEffect(() => {
    loadSettings();
    loadStats();
  }, []);

  const loadSettings = async () => {
    try {
      // Check if Chrome APIs are available
      if (typeof chrome === 'undefined' || !chrome.storage) {
        throw new Error('Chrome APIs not available');
      }
      
      const loadedSettings = await storageManager.getSettings();
      setSettings(loadedSettings);
    } catch (error) {
      console.error('加载设置失败:', error);
      showMessage('error', '加载设置失败: ' + error.message);
      
      // Use default settings as fallback
      const defaultSettings = storageManager.getDefaultSettings();
      setSettings(defaultSettings);
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      // Check if Chrome APIs are available
      if (typeof chrome === 'undefined' || !chrome.storage) {
        throw new Error('Chrome APIs not available');
      }
      
      const [tabs, usage] = await Promise.all([
        storageManager.getAllTabsData(),
        storageManager.getStorageUsage()
      ]);

      const validTabs = tabs.filter(tab => tab && typeof tab.attentionScore === 'number');
      
      setStats({
        totalTabs: validTabs.length,
        avgAttention: validTabs.length > 0 
          ? (validTabs.reduce((sum, tab) => sum + (tab.attentionScore || 0), 0) / validTabs.length).toFixed(3)
          : 0,
        storageUsed: (usage.used / 1024).toFixed(1),
        storageQuota: (usage.quota / 1024 / 1024).toFixed(1)
      });
    } catch (error) {
      console.error('加载统计失败:', error);
      // Set default stats on error
      setStats({
        totalTabs: 0,
        avgAttention: 0,
        storageUsed: 0,
        storageQuota: 0
      });
    }
  };

  const updateSettings = (updates: Partial<Settings>) => {
    if (settings) {
      setSettings({ ...settings, ...updates });
    }
  };

  const updateAISettings = (updates: Partial<Settings['ai']>) => {
    if (settings) {
      setSettings({
        ...settings,
        ai: { ...settings.ai, ...updates }
      });
    }
  };

  const saveSettings = async () => {
    if (!settings) return;

    setSaving(true);
    try {
      await storageManager.saveSettings(settings);
      showMessage('success', '设置保存成功');
    } catch (error) {
      showMessage('error', '保存设置失败');
    } finally {
      setSaving(false);
    }
  };

  const testAIConnection = async () => {
    if (!settings?.ai.apiKey) {
      showMessage('error', '请先输入API密钥');
      return;
    }

    setTestingConnection(true);
    setConnectionStatus('idle');

    try {
      const aiGrouper = new AIGrouper(settings.ai);
      const isConnected = await aiGrouper.testConnection();
      
      if (isConnected) {
        setConnectionStatus('success');
        showMessage('success', 'AI连接测试成功');
      } else {
        setConnectionStatus('error');
        showMessage('error', 'AI连接测试失败，请检查API密钥和网络');
      }
    } catch (error) {
      setConnectionStatus('error');
      showMessage('error', `连接失败: ${error.message}`);
    } finally {
      setTestingConnection(false);
    }
  };

  const exportData = async () => {
    try {
      const data = await storageManager.exportData();
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `focuence-data-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showMessage('success', '数据导出成功');
    } catch (error) {
      showMessage('error', '导出数据失败');
    }
  };

  const importData = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const success = await storageManager.importData(text);
      
      if (success) {
        showMessage('success', '数据导入成功');
        await loadSettings();
        await loadStats();
      } else {
        showMessage('error', '导入数据失败，请检查文件格式');
      }
    } catch (error) {
      showMessage('error', '导入数据失败');
    }
    
    // 清除文件选择
    event.target.value = '';
  };

  const clearAllData = async () => {
    if (!confirm('确定要清除所有数据吗？此操作不可逆。')) {
      return;
    }

    try {
      await storageManager.clearAllData();
      showMessage('success', '数据清除成功');
      await loadSettings();
      await loadStats();
    } catch (error) {
      showMessage('error', '清除数据失败');
    }
  };

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  if (loading || !settings) {
    return (
      <div className="container">
        <div style={{ textAlign: 'center', padding: '100px' }}>
          <div style={{ fontSize: '14px', color: '#666' }}>加载设置中...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      {/* 头部 */}
      <div className="header">
        <h1>Focuence智序</h1>
        <p>AI驱动的标签页管理与注意力分析工具</p>
      </div>

      {/* 消息提示 */}
      {message && (
        <div style={{
          padding: '12px 16px',
          marginBottom: '24px',
          borderRadius: '6px',
          background: message.type === 'success' ? '#d1fae5' : '#fee2e2',
          color: message.type === 'success' ? '#065f46' : '#991b1b',
          border: `1px solid ${message.type === 'success' ? '#10b981' : '#dc2626'}`
        }}>
          {message.text}
        </div>
      )}

      {/* 数据统计 */}
      <div className="section">
        <div className="section-header">
          <div className="section-title">数据统计</div>
          <div className="section-description">当前插件的使用情况概览</div>
        </div>
        <div className="section-content">
          <div className="stats-grid">
            <div className="stats-card">
              <div className="stats-value">{stats.totalTabs || 0}</div>
              <div className="stats-label">追踪标签页</div>
            </div>
            <div className="stats-card">
              <div className="stats-value">{stats.avgAttention || 0}</div>
              <div className="stats-label">平均注意力</div>
            </div>
            <div className="stats-card">
              <div className="stats-value">{stats.storageUsed || 0}KB</div>
              <div className="stats-label">存储使用</div>
            </div>
          </div>
        </div>
      </div>

      {/* AI设置 */}
      <div className="section">
        <div className="section-header">
          <div className="section-title">AI智能分析</div>
          <div className="section-description">配置AI模型以获得更智能的标签页分组</div>
        </div>
        <div className="section-content">
          <div className="setting-item">
            <div className="setting-info">
              <div className="setting-label">启用AI功能</div>
              <div className="setting-description">使用AI进行语义分组和工作流识别</div>
            </div>
            <div className="setting-control">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={settings.ai.enabled}
                  onChange={(e) => updateAISettings({ enabled: e.target.checked })}
                />
                <span className="toggle-slider"></span>
              </label>
            </div>
          </div>

          {settings.ai.enabled && (
            <div className="ai-config">
              <div className="setting-item">
                <div className="setting-info">
                  <div className="setting-label">AI提供商</div>
                  <div className="setting-description">选择AI服务提供商</div>
                </div>
                <div className="setting-control">
                  <select
                    className="select"
                    value={settings.ai.provider}
                    onChange={(e) => updateAISettings({ 
                      provider: e.target.value as any,
                      model: AIGrouper.getSupportedModels(e.target.value)[0] || ''
                    })}
                  >
                    <option value="custom">自定义API</option>
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="deepseek">DeepSeek</option>
                  </select>
                </div>
              </div>

              <div className="setting-item">
                <div className="setting-info">
                  <div className="setting-label">模型选择</div>
                  <div className="setting-description">选择具体的AI模型</div>
                </div>
                <div className="setting-control">
                  <select
                    className="select"
                    value={settings.ai.model}
                    onChange={(e) => updateAISettings({ model: e.target.value })}
                  >
                    <option value="">选择常用模型</option>
                    <option value="gpt-4o-mini">gpt-4o-mini</option>
                    <option value="gpt-4o">gpt-4o</option>
                    <option value="gpt-3.5-turbo">gpt-3.5-turbo</option>
                    <option value="deepseek-chat">deepseek-chat</option>
                    <option value="gemini-pro">gemini-pro</option>
                    <option value="custom">自定义模型</option>
                  </select>
                  {settings.ai.model === 'custom' && (
                    <input
                      type="text"
                      className="input"
                      placeholder="输入自定义模型名称"
                      value={settings.ai.customModel || ''}
                      onChange={(e) => updateAISettings({ customModel: e.target.value })}
                      style={{ marginTop: '8px' }}
                    />
                  )}
                </div>
              </div>

              {settings.ai.provider === 'custom' && (
                <div className="setting-item">
                  <div className="setting-info">
                    <div className="setting-label">API地址</div>
                    <div className="setting-description">自定义API服务地址</div>
                  </div>
                  <div className="setting-control">
                    <input
                      type="url"
                      className="input"
                      placeholder="https://yunwu.zeabur.app"
                      value={settings.ai.apiUrl}
                      onChange={(e) => updateAISettings({ apiUrl: e.target.value })}
                    />
                  </div>
                </div>
              )}

              <div className="setting-item">
                <div className="setting-info">
                  <div className="setting-label">API密钥</div>
                  <div className="setting-description">输入您的API密钥（本地加密存储）</div>
                </div>
                <div className="setting-control">
                  <div className="api-key-input">
                    <input
                      type="password"
                      className="input"
                      placeholder="输入API密钥"
                      value={settings.ai.apiKey}
                      onChange={(e) => updateAISettings({ apiKey: e.target.value })}
                    />
                    <button
                      className="btn"
                      onClick={testAIConnection}
                      disabled={testingConnection || !settings.ai.apiKey}
                    >
                      {testingConnection ? '测试中...' : '测试连接'}
                    </button>
                  </div>
                  {connectionStatus !== 'idle' && (
                    <div className={`status-indicator status-${connectionStatus}`}>
                      <div className="status-dot"></div>
                      <span>
                        {connectionStatus === 'success' ? '连接正常' : '连接失败'}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 基础设置 */}
      <div className="section">
        <div className="section-header">
          <div className="section-title">基础设置</div>
          <div className="section-description">插件基础功能配置</div>
        </div>
        <div className="section-content">
          <div className="setting-item">
            <div className="setting-info">
              <div className="setting-label">自动分组</div>
              <div className="setting-description">新标签页自动加入合适的分组</div>
            </div>
            <div className="setting-control">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={settings.grouping.autoGrouping}
                  onChange={(e) => updateSettings({
                    grouping: { ...settings.grouping, autoGrouping: e.target.checked }
                  })}
                />
                <span className="toggle-slider"></span>
              </label>
            </div>
          </div>

          <div className="setting-item">
            <div className="setting-info">
              <div className="setting-label">注意力跟踪</div>
              <div className="setting-description">记录标签页使用行为用于智能分析</div>
            </div>
            <div className="setting-control">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={settings.attention.trackingEnabled}
                  onChange={(e) => updateSettings({
                    attention: { ...settings.attention, trackingEnabled: e.target.checked }
                  })}
                />
                <span className="toggle-slider"></span>
              </label>
            </div>
          </div>

          <div className="setting-item">
            <div className="setting-info">
              <div className="setting-label">显示注意力分数</div>
              <div className="setting-description">在界面中显示标签页注意力评分</div>
            </div>
            <div className="setting-control">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={settings.ui.showScores}
                  onChange={(e) => updateSettings({
                    ui: { ...settings.ui, showScores: e.target.checked }
                  })}
                />
                <span className="toggle-slider"></span>
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* 数据管理 */}
      <div className="section">
        <div className="section-header">
          <div className="section-title">数据管理</div>
          <div className="section-description">备份、导入或清除数据</div>
        </div>
        <div className="section-content">
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button className="btn" onClick={exportData}>
              导出数据
            </button>
            <label className="btn" style={{ cursor: 'pointer' }}>
              导入数据
              <input
                type="file"
                accept=".json"
                onChange={importData}
                style={{ display: 'none' }}
              />
            </label>
            <button className="btn btn-danger" onClick={clearAllData}>
              清除所有数据
            </button>
          </div>
        </div>
      </div>

      {/* 保存按钮 */}
      <div style={{ textAlign: 'center', marginTop: '40px' }}>
        <button
          className="btn btn-primary"
          onClick={saveSettings}
          disabled={saving}
          style={{ padding: '12px 32px', fontSize: '16px' }}
        >
          {saving ? '保存中...' : '保存设置'}
        </button>
      </div>
    </div>
  );
};