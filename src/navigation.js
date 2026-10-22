export async function openWorkspace({ view = 'review', windowId, range = 'week', demo = false } = {}) {
  if (demo) { location.href = '../app/index.html?demo=1&range=' + range + '#' + view; return; }
  const base = chrome.runtime.getURL('app/index.html');
  const query = new URLSearchParams({ range });
  if (Number.isInteger(windowId)) query.set('windowId', windowId);
  const url = base + '?' + query + '#' + view;
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
