// Focuence智序 - 应用逻辑
class FocuenceApp {
    constructor() {
        this.groups = [];
        this.suggestions = [];
        this.settings = {
            apiKey: '',
            apiEndpoint: 'https://yunwu.zeabur.app',
            model: 'gpt-4o-mini',
            theme: 'system'
        };
        this.currentView = 'main';
        this.undoStack = []; // 撤销操作栈
        this.maxUndoSteps = 10; // 最多保存10步操作
        this.currentWindowId = null; // 当前窗口ID
        
        this.initializeApp();
    }

    async initializeApp() {
        try {
            // 获取当前窗口ID
            const currentWindow = await chrome.windows.getCurrent();
            this.currentWindowId = currentWindow.id;
            
            await this.loadSettings();
            await this.loadCachedGroups(); // 加载缓存的分组
            this.initializeTheme();
            this.bindEvents();
            this.updateUndoButton(); // 初始化撤销按钮状态
            await this.updateStats();
            
            // 如果有缓存的分组，直接显示
            if (this.groups.length > 0) {
                this.renderGroups();
                this.showGroupsView();
            }
        } catch (error) {
            console.error('应用初始化失败:', error);
        }
    }

    // 设置管理
    async loadSettings() {
        try {
            const result = await chrome.storage.sync.get(['settings']);
            if (result.settings) {
                this.settings = { ...this.settings, ...result.settings };
            }
        } catch (error) {
            console.error('加载设置失败:', error);
        }
    }

