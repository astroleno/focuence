// 后台服务脚本
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
});

// 监听标签页更新
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete') {
        // 可以在这里添加标签页完成加载后的处理逻辑
    }
});

// 监听标签页激活
chrome.tabs.onActivated.addListener((activeInfo) => {
    // 可以在这里添加标签页激活后的处理逻辑
});

// 处理来自popup或options的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getTabsData') {
        chrome.tabs.query({}, (tabs) => {
            sendResponse({ tabs: tabs });
        });
        return true; // 保持消息通道开放
    }
    
    if (request.action === 'groupTabs') {
        // 处理标签页分组逻辑
        groupTabsLogic(request.tabs).then(groups => {
            sendResponse({ groups: groups });
        });
        return true;
    }
});

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