// Focuence智序 - 设置页面
class SettingsApp {
    constructor() {
        this.settings = {
            apiEndpoint: 'https://yunwu.zeabur.app',
            model: 'gpt-4o-mini',
            apiKey: '',
            theme: 'system', // 固定为系统主题
            workMode: 'casual',
            autoModeSwitch: false,
            timeBasedMode: false
        };
        
        this.initialize();
    }

    async initialize() {
        console.log('初始化设置页面...');
        try {
            await this.loadSettings();
            this.initializeTheme();
            this.bindEvents();
            this.updateUI();
            console.log('设置页面初始化完成');
        } catch (error) {
            console.error('设置页面初始化失败:', error);
        }
    }

    // 设置管理
    async loadSettings() {
        try {
            const result = await chrome.storage.sync.get(['settings']);
            if (result.settings) {
                this.settings = { ...this.settings, ...result.settings };
            }
            console.log('已加载设置:', this.settings);
        } catch (error) {
            console.error('加载设置失败:', error);
        }
    }

    async saveSettings() {
        try {
            await chrome.storage.sync.set({ settings: this.settings });
            this.showStatus('设置已保存', 'success');
            console.log('设置已保存:', this.settings);
        } catch (error) {
            console.error('保存设置失败:', error);
            this.showStatus('保存失败', 'error');
        }
    }

    async resetSettings() {
        if (!confirm('确定要重置所有设置为默认值吗？')) return;
        
        const defaultSettings = {
            apiEndpoint: 'https://yunwu.zeabur.app',
            model: 'gpt-4o-mini',
            apiKey: '',
            theme: 'system', // 固定为系统主题
            workMode: 'casual',
            autoModeSwitch: false,
            timeBasedMode: false
        };
        
        this.settings = defaultSettings;
        await this.saveSettings();
        this.updateUI();
        this.showStatus('设置已重置为默认值', 'success');
    }

    // 主题管理
    initializeTheme() {
        const applyTheme = (theme) => {
            document.body.classList.remove('dark', 'light');
            
            if (theme === 'system') {
                if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
                    document.body.classList.add('dark');
                }
            } else if (theme === 'dark') {
                document.body.classList.add('dark');
            }
        };

        applyTheme(this.settings.theme);
        
        // 监听系统主题变化
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
            if (this.settings.theme === 'system') {
                applyTheme('system');
            }
        });
    }

    // 事件绑定
    bindEvents() {
        // 主题已固定为跟随系统，无需绑定事件
        
        // 关闭按钮
        document.querySelector('.close-btn').addEventListener('click', () => {
            window.close();
        });

        // 保存按钮
        document.getElementById('saveBtn').addEventListener('click', () => {
            this.collectFormData();
            this.saveSettings();
        });

        // 重置按钮
        document.getElementById('resetBtn').addEventListener('click', () => {
            this.resetSettings();
        });

        // 测试连接按钮
        document.getElementById('testBtn').addEventListener('click', () => {
            this.testConnection();
        });

        // 快捷键按钮
        document.getElementById('shortcutsBtn').addEventListener('click', () => {
            chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
        });

        // 工作模式设置
        document.getElementById('workMode').addEventListener('change', (e) => {
            this.settings.workMode = e.target.value;
            this.markAsChanged();
        });

        document.getElementById('autoModeSwitch').addEventListener('change', (e) => {
            this.settings.autoModeSwitch = e.target.checked;
            this.markAsChanged();
        });

        document.getElementById('timeBasedMode').addEventListener('change', (e) => {
            this.settings.timeBasedMode = e.target.checked;
            this.markAsChanged();
        });

        // 输入框变化监听
        ['apiEndpoint', 'model', 'apiKey'].forEach(id => {
            document.getElementById(id).addEventListener('input', () => {
                this.markAsChanged();
            });
        });
    }

    // 更新UI
    updateUI() {
        document.getElementById('apiEndpoint').value = this.settings.apiEndpoint || '';
        document.getElementById('model').value = this.settings.model || 'gpt-4o-mini';
        document.getElementById('apiKey').value = this.settings.apiKey || '';
        // 主题固定为跟随系统，无需更新UI
        document.getElementById('workMode').value = this.settings.workMode || 'casual';
        document.getElementById('autoModeSwitch').checked = this.settings.autoModeSwitch || false;
        document.getElementById('timeBasedMode').checked = this.settings.timeBasedMode || false;
    }

    // 收集表单数据
    collectFormData() {
        this.settings.apiEndpoint = document.getElementById('apiEndpoint').value.trim();
        this.settings.model = document.getElementById('model').value;
        this.settings.apiKey = document.getElementById('apiKey').value.trim();
        // 主题固定为跟随系统
        this.settings.theme = 'system';
        this.settings.workMode = document.getElementById('workMode').value;
        this.settings.autoModeSwitch = document.getElementById('autoModeSwitch').checked;
        this.settings.timeBasedMode = document.getElementById('timeBasedMode').checked;
    }

    // 标记为已更改
    markAsChanged() {
        const saveBtn = document.getElementById('saveBtn');
        if (saveBtn && !saveBtn.textContent.includes('*')) {
            saveBtn.textContent = '保存设置 *';
        }
    }

    // 测试连接
    async testConnection() {
        const testBtn = document.getElementById('testBtn');
        const originalText = testBtn.textContent;
        
        // 收集当前表单数据
        this.collectFormData();
        
        if (!this.settings.apiEndpoint) {
            this.showStatus('请填写API端点', 'error');
            return;
        }
        
        if (!this.settings.apiKey) {
            this.showStatus('请填写API密钥', 'error');
            return;
        }

        testBtn.textContent = '测试中...';
        testBtn.disabled = true;

        try {
            const response = await fetch(`${this.settings.apiEndpoint}/v1/models`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.settings.apiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                this.showStatus('连接测试成功！', 'success');
            } else {
                const errorData = await response.json().catch(() => ({}));
                this.showStatus(`连接测试失败: ${errorData.error?.message || response.statusText}`, 'error');
            }
        } catch (error) {
            console.error('连接测试错误:', error);
            this.showStatus(`连接测试失败: ${error.message}`, 'error');
        } finally {
            testBtn.textContent = originalText;
            testBtn.disabled = false;
        }
    }

    // 显示状态消息
    showStatus(message, type = 'info') {
        const statusDiv = document.getElementById('statusMessage');
        if (!statusDiv) return;

        statusDiv.textContent = message;
        statusDiv.className = `status-message status-${type}`;
        statusDiv.style.display = 'block';

        // 3秒后自动隐藏
        setTimeout(() => {
            statusDiv.style.display = 'none';
        }, 3000);
    }

    // 工具函数
    truncateText(text, maxLength) {
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength - 3) + '...';
    }
}

// 初始化应用
let settingsApp;
document.addEventListener('DOMContentLoaded', () => {
    settingsApp = new SettingsApp();
});

// 全局错误处理
window.addEventListener('error', (event) => {
    console.error('设置页面错误:', event.error);
});