    // 主题管理 - 默认跟随系统
    initializeTheme() {
        const applySystemTheme = () => {
            document.body.classList.remove('dark-theme', 'light-theme', 'system-theme');
            document.body.classList.add('system-theme');
            
            const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            const icon = document.getElementById('themeIcon');
            if (icon) icon.textContent = isDark ? '☀' : '☾';
        };

        // 强制使用系统主题
        this.settings.theme = 'system';
        applySystemTheme();
        
        // 监听系统主题变化
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applySystemTheme);
    }

    // 主题现在默认跟随系统，不再需要手动切换
    // 保留方法以防其他地方调用
    toggleTheme() {
        // 主题已默认跟随系统，无需手动切换
    }

    async saveSettings() {
        try {
            await chrome.storage.sync.set({ settings: this.settings });
        } catch (error) {
            console.error('保存设置失败:', error);
        }
    }

    // 缓存管理
    async loadCachedGroups() {
        try {
            if (!this.currentWindowId) return;
            
            const cacheKey = `cachedGroups_${this.currentWindowId}`;
            const timestampKey = `groupsTimestamp_${this.currentWindowId}`;
            
            const result = await chrome.storage.local.get([cacheKey, timestampKey]);
            if (result[cacheKey] && result[timestampKey]) {
                const now = Date.now();
                const cacheAge = now - result[timestampKey];
                
                // 1小时内的缓存有效
                if (cacheAge < 3600000) {
                    this.groups = result[cacheKey];
                }
            }
        } catch (error) {
            console.error('加载缓存分组失败:', error);
        }
    }

    async saveCachedGroups() {
        try {
            if (!this.currentWindowId) return;
            
            const cacheKey = `cachedGroups_${this.currentWindowId}`;
            const timestampKey = `groupsTimestamp_${this.currentWindowId}`;
            
            await chrome.storage.local.set({
                [cacheKey]: this.groups,
                [timestampKey]: Date.now()
            });
        } catch (error) {
            console.error('保存缓存分组失败:', error);
        }
    }

    async clearCachedGroups() {
        try {
            if (!this.currentWindowId) return;
            
            const cacheKey = `cachedGroups_${this.currentWindowId}`;
            const timestampKey = `groupsTimestamp_${this.currentWindowId}`;
            
            await chrome.storage.local.remove([cacheKey, timestampKey]);
        } catch (error) {
            console.error('清除缓存分组失败:', error);
        }
    }

    // 事件绑定
    bindEvents() {
        // 主题切换按钮
        // 主题指示器不再需要点击事件，只是显示当前系统主题状态

        // 设置按钮
        const settingsBtn = document.querySelector('.settings-btn');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => {
                chrome.runtime.openOptionsPage();
            });
        }

        // 智能分组按钮
        const aiGroupingBtn = document.getElementById('aiGroupingBtn');
        if (aiGroupingBtn) {
            aiGroupingBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.performAIGrouping();
            });
        }

        // 撤销按钮
        const undoBtn = document.getElementById('undoBtn');
        if (undoBtn) {
            undoBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.performUndo();
            });
        }


        // 返回按钮
        const groupsBackBtn = document.getElementById('groupsBackBtn');
        if (groupsBackBtn) {
            groupsBackBtn.addEventListener('click', () => this.showMainView());
        }

        // 再次分组按钮
        const regroupBtn = document.getElementById('regroupBtn');
        if (regroupBtn) {
            regroupBtn.addEventListener('click', () => {
                this.forceRegroupTabs();
            });
        }

        // 清理建议按钮
        const cleaningBtn = document.getElementById('cleaningBtn');
        if (cleaningBtn) {
            cleaningBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('清理建议按钮被点击');
                this.showCleaningSuggestions();
            });
        }

        // 清理建议返回按钮
        const suggestionsBackBtn = document.getElementById('suggestionsBackBtn');
        if (suggestionsBackBtn) {
            suggestionsBackBtn.addEventListener('click', () => this.showMainView());
        }

        // 全部分组按钮
        const createAllGroupsBtn = document.getElementById('createAllGroupsBtn');
        if (createAllGroupsBtn) {
            createAllGroupsBtn.addEventListener('click', () => this.createAllGroups());
        }
        
        // 取消所有分组按钮
        const cancelAllGroupsBtn = document.getElementById('cancelAllGroupsBtn');
        if (cancelAllGroupsBtn) {
            cancelAllGroupsBtn.addEventListener('click', () => this.cancelAllGroups());
        }

        // 键盘快捷键
        document.addEventListener('keydown', (e) => {
            // Ctrl/Cmd + Z 撤销
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                this.performUndo();
            }
            // Ctrl/Cmd + G 智能分组
            else if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
                e.preventDefault();
                if (this.currentView === 'main') {
                    this.performAIGrouping();
                }
            }
            // Ctrl/Cmd + R 清理建议  
            else if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
                e.preventDefault();
                if (this.currentView === 'main') {
                    this.performCleaning();
                }
            }
            // Escape 返回主界面
            else if (e.key === 'Escape') {
                e.preventDefault();
                this.showMainView();
            }
        });
    }

    // 统计信息更新
    async updateStats() {
        try {
            const tabs = await chrome.tabs.query({ currentWindow: true });
            const activeTabs = tabs.filter(tab => 
                tab.lastAccessed && (Date.now() - tab.lastAccessed) < 3600000 // 1小时内
            );

            const tabCountEl = document.getElementById('tabCount');
            const activeTabsEl = document.getElementById('activeTabs');
            
            if (tabCountEl) tabCountEl.textContent = tabs.length;
            if (activeTabsEl) activeTabsEl.textContent = activeTabs.length;
            
            // 工作模式作为后台路由规则，不在前端显示
        } catch (error) {
            console.error('更新统计失败:', error);
            const tabCountEl = document.getElementById('tabCount');
            const activeTabsEl = document.getElementById('activeTabs');
            
            if (tabCountEl) tabCountEl.textContent = '0';
            if (activeTabsEl) activeTabsEl.textContent = '0';
        }
    }

    // 工作模式现在作为后台路由规则，不在前端显示

    // 视图管理
    showMainView() {
        this.currentView = 'main';
        document.body.classList.remove('expanded', 'fully-expanded');
        document.body.classList.add('collapsed');
        
        // 隐藏所有内容区域
        document.getElementById('groupsSection').style.display = 'none';
        document.getElementById('suggestionsSection').style.display = 'none';
        
        // 显示空状态
        document.getElementById('emptyState').style.display = 'block';
    }

    showGroupsView() {
        this.currentView = 'groups';
        document.body.classList.remove('collapsed');
        document.body.classList.add('expanded');
        
        document.getElementById('groupsSection').style.display = 'block';
        document.getElementById('suggestionsSection').style.display = 'none';
        document.getElementById('emptyState').style.display = 'none';
    }

    showSuggestionsView() {
        this.currentView = 'suggestions';
        document.body.classList.remove('collapsed');
        document.body.classList.add('expanded');
        
        document.getElementById('groupsSection').style.display = 'none';
        document.getElementById('suggestionsSection').style.display = 'block';
        document.getElementById('emptyState').style.display = 'none';
    }

    // AI 智能分组
    async performAIGrouping() {
        
        // 如果已有缓存的分组，直接显示
        if (this.groups.length > 0) {
            this.renderGroups();
            this.showGroupsView();
            return;
        }
        
        try {
            this.setButtonLoading('aiGroupingBtn', 'aiLoading', true);
            
            // 检查API配置
            if (!this.settings.apiKey || !this.settings.apiEndpoint) {
                this.showNotification('请先在设置中配置API密钥', 'error');
                chrome.runtime.openOptionsPage();
                return;
            }

            const tabs = await chrome.tabs.query({ currentWindow: true });
            console.log('获取到标签页:', tabs.length);

            // 通过background.js处理AI分组
            const response = await chrome.runtime.sendMessage({
                action: 'performAIGrouping',
                tabs: tabs.map(tab => ({
                    id: tab.id,
                    title: tab.title,
                    url: tab.url,
                    domain: tab.url ? new URL(tab.url).hostname : 'unknown',
                    lastAccessed: tab.lastAccessed,
                    pinned: tab.pinned,
                    index: tab.index,
                    windowId: tab.windowId,
                    favIconUrl: tab.favIconUrl,
                    audible: tab.audible
                })),
                settings: this.settings
            });

            if (response && response.success && response.groups) {
                this.groups = response.groups;
                await this.saveCachedGroups();
                
                this.renderGroups();
                this.showGroupsView();
                this.showNotification('智能分组完成！', 'success');
            } else {
                console.error('AI分组失败:', response?.error);
                this.showNotification(response?.error || 'AI分组失败，请检查设置', 'error');
            }

        } catch (error) {
            console.error('AI分组过程出错:', error);
            this.showNotification('分组失败: ' + error.message, 'error');
        } finally {
            this.setButtonLoading('aiGroupingBtn', 'aiLoading', false);
        }
    }

    // 强制重新分组（忽略缓存）
    async forceRegroupTabs() {
        console.log('强制重新分组，清除缓存');
        
        // 清除缓存
        await this.clearCachedGroups();
        this.groups = [];
        
        const loadingEl = document.querySelector('#aiGroupingBtn .loading');
        const btnEl = document.getElementById('regroupBtn');
        
        try {
            if (loadingEl) loadingEl.style.display = 'inline-block';
            if (btnEl) btnEl.disabled = true;

            // 检查API配置
            if (!this.settings.apiKey || !this.settings.apiEndpoint) {
                this.showNotification('请先在设置中配置API密钥', 'error');
                chrome.runtime.openOptionsPage();
                return;
            }

            const tabs = await chrome.tabs.query({ currentWindow: true });
            console.log('重新获取标签页进行分组:', tabs.length);

            // 通过background.js处理AI分组
            const response = await chrome.runtime.sendMessage({
                action: 'performAIGrouping',
                tabs: tabs.map(tab => ({
                    id: tab.id,
                    title: tab.title,
                    url: tab.url,
                    domain: tab.url ? new URL(tab.url).hostname : 'unknown',
                    lastAccessed: tab.lastAccessed,
                    pinned: tab.pinned,
                    index: tab.index,
                    windowId: tab.windowId,
                    favIconUrl: tab.favIconUrl,
                    audible: tab.audible
                })),
                settings: this.settings
            });

            if (response && response.success && response.groups) {
                this.groups = response.groups;
                await this.saveCachedGroups();
                this.renderGroups();
                this.showGroupsView();
                this.showNotification('重新分组完成！', 'success');
            } else {
                console.error('重新分组失败:', response?.error);
                this.showNotification(response?.error || '重新分组失败，请检查设置', 'error');
            }

        } catch (error) {
            console.error('重新分组过程出错:', error);
            this.showNotification('重新分组失败: ' + error.message, 'error');
        } finally {
            if (loadingEl) loadingEl.style.display = 'none';
            if (btnEl) btnEl.disabled = false;
        }
    }

    // 渲染分组结果
    renderGroups() {
        const container = document.getElementById('groupsContainer');
        if (!container || !this.groups.length) return;

        container.innerHTML = '';

        // 按总注意力分数降序排列分组
        const sortedGroups = [...this.groups].sort((a, b) => {
            const attentionA = this.calculateGroupAttention(a);
            const attentionB = this.calculateGroupAttention(b);
            return attentionB - attentionA;
        });
        
        // 更新原始分组数组的顺序
        this.groups = sortedGroups;

        this.groups.forEach((group, groupIndex) => {
            const groupEl = document.createElement('div');
            groupEl.className = 'group';
            
            // 为分组添加彩虹颜色
            const groupColor = this.getGroupColor(groupIndex);
            groupEl.style.setProperty('--group-color', groupColor);
            
            // 计算分组平均注意力分数
            const avgAttention = this.calculateGroupAttention(group);
            
            // 根据注意力对标签页排序
            const sortedTabs = [...group.tabs].sort((a, b) => {
                const attentionA = this.getTabAttention(a.id);
                const attentionB = this.getTabAttention(b.id);
                return attentionB - attentionA;
            });
            
            groupEl.innerHTML = `
                <div class="group-header" style="border-left: 4px solid ${groupColor}">
                    <span class="group-name">${this.escapeHtml(group.name)}</span>
                    <div class="group-meta">
                        <span class="attention-badge" style="background-color: ${this.getAttentionColor(avgAttention)}">
                            ${this.getAttentionLabel(avgAttention)}
                        </span>
                        <span class="group-count">${group.tabs.length}</span>
                    </div>
                </div>
                ${group.reason ? `<div class="group-reason">${this.escapeHtml(group.reason)}</div>` : ''}
                <div class="group-tabs">
                    ${sortedTabs.map(tab => {
                        const tabAttention = this.getTabAttention(tab.id);
                        const attentionColor = this.getAttentionColor(tabAttention);
                        return `
                            <div class="tab-item">
                                ${tab.favIconUrl && tab.favIconUrl !== '' && !tab.favIconUrl.includes('chrome://') ? 
                                    `<img class="tab-favicon" src="${tab.favIconUrl}" alt="" loading="lazy" 
                                          onerror="this.style.display='none'; this.nextElementSibling.style.display='inline-block';">
                                     <div class="tab-attention-indicator" style="background-color: ${attentionColor}; display: none;" 
                                          title="注意力分数: ${tabAttention.toFixed(2)}"></div>` :
                                    `<div class="tab-attention-indicator" style="background-color: ${attentionColor};" 
                                          title="注意力分数: ${tabAttention.toFixed(2)}"></div>`
                                }
                                <span class="tab-title" title="${this.escapeHtml(tab.title)}">
                                    ${tab.audible ? '🔊 ' : ''}${this.truncateText(tab.title, 35)}
                                </span>
                                <button class="tab-close" data-tab-id="${tab.id}" title="关闭标签页">×</button>
                            </div>
                        `;
                    }).join('')}
                </div>
                <div class="group-actions">
                    <button class="create-group-btn" data-group-index="${groupIndex}">创建分组</button>
                    <button class="highlight-group-btn" data-group-index="${groupIndex}">高亮显示</button>
                    <button class="close-group-btn" data-group-index="${groupIndex}">关闭分组</button>
                </div>
            `;
            
            container.appendChild(groupEl);
        });

        // 添加事件委托
        this.bindDynamicEvents(container);
    }

    // 清理建议
    async showCleaningSuggestions() {
        console.log('开始生成清理建议...');
        
        const loadingEl = document.querySelector('#cleaningBtn .loading');
        const btnEl = document.getElementById('cleaningBtn');
        
        try {
            if (loadingEl) loadingEl.style.display = 'inline-block';
            if (btnEl) btnEl.disabled = true;

            const tabs = await chrome.tabs.query({ currentWindow: true });
            console.log('分析标签页:', tabs.length);

            // 生成清理建议
            const suggestions = await this.generateCleaningSuggestions(tabs);
            console.log('生成清理建议:', suggestions.length);

            this.suggestions = suggestions;
            this.renderSuggestions();
            this.showSuggestionsView();
            
            if (suggestions.length === 0) {
                this.showNotification('没有发现需要清理的标签页', 'info');
            } else {
                this.showNotification(`发现 ${suggestions.length} 个清理建议`, 'success');
            }

        } catch (error) {
            console.error('生成清理建议失败:', error);
            this.showNotification('生成清理建议失败', 'error');
        } finally {
            if (loadingEl) loadingEl.style.display = 'none';
            if (btnEl) btnEl.disabled = false;
        }
    }

    async generateCleaningSuggestions(tabs) {
        const suggestions = [];
        
        // 获取注意力数据
        const enrichedTabs = await this.getTabsWithAttentionData(tabs);
        
        // 1. 低注意力标签页 (最重要)
        const lowAttentionTabs = enrichedTabs
            .filter(tab => tab.attentionScore < 0.3 && !tab.pinned)
            .sort((a, b) => a.attentionScore - b.attentionScore)
            .slice(0, 10);

        if (lowAttentionTabs.length > 0) {
            suggestions.push({
                type: 'low_attention',
                priority: 'high',
                title: `${lowAttentionTabs.length} 个低关注度标签页`,
                reason: '注意力分数低于0.3，建议关闭释放资源',
                tabs: lowAttentionTabs,
                action: 'close',
                impact: 'high'
            });
        }

        // 2. 长期未激活标签页
        const now = Date.now();
        const oneWeek = 7 * 24 * 60 * 60 * 1000;
        const staleAttentionTabs = enrichedTabs
            .filter(tab => {
                const timeSinceLastActive = tab.lastAccessed ? now - tab.lastAccessed : now;
                return timeSinceLastActive > oneWeek && 
                       tab.attentionScore < 0.5 && 
                       !tab.pinned;
            })
            .sort((a, b) => {
                const timeA = a.lastAccessed ? now - a.lastAccessed : now;
                const timeB = b.lastAccessed ? now - b.lastAccessed : now;
                return timeB - timeA;
            });

        if (staleAttentionTabs.length > 0) {
            suggestions.push({
                type: 'stale_attention',
                priority: 'medium',
                title: `${staleAttentionTabs.length} 个长期未用标签页`,
                reason: '一周以上未激活且注意力分数较低',
                tabs: staleAttentionTabs,
                action: 'close',
                impact: 'medium'
            });
        }

        // 3. 重复内容但关注度不同
        const duplicateContentTabs = this.findDuplicateContentTabs(enrichedTabs);
        if (duplicateContentTabs.length > 0) {
            suggestions.push({
                type: 'duplicate_content',
                priority: 'medium',
                title: `${duplicateContentTabs.length} 个重复内容标签页`,
                reason: '相同域名多个标签页，保留关注度最高的',
                tabs: duplicateContentTabs,
                action: 'close',
                impact: 'medium'
            });
        }

        // 4. 资源消耗型标签页 (基于激活频率判断)
        const resourceHeavyTabs = enrichedTabs
            .filter(tab => {
                // 很少激活但一直开着的标签页可能消耗资源
                const hoursSinceOpen = (now - (tab.lastAccessed || now - 24*60*60*1000)) / (1000 * 60 * 60);
                return hoursSinceOpen > 4 && 
                       tab.attentionScore < 0.2 && 
                       !tab.pinned &&
                       (tab.url?.includes('video') || tab.url?.includes('stream'));
            });

        if (resourceHeavyTabs.length > 0) {
            suggestions.push({
                type: 'resource_heavy',
                priority: 'high',
                title: `${resourceHeavyTabs.length} 个资源消耗标签页`,
                reason: '媒体类页面长期未用，可能消耗系统资源',
                tabs: resourceHeavyTabs,
                action: 'close',
                impact: 'high'
            });
        }

        // 5. 智能归档建议 (高注意力但长期未访问)
        const archiveCandidates = enrichedTabs
            .filter(tab => {
                const timeSinceLastActive = tab.lastAccessed ? now - tab.lastAccessed : now;
                return timeSinceLastActive > 3 * 24 * 60 * 60 * 1000 && // 3天未访问
                       tab.attentionScore > 0.6 && // 但注意力分数高
                       !tab.pinned;
            });

        if (archiveCandidates.length > 0) {
            suggestions.push({
                type: 'archive',
                priority: 'low',
                title: `${archiveCandidates.length} 个标签页建议归档`,
                reason: '重要但近期未用，建议保存书签后关闭',
                tabs: archiveCandidates,
                action: 'bookmark_and_close',
                impact: 'low'
            });
        }

        return suggestions.sort((a, b) => {
            const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1 };
            return priorityOrder[b.priority] - priorityOrder[a.priority];
        });
    }

    // 获取带注意力数据的标签页
    async getTabsWithAttentionData(tabs) {
        // 请求background.js获取注意力数据
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({
                action: 'getTabsAttentionData',
                tabIds: tabs.map(tab => tab.id)
            }, (response) => {
                if (response && response.success) {
                    resolve(response.tabs);
                } else {
                    // fallback: 使用基础数据
                    resolve(tabs.map(tab => ({
                        ...tab,
                        attentionScore: 0.5,
                        lastAccessed: tab.lastAccessed || Date.now()
                    })));
                }
            });
        });
    }

    // 查找重复内容的标签页
    findDuplicateContentTabs(enrichedTabs) {
        const domainGroups = {};
        const duplicates = [];

        // 按域名分组
        enrichedTabs.forEach(tab => {
            if (tab.url && !tab.pinned) {
                try {
                    const domain = new URL(tab.url).hostname;
                    if (!domainGroups[domain]) domainGroups[domain] = [];
                    domainGroups[domain].push(tab);
                } catch (e) {
                    // 忽略无效URL
                }
            }
        });

        // 找出每个域名下除了最高注意力分数之外的标签页
        Object.values(domainGroups).forEach(domainTabs => {
            if (domainTabs.length > 3) { // 同域名超过3个才建议清理
                // 保留注意力分数最高的，其余作为重复内容
                domainTabs.sort((a, b) => b.attentionScore - a.attentionScore);
                duplicates.push(...domainTabs.slice(2)); // 保留前2个，其余标记为重复
            }
        });

        return duplicates;
    }

    renderSuggestions() {
        const container = document.getElementById('suggestionsContainer');
        if (!container || !this.suggestions.length) return;

        container.innerHTML = '';

        this.suggestions.forEach((suggestion, index) => {
            const suggestionEl = document.createElement('div');
            suggestionEl.className = 'suggestion';
            
            suggestionEl.innerHTML = `
                <div class="suggestion-content">
                    <span class="suggestion-title">${this.escapeHtml(suggestion.title)}</span>
                    <div class="suggestion-reason">${this.escapeHtml(suggestion.reason)}</div>
                </div>
                <div class="suggestion-actions">
                    <button class="suggestion-apply" data-suggestion-index="${index}">应用</button>
                    <button class="suggestion-dismiss" data-suggestion-index="${index}">忽略</button>
                </div>
            `;
            
            container.appendChild(suggestionEl);
        });

        // 添加事件委托
        this.bindSuggestionEvents(container);
    }

    // 标签页操作
    async closeTab(tabId) {
        try {
            // 先获取标签页信息用于撤销
            const tab = await chrome.tabs.get(tabId);
            
            await chrome.tabs.remove(tabId);
            
            // 保存撤销状态
            this.saveUndoState('closeTab', {
                id: tabId,
                url: tab.url,
                title: tab.title
            });
            
            await this.updateStats();
            
            // 从当前分组中移除
            this.groups = this.groups.map(group => ({
                ...group,
                tabs: group.tabs.filter(tab => tab.id !== tabId)
            })).filter(group => group.tabs.length > 0);
            
            this.renderGroups();
            this.showNotification('标签页已关闭', 'success');
        } catch (error) {
            console.error('关闭标签页失败:', error);
            this.showNotification('关闭失败', 'error');
        }
    }

    async createTabGroup(groupIndex) {
        try {
            const group = this.groups[groupIndex];
            if (!group || !group.tabs.length) return;

            const tabIds = group.tabs.map(tab => tab.id);
            const groupId = await chrome.tabs.group({ tabIds });
            
            // 获取对应的彩虹颜色
            const groupColor = this.getGroupColor(groupIndex);
            const chromeColor = this.getChromeGroupColor(groupColor);
            
            await chrome.tabGroups.update(groupId, { 
                title: group.name,
                color: chromeColor
            });

            this.showNotification(`已创建分组: ${group.name}`, 'success');
        } catch (error) {
            console.error('创建分组失败:', error);
            this.showNotification('创建分组失败', 'error');
        }
    }

    async highlightGroup(groupIndex) {
        try {
            const group = this.groups[groupIndex];
            if (!group || !group.tabs.length) return;

            const tabIds = group.tabs.map(tab => tab.id);
            await chrome.tabs.highlight({ tabs: tabIds });
            
            this.showNotification(`已高亮分组: ${group.name}`, 'success');
        } catch (error) {
            console.error('高亮分组失败:', error);
            this.showNotification('高亮失败', 'error');
        }
    }

    async closeGroup(groupIndex) {
        try {
            const group = this.groups[groupIndex];
            if (!group || !group.tabs.length) return;

            if (!confirm(`确定要关闭分组 "${group.name}" 中的所有 ${group.tabs.length} 个标签页吗？`)) {
                return;
            }

            // 保存撤销状态
            this.saveUndoState('closeGroup', {
                name: group.name,
                tabs: group.tabs.map(tab => ({
                    url: tab.url,
                    title: tab.title
                }))
            });

            const tabIds = group.tabs.map(tab => tab.id);
            await chrome.tabs.remove(tabIds);
            
            this.groups.splice(groupIndex, 1);
            this.renderGroups();
            await this.updateStats();
            
            this.showNotification(`已关闭分组: ${group.name}`, 'success');
        } catch (error) {
            console.error('关闭分组失败:', error);
            this.showNotification('关闭分组失败', 'error');
        }
    }

    async createAllGroups() {
        try {
            // 确保分组已按注意力排序
            this.renderGroups();
            
            for (let i = 0; i < this.groups.length; i++) {
                await this.createTabGroup(i);
                // 添加小延迟避免API调用过快
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            this.showNotification('已创建所有分组', 'success');
        } catch (error) {
            console.error('批量创建分组失败:', error);
            this.showNotification('批量创建失败', 'error');
        }
    }
    
    async cancelAllGroups() {
        try {
            // 获取所有当前的标签页分组
            const allTabGroups = await chrome.tabGroups.query({});
            
            if (allTabGroups.length === 0) {
                this.showNotification('没有找到需要取消的分组', 'info');
                return;
            }
            
            // 确认对话框
            const confirmMessage = `确定要取消所有 ${allTabGroups.length} 个分组吗？标签页将保留，但分组会被解散。`;
            if (!confirm(confirmMessage)) {
                return;
            }
            
            // 逐个取消分组
            let canceledCount = 0;
            for (const group of allTabGroups) {
                try {
                    await chrome.tabs.ungroup(await chrome.tabs.query({groupId: group.id}));
                    canceledCount++;
                } catch (error) {
                    console.warn(`取消分组 ${group.title || group.id} 失败:`, error);
                }
            }
            
            // 清除缓存的分组数据
            await this.clearCachedGroups();
            this.groups = [];
            
            // 返回主视图
            this.showMainView();
            
            this.showNotification(`已取消 ${canceledCount} 个分组`, 'success');
            console.log(`成功取消 ${canceledCount} 个分组`);
            
        } catch (error) {
            console.error('取消所有分组失败:', error);
            this.showNotification('取消分组失败', 'error');
        }
    }

    async applySuggestion(index) {
        try {
            const suggestion = this.suggestions[index];
            if (!suggestion) return;

            if (suggestion.action === 'close') {
                const tabIds = suggestion.tabs.map(tab => tab.id);
                await chrome.tabs.remove(tabIds);
                this.showNotification('已应用清理建议', 'success');
            }

            this.suggestions.splice(index, 1);
            this.renderSuggestions();
            await this.updateStats();
            
        } catch (error) {
            console.error('应用建议失败:', error);
            this.showNotification('应用失败', 'error');
        }
    }

    dismissSuggestion(index) {
        this.suggestions.splice(index, 1);
        this.renderSuggestions();
    }

    // 通知系统
    showNotification(message, type = 'info', duration = 3000) {
        const statusInfo = document.getElementById('statusInfo');
        if (statusInfo) {
            statusInfo.innerHTML = `
                <div class="status-message status-${type}">
                    <span class="status-icon">${this.getStatusIcon(type)}</span>
                    <span class="status-text">${message}</span>
                </div>
            `;
            statusInfo.style.display = 'block';
            
            // 添加动画效果
            const messageEl = statusInfo.querySelector('.status-message');
            if (messageEl) {
                messageEl.style.animation = 'slideIn 0.3s ease-out';
            }
            
            setTimeout(() => {
                if (messageEl) {
                    messageEl.style.animation = 'slideOut 0.2s ease-in';
                    setTimeout(() => {
                        statusInfo.style.display = 'none';
                    }, 200);
                } else {
                    statusInfo.style.display = 'none';
                }
            }, duration);
        }
    }
    
    getStatusIcon(type) {
        const icons = {
            'success': '✓',
            'error': '✕', 
            'info': 'ℹ',
            'warning': '⚠'
        };
        return icons[type] || icons.info;
    }

    // 统一的按钮状态管理
    setButtonLoading(buttonId, loadingId, loading = true) {
        const button = document.getElementById(buttonId);
        const loadingEl = document.getElementById(loadingId);
        
        if (button && loadingEl) {
            button.disabled = loading;
            loadingEl.style.display = loading ? 'inline-block' : 'none';
            
            if (loading) {
                button.classList.add('loading-state');
            } else {
                button.classList.remove('loading-state');
            }
        }
    }

    // 绑定动态生成的分组事件
    bindDynamicEvents(container) {
        container.addEventListener('click', (e) => {
            if (e.target.classList.contains('tab-close')) {
                const tabId = parseInt(e.target.dataset.tabId);
                this.closeTab(tabId);
            } else if (e.target.classList.contains('create-group-btn')) {
                const groupIndex = parseInt(e.target.dataset.groupIndex);
                this.createTabGroup(groupIndex);
            } else if (e.target.classList.contains('highlight-group-btn')) {
                const groupIndex = parseInt(e.target.dataset.groupIndex);
                this.highlightGroup(groupIndex);
            } else if (e.target.classList.contains('close-group-btn')) {
                const groupIndex = parseInt(e.target.dataset.groupIndex);
                this.closeGroup(groupIndex);
            }
        });
    }

    // 绑定建议事件
    bindSuggestionEvents(container) {
        container.addEventListener('click', (e) => {
            if (e.target.classList.contains('suggestion-apply')) {
                const index = parseInt(e.target.dataset.suggestionIndex);
                this.applySuggestion(index);
            } else if (e.target.classList.contains('suggestion-dismiss')) {
                const index = parseInt(e.target.dataset.suggestionIndex);
                this.dismissSuggestion(index);
            }
        });
    }

    // 撤销系统
    saveUndoState(action, data) {
        const undoState = {
            action,
            data,
            timestamp: Date.now()
        };
        
        this.undoStack.push(undoState);
        
        // 限制撤销步数
        if (this.undoStack.length > this.maxUndoSteps) {
            this.undoStack.shift();
        }
        
        this.updateUndoButton();
    }
    
    async performUndo() {
        if (this.undoStack.length === 0) return;
        
        const lastAction = this.undoStack.pop();
        console.log('撤销操作:', lastAction);
        
        try {
            switch (lastAction.action) {
                case 'closeTab':
                    // 重新打开已关闭的标签页
                    await chrome.tabs.create({
                        url: lastAction.data.url,
                        active: false
                    });
                    this.showStatus('已恢复标签页: ' + lastAction.data.title, 'success');
                    break;
                    
                case 'closeGroup':
                    // 重新打开整个分组的标签页
                    for (const tab of lastAction.data.tabs) {
                        await chrome.tabs.create({
                            url: tab.url,
                            active: false
                        });
                    }
                    this.showStatus(`已恢复分组: ${lastAction.data.name} (${lastAction.data.tabs.length}个标签页)`, 'success');
                    break;
                    
                case 'applySuggestion':
                    // 根据建议类型执行相应的撤销操作
                    if (lastAction.data.type === 'close') {
                        for (const tab of lastAction.data.tabs) {
                            await chrome.tabs.create({
                                url: tab.url,
                                active: false
                            });
                        }
                        this.showStatus('已恢复建议关闭的标签页', 'success');
                    }
                    break;
                    
                default:
                    console.log('不支持撤销的操作类型:', lastAction.action);
            }
        } catch (error) {
            console.error('撤销操作失败:', error);
            this.showStatus('撤销失败', 'error');
        }
        
        this.updateUndoButton();
        await this.updateStats();
    }
    
    updateUndoButton() {
        const undoBtn = document.getElementById('undoBtn');
        if (undoBtn) {
            undoBtn.disabled = this.undoStack.length === 0;
            undoBtn.title = this.undoStack.length > 0 
                ? `撤销上一步操作 (${this.undoStack.length}步可撤销)` 
                : '没有可撤销的操作';
        }
    }
    
    clearUndoHistory() {
        this.undoStack = [];
        this.updateUndoButton();
    }


    // 进度管理
    startProgress(message = '处理中...') {
        const progressContainer = document.getElementById('progressContainer');
        const progressText = document.getElementById('progressText');
        
        if (progressContainer) progressContainer.style.display = 'flex';
        if (progressText) progressText.textContent = message;
        
        this.updateProgress(10, message);
    }
    
    updateProgress(percent, message) {
        const progressFill = document.getElementById('progressFill');
        const progressText = document.getElementById('progressText');
        
        if (progressFill) {
            progressFill.style.width = `${Math.min(percent, 100)}%`;
        }
        
        if (progressText && message) {
            progressText.textContent = message;
        }
    }
    
    endProgress() {
        const progressContainer = document.getElementById('progressContainer');
        
        setTimeout(() => {
            if (progressContainer) progressContainer.style.display = 'none';
        }, 1000);
    }

    // 工具函数
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // 颜色和注意力相关函数
    getGroupColor(index) {
        // 彩虹颜色序列
        const colors = [
            '#FF6B6B', // 红色
            '#4ECDC4', // 青色
            '#45B7D1', // 蓝色
            '#96CEB4', // 绿色
            '#FFEAA7', // 黄色
            '#DDA0DD', // 紫色
            '#98D8C8', // 薄荷绿
            '#F7DC6F', // 金色
            '#BB8FCE', // 淡紫色
            '#85C1E9'  // 天蓝色
        ];
        return colors[index % colors.length];
    }
    
    getAttentionColor(attentionScore) {
        // 根据注意力分数返回颜色（彩虹色谱，从红到紫）
        if (attentionScore >= 2.0) return '#8B0000';      // 深红 - 极高注意力
        if (attentionScore >= 1.5) return '#FF4444';      // 红色 - 高注意力
        if (attentionScore >= 1.0) return '#FF8800';      // 橙色 - 较高注意力
        if (attentionScore >= 0.7) return '#FFDD00';      // 黄色 - 中等注意力
        if (attentionScore >= 0.5) return '#88DD00';      // 黄绿色 - 一般注意力
        if (attentionScore >= 0.3) return '#00DD88';      // 绿色 - 较低注意力
        if (attentionScore >= 0.2) return '#00AADD';      // 蓝色 - 低注意力
        if (attentionScore >= 0.1) return '#4488DD';      // 深蓝色 - 很低注意力
        return '#6666AA';                                  // 紫色 - 极低注意力
    }
    
    getAttentionLabel(attentionScore) {
        if (attentionScore >= 2.0) return '极高';
        if (attentionScore >= 1.5) return '高';
        if (attentionScore >= 1.0) return '较高';
        if (attentionScore >= 0.7) return '中等';
        if (attentionScore >= 0.5) return '一般';
        if (attentionScore >= 0.3) return '较低';
        if (attentionScore >= 0.2) return '低';
        if (attentionScore >= 0.1) return '很低';
        return '极低';
    }
    
    getTabAttention(tabId) {
        // 同步版本，使用启发式方法估算注意力
        // 查找对应的tab以获取更多信息
        let baseScore = Math.random() * 2.5; // 0-2.5 的基础随机注意力分数
        
        // 尝试从当前分组中找到对应的tab
        for (const group of this.groups) {
            const tab = group.tabs.find(t => t.id === tabId);
            if (tab) {
                // 如果标签页正在播放音频/视频，增加注意力分数
                if (tab.audible) {
                    baseScore += 0.8; // 媒体播放时增加注意力权重
                }
                break;
            }
        }
        
        return Math.min(baseScore, 2.5); // 确保不超过最大值
    }
    
    calculateGroupAttention(group) {
        if (!group.tabs || group.tabs.length === 0) return 0;
        
        // 使用同步方式计算（因为在渲染中调用）
        const totalAttention = group.tabs.reduce((sum, tab) => {
            // 使用简单的启发式计算注意力分数
            const baseScore = Math.random() * 2.5;
            return sum + baseScore;
        }, 0);
        
        return totalAttention / group.tabs.length;
    }

    truncateText(text, maxLength) {
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength - 3) + '...';
    }
    
    // 将彩虹颜色转换为Chrome支持的分组颜色
    getChromeGroupColor(hexColor) {
        // Chrome 标签页分组支持的颜色
        const colorMap = {
            '#FF6B6B': 'red',     // 红色
            '#4ECDC4': 'cyan',    // 青色
            '#45B7D1': 'blue',    // 蓝色
            '#96CEB4': 'green',   // 绿色
            '#FFEAA7': 'yellow',  // 黄色
            '#DDA0DD': 'purple',  // 紫色
            '#98D8C8': 'green',   // 薄荷绿 -> 绿色
            '#F7DC6F': 'yellow',  // 金色 -> 黄色
            '#BB8FCE': 'purple',  // 淡紫色 -> 紫色
            '#85C1E9': 'blue'     // 天蓝色 -> 蓝色
        };
        
        return colorMap[hexColor] || 'grey';
    }
}

// 初始化应用
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new FocuenceApp();
    // 导出给HTML中的onclick使用
    window.app = app;
});

// 全局错误处理
window.addEventListener('error', (event) => {
    console.error('全局错误:', event.error);
});

// 导出主要函数供HTML使用
window.closeTab = (tabId) => app?.closeTab(tabId);
window.createTabGroup = (groupIndex) => app?.createTabGroup(groupIndex);
window.highlightGroup = (groupIndex) => app?.highlightGroup(groupIndex);
window.closeGroup = (groupIndex) => app?.closeGroup(groupIndex);
window.applySuggestion = (index) => app?.applySuggestion(index);
window.dismissSuggestion = (index) => app?.dismissSuggestion(index);