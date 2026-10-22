const isDemo = new URLSearchParams(location.search).get('demo') === '1';
let state = null;
let windowId;
let transport;
let working = false;
const element = (id) => document.getElementById(id);
if (isDemo) {
  const {createDemoTransport} = await import('../app/demo-data.js');
  transport = createDemoTransport(); windowId = 1; element('demo-banner').hidden = false;
} else {
  transport = (message) => {
    if (!globalThis.chrome?.runtime?.sendMessage) throw new Error('请从浏览器的 Focuence 扩展图标打开此面板。');
    return chrome.runtime.sendMessage(message);
  };
  if (globalThis.chrome?.windows?.getCurrent) {
    try { windowId = (await chrome.windows.getCurrent()).id; } catch { /* Background can resolve the current window. */ }
  }
}
async function request(type, payload = {}) {
  const response = await transport({target: 'background', type, ...payload});
  if (!response?.ok) throw new Error(typeof response?.error === 'string' ? response.error : response?.error?.message || '操作没有完成，请稍后重试。');
  return response.data;
}
function showError(error) { element('error').textContent = error.message || String(error); element('error').hidden = false; }
function duration(ms) {
  const minutes = Math.floor(Math.max(0, Number(ms) || 0) / 60000);
  if (!minutes) return Number(ms) > 0 ? '< 1 分钟' : '0 分钟';
  if (minutes < 60) return minutes + ' 分钟';
  return Math.floor(minutes / 60) + ' 小时 ' + minutes % 60 + ' 分';
}
function domain(tab) { if (tab.domain) return tab.domain; try { return new URL(tab.url).hostname; } catch { return '页面'; } }
function render() {
  if (!state) return;
  const tabs = Array.isArray(state.tabs) ? state.tabs : [];
  const tracking = state.settings?.tracking !== false;
  element('duration').textContent = duration(state.stats?.todayForegroundMs);
  element('tab-count').replaceChildren(document.createTextNode(String(tabs.length)));
  const countUnit = document.createElement('small'); countUnit.textContent = '页'; element('tab-count').append(countUnit);
  element('toggle-tracking').textContent = tracking ? '暂停记录' : '恢复记录';
  element('toggle-tracking').disabled = working;
  element('status').classList.toggle('paused', !tracking);
  const statusDot = document.createElement('i');
  element('status').replaceChildren(statusDot, document.createTextNode(isDemo ? 'DEMO · 独立示例' : tracking ? 'LOCAL · 本机处理' : 'LOCAL · 记录已暂停'));
  element('quick-group').disabled = working || tabs.filter((tab) => !tab.pinned && !(Number(tab.groupId) >= 0)).length < 2;
  const list = element('tabs'); list.replaceChildren();
  if (!tabs.length) {
    const message = document.createElement('p'); message.className = 'empty'; message.textContent = '当前窗口还没有可整理的网页。'; list.append(message);
  } else {
    for (const [index, tab] of tabs.slice(0, 4).entries()) {
      const row = document.createElement('button'); row.type = 'button'; row.className = 'tab-row'; row.title = '定位 ' + (tab.title || domain(tab));
      const mark = document.createElement('span'); mark.className = 'domain-mark color-' + index % 4; mark.textContent = domain(tab).replace(/^www\./, '').slice(0, 2); mark.setAttribute('aria-hidden', 'true');
      const info = document.createElement('span'); info.className = 'tab-info';
      const title = document.createElement('strong'); title.textContent = tab.title || domain(tab);
      const meta = document.createElement('small'); meta.textContent = domain(tab) + (tab.pinned ? ' · 已固定' : Number(tab.groupId) >= 0 ? ' · 已分组' : '');
      info.append(title, meta);
      const time = document.createElement('span'); time.className = 'tab-time'; time.textContent = duration(tab.foregroundMs);
      row.append(mark, info, time);
      row.addEventListener('click', async () => { try { await request('FOCUS_TAB', {tabId: tab.id}); if (isDemo) element('feedback').textContent = '示例：已定位这个页面。'; else window.close(); } catch (error) { showError(error); } });
      list.append(row);
    }
  }
  element('more').textContent = tabs.length > 4 ? '还有 ' + (tabs.length - 4) + ' 个页面，在工作台继续查看。' : tabs.length ? '点击页面可直接定位。' : '打开网页后，点击右上方刷新。';
}
async function refresh() {
  element('error').hidden = true;
  try { state = await request('GET_STATE', {windowId}); render(); }
  catch (error) { showError(error); element('tabs').replaceChildren(); element('more').textContent = '可尝试重新加载扩展，再打开面板。'; }
}
async function openWorkspace(view = 'pages') {
  if (isDemo) { location.href = '../app/index.html?demo=1#' + view; return; }
  const baseUrl = chrome.runtime.getURL('app/index.html');
  const url = baseUrl + (windowId ? '?windowId=' + windowId : '') + '#' + view;
  const allTabs = await chrome.tabs.query({});
  const existing = allTabs.find((tab) => typeof tab.url === 'string' && tab.url.startsWith(baseUrl));
  if (existing) {
    await chrome.tabs.update(existing.id, {url, active: true});
    await chrome.windows.update(existing.windowId, {focused: true});
  } else await chrome.tabs.create({url, ...(windowId ? {windowId} : {})});
  window.close();
}
element('workspace').addEventListener('click', () => openWorkspace('tasks').catch(showError));
element('settings').addEventListener('click', () => openWorkspace('settings').catch(showError));
element('refresh').addEventListener('click', refresh);
element('toggle-tracking').addEventListener('click', async () => {
  if (!state || working) return;
  working = true; render();
  try { await request('UPDATE_SETTINGS', {patch: {tracking: !state.settings.tracking}}); await refresh(); }
  catch (error) { showError(error); } finally { working = false; render(); }
});
element('quick-group').addEventListener('click', async () => {
  if (working) return;
  working = true; element('quick-group').textContent = '正在整理…'; render();
  try {
    const result = await request('PROPOSE_GROUPS', {windowId, semantic: false});
    element('feedback').textContent = '已找到 ' + (result?.groups?.length || 0) + ' 组建议，正在打开工作台。';
    await openWorkspace('pages');
  } catch (error) { showError(error); }
  finally { working = false; element('quick-group').textContent = '快速整理'; render(); }
});
await refresh();
