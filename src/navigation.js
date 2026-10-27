export function workspaceURL(base, {view = 'tasks', windowId, range = 'week', demo = false, topic, from, to,item,draft} = {}) {
  const query = new URLSearchParams({ range });
  if (demo) query.set('demo', '1');
  if (Number.isInteger(windowId)) query.set('windowId', windowId);
  if (topic) query.set('topic', topic);
  if(item)query.set('item',item);if(draft)query.set('draft',draft);
  if (from && to) { query.set('from', from); query.set('to', to); }
  return base + '?' + query + '#' + view;
}

export async function openWorkspace(options = {}) {
  const {windowId, demo = false} = options;
  if (demo) { location.href = workspaceURL('../app/index.html', options); return; }
  const base = chrome.runtime.getURL('app/index.html');
  const url = workspaceURL(base, options);
  const tabs = await chrome.tabs.query(Number.isInteger(windowId) ? { windowId } : {});
  const existing = tabs.find(tab => tab.url?.startsWith(base));
  if (existing) {
    await chrome.tabs.update(existing.id, { url, active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else await chrome.tabs.create({ url, ...(Number.isInteger(windowId) ? { windowId } : {}) });
}

// Call synchronously from a click handler: awaiting an RPC first loses the user gesture.
export function openSidePanel({ windowId, demo = false } = {}) {
  if (demo) { location.href = '../panel/index.html?demo=1#tasks'; return Promise.resolve(); }
  if (!chrome.sidePanel?.open) return Promise.reject(new Error('当前浏览器未提供侧栏入口，可以打开完整工作台继续。'));
  return chrome.sidePanel.open({ windowId });
}
