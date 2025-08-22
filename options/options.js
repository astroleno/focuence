// 设置页面的JavaScript实现
const settingsApp = {
    data: {
        settings: {
            apiEndpoint: 'https://yunwu.zeabur.app',
            model: 'gpt-4o-mini',
            apiKey: '',
            autoGrouping: false,
            cleaningSuggestions: true
        },
        testing: false,
        statusMessage: '',
        statusType: ''
    },
    
    async mounted() {
        await this.loadSettings();
        this.bindEvents();
    },
    
    async loadSettings() {
        try {
            const result = await chrome.storage.sync.get(['settings']);
            if (result.settings) {
                this.data.settings = { ...this.data.settings, ...result.settings };
            }
            this.updateForm();
        } catch (error) {
            console.error('加载设置失败:', error);
            this.showStatus('加载设置失败', 'error');
        }
    },
    
    async saveSettings() {
        try {
            // 从表单获取数据
            this.data.settings.apiEndpoint = document.getElementById('apiEndpoint').value;
            this.data.settings.model = document.getElementById('model').value;
            this.data.settings.apiKey = document.getElementById('apiKey').value;
            this.data.settings.autoGrouping = document.getElementById('autoGrouping').checked;
            this.data.settings.cleaningSuggestions = document.getElementById('cleaningSuggestions').checked;
            
            await chrome.storage.sync.set({ settings: this.data.settings });
            this.showStatus('设置已保存', 'success');
        } catch (error) {
            console.error('保存设置失败:', error);
            this.showStatus('保存设置失败', 'error');
        }
    },
    
    resetSettings() {
        this.data.settings = {
            apiEndpoint: 'https://yunwu.zeabur.app',
            model: 'chatgpt-4o-mini',
            apiKey: '',
            autoGrouping: false,
            cleaningSuggestions: true
        };
        this.updateForm();
        this.showStatus('设置已重置', 'success');
    },
    
    async testAPI() {
        if (this.data.testing) return;
        
        this.data.testing = true;
        this.showStatus('正在测试API连接...', 'success');
        this.updateTestButton();
        
        try {
            // 从表单获取当前设置
            const apiEndpoint = document.getElementById('apiEndpoint').value;
            const model = document.getElementById('model').value;
            const apiKey = document.getElementById('apiKey').value;
            
            const response = await fetch(`${apiEndpoint}/v1/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: model,
                    messages: [
                        {
                            role: 'user',
                            content: 'Hello, this is a test message.'
                        }
                    ],
                    max_tokens: 10
                })
            });
            
            if (response.ok) {
                const data = await response.json();
                this.showStatus('API连接测试成功！', 'success');
            } else {
                const error = await response.text();
                this.showStatus('API连接失败: ' + error, 'error');
            }
        } catch (error) {
            console.error('API测试失败:', error);
            this.showStatus('API连接失败: ' + error.message, 'error');
        } finally {
            this.data.testing = false;
            this.updateTestButton();
        }
    },
    
    updateForm() {
        document.getElementById('apiEndpoint').value = this.data.settings.apiEndpoint;
        document.getElementById('model').value = this.data.settings.model;
        document.getElementById('apiKey').value = this.data.settings.apiKey;
        document.getElementById('autoGrouping').checked = this.data.settings.autoGrouping;
        document.getElementById('cleaningSuggestions').checked = this.data.settings.cleaningSuggestions;
    },
    
    updateTestButton() {
        const testBtn = document.getElementById('testBtn');
        if (testBtn) {
            testBtn.disabled = this.data.testing;
            testBtn.textContent = this.data.testing ? '测试中...' : '测试连接';
        }
    },
    
    showStatus(message, type) {
        this.data.statusMessage = message;
        this.data.statusType = type;
        
        // 清除之前的定时器
        if (this.data.statusTimer) {
            clearTimeout(this.data.statusTimer);
        }
        
        // 创建或更新状态消息
        let statusDiv = document.getElementById('statusMessage');
        if (!statusDiv) {
            statusDiv = document.createElement('div');
            statusDiv.id = 'statusMessage';
            document.querySelector('.section').appendChild(statusDiv);
        }
        
        statusDiv.textContent = message;
        statusDiv.className = `status-message ${type}`;
        
        // 3秒后清除消息
        this.data.statusTimer = setTimeout(() => {
            if (statusDiv && statusDiv.parentNode) {
                statusDiv.parentNode.removeChild(statusDiv);
            }
            this.data.statusMessage = '';
            this.data.statusType = '';
        }, 3000);
    },
    
    bindEvents() {
        // 绑定事件
        document.querySelector('.close-btn').addEventListener('click', () => {
            window.close();
        });
        
        document.getElementById('saveBtn').addEventListener('click', () => {
            this.saveSettings();
        });
        
        document.getElementById('resetBtn').addEventListener('click', () => {
            this.resetSettings();
        });
        
        document.getElementById('testBtn').addEventListener('click', () => {
            this.testAPI();
        });
    }
};

// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
    settingsApp.mounted();
});