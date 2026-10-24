import { el, svgEl, icon, duration } from '../src/ui.js';
import { openWorkspace, openSidePanel } from '../src/navigation.js';
import { mapTopology, localNeighborhood, resolveMapContext } from '../src/map-layout.js';
import { uniqueTaskPages } from '../src/tasks.js';
import { taskNotes } from '../src/task-notes.js';
import { taskPages } from '../src/task-pages.js';
import { proposalMembers, selectedProposal } from '../src/proposals.js';
import { createTaskMemoryUI } from '../src/task-memory-ui.js';
import { taskText } from '../src/task-context.js';
import { createTabWorkspaceUI } from '../src/tab-workspace-ui.js';
import { createBackupUI } from '../src/backup-ui.js';

const params = new URLSearchParams(location.search);
const isPanel = document.body.dataset.surface === 'panel';
const isDemo = params.get('demo') === '1';
const viewNames = isPanel ? {tasks: '任务', search: '查找', pages: '页面', timeline: '路径', map: '地图'} : {review: '一周回顾', tasks: '任务工作台', search: '找回线索', pages: '当前页面', timeline: '访问路径', map: '注意力地图', settings: '数据与设置'};
const viewIcons = {review: 'clock', pages: 'layers', tasks: 'folder', search: 'search', timeline: 'clock', map: 'nodes', settings: 'settings'};
const palette = {grey: '#929889', gray: '#929889', blue: '#8a9eb3', red: '#bd8579', yellow: '#c0a56c', green: '#8caa8c', pink: '#b492a4', purple: '#a494b3', cyan: '#7ba9a4', orange: '#d89068'};
function button(label, action, attributes = {}, className = '', iconName) {
  return el('button', {type: 'button', ...(attributes['data-id'] != null ? {id: 'action-' + action + '-' + encodeURIComponent(attributes['data-id'])} : {}), class: 'btn ' + className, 'data-action': action, ...attributes}, iconName && icon(iconName), label);
}
function iconButton(label, action, iconName, attributes = {}, className = '') {
  return el('button', {type: 'button', ...(attributes['data-id'] != null ? {id: 'icon-action-' + action + '-' + encodeURIComponent(attributes['data-id'])} : {}), class: 'icon-button ' + className, title: label, 'aria-label': label, 'data-action': action, ...attributes}, icon(iconName));
}
function tagChip(text, action, attributes = {}) {
  return el(action ? 'button' : 'span', {class: 'tag', ...(action ? {type: 'button', 'data-action': action, 'data-tag': text} : {}), ...attributes}, text);
}
function timeLabel(value) {
  if (!Number.isFinite(Number(value))) return '—';
  return new Date(Number(value)).toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit', hour12: false});
}
function dateLabel(value, withYear = false) {
  return new Date(Number(value) || Date.now()).toLocaleDateString('zh-CN', {year: withYear ? 'numeric' : undefined, month: 'long', day: 'numeric'});
}
function dayKey(value) {
  const date = new Date(Number(value));
  return date.getFullYear() + '-' + (date.getMonth() + 1) + '-' + date.getDate();
}
function domainOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return '页面'; } }
function colorOf(value) { return palette[value] || (/^#[0-9a-f]{6}$/i.test(value || '') ? value : palette.green); }
function tagsOf(item) { return Array.isArray(item?.tags) ? item.tags.filter((tag) => typeof tag === 'string') : []; }
function normalizeState(value) {
  return {
    version: value?.version || '2.3.0',
    demo: value?.demo === true,
    proposalNotice: value?.proposalNotice || '',
    attention: value?.attention || {nodes: [], daily: [], summary: {}, range: {key: 'week', label: '最近 7 天'}},
    undoAvailable: Boolean(value?.undoAvailable),
    work: value?.work,
    timelineTruncated: Boolean(value?.timelineTruncated),
    settings: {tracking: true, semantic: true, focusSupport: false, idleSeconds: 120, retentionDays: 30, excludedDomains: [], ...value?.settings},
    tabs: Array.isArray(value?.tabs) ? value.tabs : [], tasks: Array.isArray(value?.tasks) ? value.tasks : [],
    segments: Array.isArray(value?.segments) ? value.segments : [], groups: Array.isArray(value?.groups) ? value.groups : [],
    stats: {todayForegroundMs: 0, todayPages: 0, todaySwitches: 0, totalTasks: 0, ...value?.stats},
    model: {status: 'idle', name: 'BGE-small-zh-v1.5', progress: 0, ...value?.model},
    transitions: Array.isArray(value?.transitions) ? value.transitions : value?.transitions?.edges || [],
    suggestions: Array.isArray(value?.suggestions) ? value.suggestions : [],
    trackingState: typeof value?.trackingState === 'string' ? {status: value.trackingState} : value?.trackingState || {status: 'unknown'}
  };
}
const ui = {
  view: Object.hasOwn(viewNames, location.hash.slice(1)) ? location.hash.slice(1) : isPanel ? 'tasks' : 'review',
  range: ['today', 'yesterday', 'week'].includes(params.get('range')) ? params.get('range') : isPanel ? 'today' : 'week',
  state: null, error: '', busy: new Set(), selected: new Set(), applied: new Set(),
  queries: {pages: '', tasks: ''}, pageFilter: 'all', sort: 'recent', pagesMode: 'list', listScroll: 0, members: new Map(), expandedPages: new Set(), expandedSegments: new Set(),
  timelineStatus: 'all', timelineLimit: 60, timelineTag: '', selectedTag: params.get('topic') || '',
  selectedEdge: params.get('from') && params.get('to') ? params.get('from') + '\u0000' + params.get('to') : '',
  mapScope: 'related', mapNotice: '', expandedNotes: new Set(), pendingRange: null, failedRange: null, refreshAfterRange: false,
  canUndo: false, settingsDraft: null, settingsDirty: false, lastRefresh: 0
};
if (ui.view === 'review') ui.range = 'week';
let windowId = Number(params.get('windowId')) || undefined;
let transport;
if (isDemo) {
  const {createDemoTransport} = await import('./demo-data.js');
  transport = createDemoTransport();
  windowId = 1;
} else {
  transport = async (message) => {
    if (!globalThis.chrome?.runtime?.sendMessage) throw new Error('请在安装后的 Focuence 扩展中打开工作台。独立网页可以通过 ?demo=1 查看示例。');
    return chrome.runtime.sendMessage(message);
  };
  if (!windowId && globalThis.chrome?.windows?.getCurrent) {
    try { windowId = (await chrome.windows.getCurrent()).id; } catch { /* The backend can select a window. */ }
  }
}
async function request(type, payload = {}) {
  const response = await transport({target: 'background', type, ...payload});
  if (!response?.ok) {
    const message = typeof response?.error === 'string' ? response.error : response?.error?.message;
    throw Object.assign(new Error(message || '操作没有完成，请刷新后重试。'), {code: response?.code});
  }
  return response.data;
}
const memory = createTaskMemoryUI({getState: () => ui.state, request, refresh: () => refresh({quiet: true}), render,
  notify: toast, getWindowId: () => windowId, surface: isPanel ? 'panel' : 'workspace', showEvidence: id => {
    if (!ui.state.segments.some(segment => segment.id === id)) {
      const segment = (ui.state.work?.patterns?.repeatedReturns || []).flatMap(item => item.evidence.flatMap(row => row.evidence)).find(item => item.id === id);
      if (!segment) { toast('这条记录已不可用，请重新读取。', true); return; }
      const {body} = dialogFrame('访问记录', '这条证据在当前路径列表的 2,000 条展示范围之外，仍保留在本机记录中。');
      body.append(el('div', {class: 'memory-record'}, el('h3', {}, segment.title),
        el('p', {class: 'memory-caption'}, new Date(segment.startedAt).toLocaleString('zh-CN') + ' — ' + timeLabel(segment.endedAt)),
        el('p', {}, '前台停留 ' + duration(segment.foregroundMs)), el('p', {class: 'memory-caption'}, segment.url),
        button('打开页面', 'open-page', {'data-url': segment.url}, 'small')));
      return;
    }
    ui.timelineStatus = 'all'; ui.timelineTag = ''; ui.timelineLimit = ui.state.segments.length; ui.expandedSegments.add(id);
    ui.view = 'timeline'; render();
    const target = document.getElementById('segment-toggle-' + encodeURIComponent(id)); target?.scrollIntoView({block: 'center'}); target?.focus({preventScroll: true});
  }});
let toastTimer;
const tabWorkspace = createTabWorkspaceUI({request,getState:()=>ui.state,getWindowId:()=>windowId,render,refresh:()=>refresh({quiet:true}),notify:toast,demo:isDemo});
const backupUI = createBackupUI({request,render,refresh:()=>refresh({quiet:true}),notify:toast,demo:isDemo});
function toast(message, error = false, actionName = '') {
  const region = document.getElementById('toast-region');
  const hadFocus = region.contains(document.activeElement);
  region.replaceChildren(el('div', {class: 'toast' + (error ? ' error' : '')}, icon(error ? 'info' : 'check'), el('span', {}, message),
    actionName && button(actionName === 'undo-group' ? '撤销' : '重新生成', actionName, {id: 'toast-action'}, 'toast-action')));
  clearTimeout(toastTimer);
  if (!actionName) toastTimer = setTimeout(() => region.replaceChildren(), error ? 6500 : 3700);
  if (hadFocus) (document.getElementById('toast-action') || document.getElementById('grouping-title') || document.getElementById('main'))?.focus({preventScroll: true});
}
function busy(id) { return ui.busy.has(id); }
async function operation(id, callback) {
  if (busy(id)) return;
  const focusId = document.activeElement?.id;
  ui.busy.add(id); render();
  try { return await callback(); }
  catch (error) {
    if (error.code === 'STALE_PROPOSAL') await refresh({quiet: true});
    toast(error.message || String(error), true, error.code === 'STALE_PROPOSAL' ? 'propose' : '');
  }
  finally {
    ui.busy.delete(id); render();
    if ([document.body, document.getElementById('main')].includes(document.activeElement)) {
      const target = focusId && document.getElementById(focusId);
      if (target && !target.disabled) target.focus({preventScroll: true});
    }
  }
}
let refreshEpoch = 0;
async function refresh({quiet = false, range = ui.range, rangeTransition = false} = {}) {
  if (busy('range') && !rangeTransition) { ui.refreshAfterRange = true; return false; }
  const epoch = ++refreshEpoch;
  try {
    const value = await request('GET_STATE', {windowId, range});
    if (epoch !== refreshEpoch) return false;
    if (Number.isInteger(value.windowId)) windowId = value.windowId;
    ui.state = normalizeState(value); ui.range = range; ui.failedRange = null; ui.error = ''; ui.lastRefresh = Date.now();
    ui.canUndo = ui.state.undoAvailable;
    ui.selected = new Set([...ui.selected].filter((id) => ui.state.tabs.some((tab) => tab.id === id)));
    if (!ui.settingsDirty) ui.settingsDraft = {...ui.state.settings, excludedDomains: [...ui.state.settings.excludedDomains]};
    render();
    return true;
  } catch (error) {
    if (epoch !== refreshEpoch) return false;
    ui.failedRange = range;
    ui.error = range !== ui.range && ui.state ? '未能读取' + rangeName(range) + '，当前仍显示' + rangeName(ui.range) + '的数据。' + error.message : error.message;
    if (!quiet && ui.state) toast(error.message, true);
    render(); return false;
  }
}
function rangeName(range) { return {today: '今天', yesterday: '昨天', week: '最近 7 天'}[range] || '所选范围'; }
async function chooseRange(range) {
  if (busy('range')) return;
  const focusId = document.activeElement?.id;
  ui.pendingRange = range; ui.timelineLimit = 60;
  await operation('range', async () => {
    try { await refresh({quiet: true, range, rangeTransition: true}); }
    finally { ui.pendingRange = null; }
  });
  if (ui.refreshAfterRange) { ui.refreshAfterRange = false; await refresh({quiet: true}); }
  if (document.activeElement === document.body && ['timeline-range', 'map-range'].includes(focusId)) document.getElementById(focusId)?.focus({preventScroll: true});
}
function rangeLoading() {
  return el('div', {class: 'loading-shell', role: 'status'}, el('div', {class: 'spinner'}), '正在读取' + rangeName(ui.pendingRange) + '的记录…');
}
function modelBar() {
  const model = ui.state.model;
  const status = model.status;
  const progress = Math.max(0, Math.min(1, Number(model.progress) || 0));
  const labels = {idle: '快速规则已就绪', loading: '正在准备本地语义模型', ready: '本地语义模型已就绪', error: '语义增强暂不可用'};
  return el('div', {class: 'model-bar', 'aria-live': status === 'loading' ? 'polite' : 'off'},
    el('div', {class: 'model-label'}, el('strong', {}, status === 'loading' ? el('span', {class: 'spinner'}) : el('span', {class: 'status-dot' + (status === 'error' ? ' error' : '')}), labels[status] || labels.idle), status === 'loading' && el('span', {}, Math.round(progress * 100) + '%')),
    status === 'loading' && el('div', {class: 'progress-track', role: 'progressbar', 'aria-label': '本地模型准备进度', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(progress * 100)}, el('div', {class: 'progress-value', style: {width: progress * 100 + '%'}})),
    status === 'error' && el('p', {class: 'model-error'}, model.error || '可以继续使用快速规则建议，稍后重试语义增强。')
  );
}
function emptyState(title, message, action, actionLabel, compact = false, iconName = 'layers') {
  return el('div', {class: 'empty-state' + (compact ? ' compact' : '')},
    el('div', {class: 'empty-icon'}, icon(iconName)), el('h3', {}, title), el('p', {}, message),
    action && button(actionLabel, action, {}, 'small', action === 'nav-pages' ? 'arrow' : 'plus'));
}
function buildShell() {
  const app = document.getElementById('app');
  if (isPanel) {
    app.classList.add('panel-shell');
    app.replaceChildren(
      el('header', {class: 'panel-header'},
        el('a', {class: 'brand', href: '#tasks', 'aria-label': 'Focuence · 浏览侧栏'}, el('img', {src: '../icons/icon-48.png', width: 24, height: 24, alt: ''}), el('strong', {}, 'Focuence')),
        el('div', {class: 'button-cluster'}, el('span', {id: 'top-status', class: 'sr-only'}), el('div', {id: 'sidebar-tracking'}), iconButton('打开完整回顾', 'open-workspace', 'external'))),
      el('nav', {class: 'panel-nav', id: 'navigation', 'aria-label': '侧栏导航'}),
      el('p', {class: 'sr-only', id: 'panel-current'}, '正在读取当前窗口…'),
      el('span', {id: 'breadcrumb', class: 'sr-only'}),
      el('main', {class: 'main', id: 'main', tabindex: '-1'}));
    app.append(el('p', {id: 'results-status', class: 'sr-only', role: 'status'}));
    app.append(document.getElementById('toast-region'));
    return;
  }
  const sidebar = el('aside', {class: 'sidebar', 'aria-label': '主要导航'},
    el('a', {class: 'brand', href: '#review', 'aria-label': 'Focuence · 一周回顾'}, el('img', {src: '../icons/icon-48.png', width: 28, height: 28, alt: ''}), el('strong', {class: 'brand-name'}, 'Focuence')),
    el('nav', {class: 'nav-list', id: 'navigation', 'aria-label': '工作空间'}),
    el('div', {class: 'sidebar-bottom'}, el('div', {id: 'sidebar-tracking'}), el('div', {class: 'local-note'}, icon('shield'), '本机保存'), el('div', {class: 'version'}, 'Focuence 2.3')));
  const workspace = el('div', {class: 'workspace'},
    el('header', {class: 'topbar'},
      el('span', {id: 'breadcrumb', class: 'sr-only'}, viewNames[ui.view]),
      el('div', {class: 'workspace-context', id: 'workspace-context'}, '浏览工作空间'),
      el('label', {class: 'mobile-navigation'}, el('span', {class: 'sr-only'}, '切换功能'), el('select', {id: 'workspace-view', 'aria-label': '切换功能'}, Object.entries(viewNames).map(([key, label]) => el('option', {value: key}, label)))),
      el('div', {class: 'topbar-actions'}, el('span', {class: 'local-status', id: 'top-status'}), button('打开侧栏', 'open-panel', {}, 'small', 'layers'), iconButton('刷新当前数据', 'refresh', 'refresh'))),
    el('main', {class: 'main', id: 'main', tabindex: '-1'}));
  app.replaceChildren(sidebar, workspace, el('p', {id: 'results-status', class: 'sr-only', role: 'status'}));
}
function renderNavigation() {
  const count = ui.state?.tasks.length || 0;
  document.getElementById('navigation').replaceChildren(...Object.keys(viewNames).map(view => el('button', {
    id: 'nav-' + view, type: 'button', class: 'nav-button' + (ui.view === view ? ' active' : ''),
    'data-action': 'navigate', 'data-view': view, 'aria-current': ui.view === view ? 'page' : undefined
  }, icon(viewIcons[view]), viewNames[view], !isPanel && view === 'tasks' && count > 0 && el('span', {class: 'nav-count'}, count))));
  document.getElementById('breadcrumb').textContent = viewNames[ui.view];
  const tracking = ui.state?.settings.tracking !== false;
  document.getElementById('sidebar-tracking').replaceChildren(isPanel
    ? iconButton(tracking ? '暂停浏览记录' : '恢复浏览记录', 'toggle-tracking', tracking ? 'pause' : 'play', {id: 'tracking-toggle', disabled: !ui.state || busy('tracking'), 'aria-pressed': !tracking})
    : el('button', {id: 'tracking-toggle', type: 'button', class: 'pause-button', 'data-action': 'toggle-tracking', disabled: !ui.state || busy('tracking')}, icon(tracking ? 'pause' : 'play'), tracking ? '暂停记录' : '恢复记录'));
  const status = document.getElementById('top-status');
  status.className = isPanel && tracking ? 'sr-only' : 'local-status';
  status.replaceChildren(el('span', {class: 'status-dot' + (tracking ? '' : ' paused')}), !tracking ? '记录已暂停' : isDemo ? '示例模式' : '本机记录中');
  if (isPanel && ui.state) {
    const active = ui.state.tabs.find(tab => tab.active);
    const label = active ? active.title : '当前窗口 · ' + ui.state.tabs.length + ' 个页面';
    document.getElementById('panel-current').textContent = label;
  }
  if (!isPanel) {
    document.getElementById('workspace-view').value = ui.view;
    document.getElementById('workspace-context').textContent = ui.state ? '当前窗口 · ' + ui.state.tabs.length + ' 个页面' : '浏览工作空间';
  }
}
function heading(title, description, actions = []) {
  return el('div', {class: 'page-header'}, el('div', {class: 'page-heading'}, el('h1', {}, title), !isPanel && description && el('p', {}, description)), actions.length > 0 && el('div', {class: 'header-actions'}, actions));
}
function statStrip() {
  const stats = ui.state.stats;
  const data = [['今日前台停留', duration(stats.todayForegroundMs)], ['今日访问页面', stats.todayPages, '页'], ['今日页面切换', stats.todaySwitches, '次'], ['保留的任务', ui.state.tasks.length, '个']];
  return el('section', {class: 'stat-strip', 'aria-label': '今日浏览概况'}, data.map(([label, value, unit]) => el('div', {class: 'stat'}, el('p', {class: 'stat-label'}, label), el('p', {class: 'stat-value'}, value, unit && el('small', {}, unit)))));
}
function searchBox(view, placeholder) {
  return el('div', {class: 'search-box'}, icon('search'), el('input', {id: view + '-search', type: 'search', 'data-search': view, placeholder, 'aria-label': placeholder, value: ui.queries[view]}));
}
function announceResults() {
  const region = document.getElementById('results-status');
  region.textContent = ui.view === 'timeline' ? '当前筛选显示 ' + visibleSegments().length + ' 条记录' : '当前筛选显示 ' + filteredTabs().length + ' 个页面';
}
function isProtected(tab) { return Boolean(tab.pinned || Number(tab.groupId) >= 0); }
function filteredTabs() {
  const query = ui.queries.pages.trim().toLocaleLowerCase();
  const tabs = ui.state.tabs.filter((tab) => {
    if (ui.pageFilter === 'ungrouped' && isProtected(tab)) return false;
    if (ui.pageFilter === 'protected' && !isProtected(tab)) return false;
    return !query || [tab.title, tab.domain, tab.url, ...tagsOf(tab)].join(' ').toLocaleLowerCase().includes(query);
  });
  if (ui.sort === 'time') tabs.sort((a, b) => (b.foregroundMs || 0) - (a.foregroundMs || 0));
  else tabs.sort((a, b) => (b.lastAccessed || b.lastSeen || 0) - (a.lastAccessed || a.lastSeen || 0));
  return tabs;
}
function domainMark(tab, index) {
  const domain = tab.domain || domainOf(tab.url);
  return el('span', {class: 'domain-mark color-' + index % 5, 'aria-hidden': 'true'}, domain.replace(/^www\./, '').slice(0, 2));
}
function visitLabel(tab) {
  const time = tab.lastAccessed || tab.lastSeen;
  if (!time) return '暂无访问时间';
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
  const relative = minutes < 1 ? '刚刚' : minutes < 60 ? minutes + ' 分钟前' : minutes < 1440 ? Math.floor(minutes / 60) + ' 小时前' : dateLabel(time);
  return relative + (tab.lastAccessed ? '访问' : '记录');
}
function tabRow(tab, index) {
  const meta = [el('span', {class: 'domain-text'}, tab.domain || domainOf(tab.url))];
  if (tab.pinned) meta.push(el('span', {class: 'tag protected'}, '已固定'));
  else if (Number(tab.groupId) >= 0) meta.push(el('span', {class: 'tag protected'}, '已分组'));
  else meta.push(...tagsOf(tab).slice(0, 2).map((tag) => tagChip(tag)));
  return el('article', {class: 'tab-row' + (ui.selected.has(tab.id) ? ' selected' : '')},
    el('input', {id: 'tab-select-' + tab.id, type: 'checkbox', 'data-tab-select': tab.id, checked: ui.selected.has(tab.id), 'aria-label': '选择 ' + (tab.title || tab.domain)}),
    domainMark(tab, index), el('div', {class: 'tab-content'},
      el('button', {id: 'tab-title-' + tab.id, type: 'button', class: 'tab-title', 'data-action': 'focus-tab', 'data-id': tab.id, title: tab.title || tab.url}, tab.title || tab.domain || '未命名页面'),
      el('div', {class: 'tab-meta'}, meta),
      el('p', {class: 'tab-time', title: ui.sort === 'time' ? '最近 7 天已记录的前台停留' : tab.lastAccessed ? new Date(tab.lastAccessed).toLocaleString('zh-CN') : '浏览器未提供最近访问时间，使用本机记录（如有）'}, ui.sort === 'time' ? duration(tab.foregroundMs) + ' · 7 天前台' : visitLabel(tab))),
    iconButton('定位 ' + (tab.title || '页面'), 'focus-tab', 'arrow', {'data-id': tab.id}));
}
function proposalCard(group) {
  const tabs = group.tabIds.map(id => ui.state.tabs.find(tab => tab.id === id)).filter(Boolean);
  const selected = proposalMembers(group, ui.state.tabs, ui.members);
  const applied = ui.applied.has(group.id);
  const locked = busy('rules') || busy('semantic') || [...ui.busy].some(key => key.startsWith('group-')) || busy('undo');
  return el('article', {class: 'proposal', 'data-group-id': group.id},
    el('div', {class: 'proposal-title'}, el('span', {class: 'color-dot', style: {background: colorOf(group.color)}}), el('h3', {}, group.name || '相关页面'), el('small', {}, selected.size + ' / ' + tabs.length + ' 页')),
    el('p', {class: 'proposal-reason'}, group.reason || (group.method === 'semantic' ? '根据页面的语义关系生成建议。' : '根据标题与域名生成建议。')),
    el('div', {class: 'proposal-members'}, tabs.map(tab => el('label', {class: 'proposal-member'},
      el('input', {id: 'group-member-' + group.id + '-' + tab.id, type: 'checkbox', 'data-group-member': group.id, 'data-tab-id': tab.id, checked: selected.has(tab.id), disabled: locked}),
      el('span', {title: tab.title || tab.url}, tab.title || tab.url)))),
    el('div', {class: 'proposal-actions'},
      button('存为任务', 'save-group', {'data-id': group.id, disabled: !selected.size || locked}, 'small subtle', 'save'),
      button(busy('group-' + group.id) ? '正在应用…' : '应用分组', 'apply-group', {'data-id': group.id, disabled: applied || locked || selected.size < 2}, 'small primary', 'check')));
}
function groupingPanel() {
  const state = ui.state;
  return el('aside', {class: 'panel group-panel', 'aria-label': '分组建议'},
    el('div', {class: 'section-heading'}, el('h2', {id: 'grouping-title', tabindex: '-1'}, '整理建议'), button('撤销', 'undo-group', {id: 'undo-group', disabled: !ui.canUndo || busy('undo')}, 'small subtle', 'undo')),
    el('p', {class: 'panel-intro'}, '勾选要放在一起的页面，应用后才会分组。'),
    state.proposalNotice && el('p', {class: 'proposal-notice', role: 'status'}, state.proposalNotice),
    state.groups.length ? el('div', {class: 'proposal-list'}, state.groups.map(proposalCard)) :
      emptyState('还没有分组建议', '点击“生成分组建议”，为尚未分组、未固定的页面寻找共同主题。', null, null, true, 'layers'),
    el('div', {class: 'panel-bottom'},
      modelBar(),
      button(busy('semantic') ? '正在进行语义增强…' : '用本地语义再看一遍', 'semantic', {disabled: busy('semantic') || busy('rules') || !state.settings.semantic || state.tabs.filter(tab => !isProtected(tab)).length < 2}, 'full dark', busy('semantic') ? undefined : 'spark'),
      el('p', {}, !state.settings.semantic ? '语义增强已在设置中关闭。' : '在本机完成，不会发送页面内容。')));
}
function renderPages() {
  if(ui.pagesMode==='workspace')return[heading('跨窗口与收起','跨窗口查找，带着断点收起页面。',[button('返回整理页面','pages-mode',{'data-mode':'list'},'small')]),tabWorkspace.view()];
  const tabs = filteredTabs();
  const allSelected = tabs.length > 0 && tabs.every((tab) => ui.selected.has(tab.id));
  const selectedCount = ui.selected.size;
  const ungrouped = ui.state.tabs.filter((tab) => !isProtected(tab)).length;
  const filters = [['all', '全部 ' + ui.state.tabs.length], ['ungrouped', '待整理 ' + ungrouped], ['protected', '已保护 ' + (ui.state.tabs.length - ungrouped)]];
  return [
    heading('当前页面', '整理此刻的页面，留住下次继续的线索。', [
      button('跨窗口与收起','pages-mode',{'data-mode':'workspace'},'small','layers'),
      button(selectedCount ? '保存所选 · ' + selectedCount : '保存窗口 · ' + ui.state.tabs.length + ' 页', selectedCount ? 'save-selection' : 'save-window', {id: 'pages-save-task', disabled: ui.state.tabs.length === 0}, '', 'save'),
      button(busy('rules') ? '正在整理…' : '生成分组建议', 'propose', {id: 'generate-groups', disabled: busy('rules') || busy('semantic') || ungrouped < 2}, ui.state.groups.length ? '' : 'primary', 'layers')
    ]),
    !isPanel && statStrip(),
    isPanel && el('nav', {class: 'pages-views', 'aria-label': '页面管理视图'},
      button('页面列表', 'pages-mode', {id: 'pages-mode-list', 'data-mode': 'list', 'aria-pressed': ui.pagesMode === 'list'}),
      button('整理建议' + (ui.state.groups.length ? ' · ' + ui.state.groups.length : ''), 'pages-mode', {id: 'pages-mode-groups', 'data-mode': 'groups', 'aria-pressed': ui.pagesMode === 'groups'})),
    el('div', {class: 'two-column'},
      (!isPanel || ui.pagesMode === 'list') && el('section', {'aria-label': '当前窗口页面'},
        el('div', {class: 'section-heading'}, el('h2', {}, '打开的页面', el('small', {}, '当前窗口')), el('span', {}, dateLabel(Date.now()))),
        el('div', {class: 'list-tools'}, searchBox('pages', '搜索标题、站点或主题'), el('div', {class: 'filter-row'}, filters.map(([filter, label]) => el('button', {id: 'page-filter-' + filter, type: 'button', class: 'filter-button' + (ui.pageFilter === filter ? ' active' : ''), 'data-action': 'page-filter', 'data-filter': filter, 'aria-pressed': ui.pageFilter === filter}, label)))),
        el('div', {class: 'select-toolbar'},
          el('label', {class: 'checkbox-label'}, el('input', {type: 'checkbox', id: 'select-all', checked: allSelected, disabled: !tabs.length, 'aria-label': '选择当前列表全部页面'}), selectedCount ? '已选 ' + selectedCount + ' 页' : '选择页面'),
          el('span', {class: 'spacer'}),
          el('select', {class: 'text-select', id: 'page-sort', 'aria-label': '列表排序', 'aria-describedby': 'sort-caption'}, el('option', {value: 'recent', selected: ui.sort === 'recent'}, '最近访问优先'), el('option', {value: 'time', selected: ui.sort === 'time'}, '前台停留优先'))),
        el('p', {class: 'sort-caption', id: 'sort-caption'}, ui.sort === 'time' ? '仅排序此列表 · 停留统计最近 7 天' : '仅排序此列表 · 缺少访问时间时使用本机记录'),
        el('div', {class: 'tab-list'}, tabs.length ? tabs.map(tabRow) : emptyState(ui.queries.pages || ui.pageFilter !== 'all' ? '没有匹配的页面' : '这里还没有页面', ui.queries.pages || ui.pageFilter !== 'all' ? '换一个关键词或筛选条件试试。' : '在这个窗口打开几个网页，刷新后就可以开始整理。', null, null, false)),
        el('p', {class: 'list-footnote'}, '已固定和已有分组的页面会受到保护。前台时长不等于实际注意力。')),
      (!isPanel || ui.pagesMode === 'groups') && groupingPanel())
  ];
}
function taskCard(task, {featured = false} = {}) {
  const pages = task.pages || [], preview = task.restorePreview || {reused: 0, willOpen: pages.length};
  return el('article', {class: 'task-card' + (featured ? ' featured' : '')},
    el('div', {class: 'task-card-head'},
      el('h3', {class: 'task-name'}, task.name),
      iconButton('编辑 ' + task.name, 'edit-task', 'edit', {'data-id': task.id})),
    task.resumePage && el('div', {class: 'resume-context'}, icon('page'),
      el('button', {id: 'resume-page-' + encodeURIComponent(task.id), type: 'button', class: 'resume-page-link', title: task.resumePage.title || task.resumePage.url, 'data-action': 'open-page', 'data-url': task.resumePage.url}, task.resumePage.title || domainOf(task.resumePage.url))),
    task.lastRestoreResult?.failedCount > 0 && el('p', {class: 'restore-warning'}, '上次有 ' + task.lastRestoreResult.failedCount + ' 页未恢复，可以重试。'),
    el('div', {class: 'task-footer'},
      el('div', {class: 'task-count'}, el('span', {}, '复用 ' + preview.reused + ' 页 · 新开 ' + preview.willOpen + ' 页'),
        el('span', {class: 'task-date'}, dateLabel(task.lastActivityAt || task.updatedAt || task.createdAt))),
      button(busy('restore-' + task.id) ? '恢复中…' : '恢复保存页', 'restore-task', {'data-id': task.id, disabled: !pages.length || (task.status&&task.status!=='active') || busy('restore-' + task.id)}, 'small' + (featured ? ' primary' : ''), 'arrow')),
    taskPages(task, ui.expandedPages.has(task.id), busy('restore-' + task.id)),
    task.notes ? taskNotes(task, ui.expandedNotes.has(task.id)) : button('添加笔记', 'edit-task', {'data-id': task.id}, 'text-button'), memory.taskActions(task));
}
function renderTasks() {
  const query = ui.queries.tasks.trim().toLocaleLowerCase();
  const tasks = memory.filterTasks(ui.state.tasks).filter(task => !query || [task.name, task.goal, task.notes, ...(task.pages || []).map(page => page.title)].join(' ').toLocaleLowerCase().includes(query));
  return [
    heading(isPanel ? '任务' : '任务工作台', '保存下一步，回到正在做的事。', [
      button('新建任务', 'new-task', {id: 'task-create'}, isPanel ? 'small' : '', 'plus'),
      button(isPanel ? '保存窗口' : '保存当前窗口', 'save-window', {id: 'task-save-window', disabled: !ui.state.tabs.length}, isPanel ? 'small' : '', 'plus')]),
    memory.current({support: isPanel}),
    el('div', {class: 'list-tools tasks-tools'}, searchBox('tasks', '搜索任务或页面'), memory.taskFilter(), el('span', {class: 'subtle-label'}, tasks.length + ' 个任务')),
    tasks.length ? el('section', {class: 'task-grid', 'aria-label': '已保存任务'}, tasks.map((task, index) => taskCard(task, {featured: index === 0}))) :
      emptyState(query ? '没有找到这个任务' : '保存一件正在做的事', query ? '试试任务名、备注或页面标题。' : '选择相关页面，再写下一步。回来时就能继续。', query ? null : 'nav-pages', '去选择页面', false, 'folder'),
    !isPanel && continuationSuggestions(),
    el('p', {class: 'list-footnote'}, '优先复用已打开页面，每个任务最多保存 30 页。')
  ];
}
function rangeControl(id) {
  return el('select', {id, class: 'standard-select', 'aria-label': '时间范围', 'data-range-control': 'true', disabled: busy('range')},
    [['today', '今天'], ['yesterday', '昨天'], ['week', '最近 7 天']].map(([value, label]) => el('option', {value, selected: (ui.pendingRange || ui.range) === value}, label)));
}
function renderReview() {
  if (ui.pendingRange) return [heading('一周回顾', '回看最近 7 天的浏览路径。'), rangeLoading()];
  const attention = ui.state.attention;
  const summary = attention.summary || {}, daily = attention.daily || [];
  const maximum = Math.max(1, ...daily.map(day => day.foregroundMs));
  const bounds = attention.range;
  const span = bounds.startedAt ? dateLabel(bounds.startedAt) + ' — ' + dateLabel(bounds.endedAt) : '最近 7 天';
  const edge = normalizedTransitions()[0];
  return [
    heading('一周回顾', span, [button('刷新记录', 'flush-refresh', {disabled: busy('flush')}, 'small', 'refresh')]),
    el('section', {class: 'review-overview', 'aria-label': '七天浏览概况'},
      [['前台停留', duration(summary.foregroundMs)], ['访问页面', (summary.pages || 0) + ' 页'], ['页面切换', (summary.switches || 0) + ' 次'], ['有记录', (summary.activeDays || 0) + ' 天']].map(([label, value]) =>
        el('div', {class: 'review-stat'}, el('strong', {}, value), el('span', {}, label)))),
    el('div', {class: 'review-columns'},
      el('section', {class: 'review-topics'}, el('div', {class: 'section-heading'}, el('h2', {}, '时间流向了哪些主题'), button('地图', 'review-map', {}, 'small subtle', 'nodes')),
        attention.nodes.length ? tagBars(attention.nodes) : emptyState('从一次浏览开始', '正常浏览网页后，这里会留下实际记录。', 'nav-pages', '查看页面', true, 'clock'),
        el('p', {class: 'review-caption'}, '按前台停留排序；同一页面的时长在多个主题间均分。'),
        edge && el('button', {class: 'review-connection', type: 'button', 'data-action': 'review-map'}, icon('nodes'), el('span', {}, el('strong', {}, edge.from), icon('arrow'), el('strong', {}, edge.to)), el('small', {}, edge.count + ' 次接续'), icon('chevron'))),
      el('section', {class: 'review-resume'}, el('div', {class: 'section-heading'}, el('h2', {}, '下次，从这里继续'), button('全部任务', 'review-tasks', {}, 'small subtle', 'arrow')),
        ui.state.tasks.length ? ui.state.tasks.slice(0, 2).map((task, index) => taskCard(task, {featured: index === 0})) : emptyState('还没有保存的任务', '选一组相关页面，留下一句接下来要做什么。', 'nav-pages', '去保存任务', true, 'folder'))),
    el('section', {class: 'review-daily'},
      el('div', {class: 'section-heading'}, el('h2', {}, '每天的前台停留'), el('span', {}, '同一基线 · 分钟')),
      el('div', {class: 'daily-chart', role: 'img', 'aria-label': '最近七天逐日前台停留：' + daily.map(day => dateLabel(day.startedAt) + duration(day.foregroundMs)).join('，')},
        daily.map(day => el('div', {class: 'day-column', title: dateLabel(day.startedAt) + ' · ' + duration(day.foregroundMs)},
          el('span', {class: 'day-value'}, Math.round(day.foregroundMs / 60000)),
          el('div', {class: 'day-track'}, el('div', {class: 'day-fill', style: {height: (day.foregroundMs / maximum * 100) + '%'}})),
          el('span', {class: 'day-label'}, new Date(day.startedAt).toLocaleDateString('zh-CN', {weekday: 'short'})),
          el('span', {class: 'day-date'}, new Date(day.startedAt).toLocaleDateString('zh-CN', {month: 'numeric', day: 'numeric'})))))),
    memory.patterns(),
    el('p', {class: 'list-footnote'}, '前台停留不等于实际注意力。以上来自访问记录，不判断工作是否完成。')
  ];
}
function continuationSuggestions() {
  const suggestions = ui.state.suggestions.filter((suggestion) => /^https?:\/\//.test(suggestion.url || '')).slice(0, 3);
  if (!suggestions.length) return null;
  return el('section', {class: 'continuation', 'aria-label': '继续浏览的线索'},
    el('div', {class: 'section-heading'}, el('h2', {}, '继续的线索'), el('span', {}, '由最近记录生成，按需选择')),
    suggestions.map((suggestion) => el('article', {class: 'continuation-row'},
      el('span', {class: 'continuation-icon'}, icon(suggestion.method === 'task' ? 'folder' : 'page')),
      el('div', {class: 'continuation-copy'},
        el('h3', {}, suggestion.title || domainOf(suggestion.url)),
        el('p', {}, suggestion.reason || (suggestion.method === 'task' ? '来自你手动保留的任务。' : '来自最近访问过的页面。'))),
      button('继续看看', 'open-page', {'data-url': suggestion.url}, 'small subtle', 'arrow'))));
}
function tagStats(segments) {
  const entries = new Map();
  for (const segment of segments) {
    if (segment.status !== 'active') continue;
    const tags = tagsOf(segment).length ? tagsOf(segment) : ['未分类'];
    for (const tag of tags) {
      const entry = entries.get(tag) || {tag, foregroundMs: 0, visits: 0};
      entry.foregroundMs += (Number(segment.foregroundMs) || 0) / tags.length;
      entry.visits++;
      entries.set(tag, entry);
    }
  }
  return [...entries.values()].sort((a, b) => b.foregroundMs - a.foregroundMs);
}
function visibleSegments() {
  return ui.state.segments.filter(segment => {
    if (ui.timelineStatus !== 'all' && segment.status !== ui.timelineStatus) return false;
    return !ui.timelineTag || tagsOf(segment).includes(ui.timelineTag);
  }).sort((a, b) => b.startedAt - a.startedAt);
}
function timelineEntry(segment) {
  const statusLabel = {active: '前台停留', idle: '暂离', unknown: '记录缺口'}[segment.status] || '未知状态';
  const elapsed = duration(segment.status === 'active' ? segment.foregroundMs : segment.endedAt - segment.startedAt, true);
  const id = encodeURIComponent(segment.id), expanded = ui.expandedSegments.has(segment.id);
  return el('article', {class: 'timeline-entry ' + segment.status},
    el('div', {class: 'timeline-clock'}, timeLabel(segment.startedAt)),
    el('div', {class: 'timeline-track'}, el('span', {class: 'timeline-point'})),
    el('div', {class: 'timeline-content'},
      el('div', {class: 'timeline-title-row'},
        el('button', {id: 'timeline-page-' + id, type: 'button', class: 'timeline-title', 'data-action': 'open-page', 'data-url': segment.url, disabled: !/^https?:\/\//.test(segment.url || '')}, segment.title || domainOf(segment.url)),
        !isPanel && el('span', {class: 'timeline-duration'}, elapsed)),
      el('div', {class: 'timeline-meta'},
        isPanel && el('span', {class: 'timeline-duration'}, elapsed),
        segment.status !== 'active' && el('span', {class: 'timeline-status'}, statusLabel),
        tagsOf(segment).slice(0, 3).map((tag, index) => tagChip(tag, 'timeline-tag', {id: 'timeline-tag-' + id + '-' + index})),
        el('button', {id: 'segment-toggle-' + id, class: 'timeline-details-toggle', type: 'button', 'data-action': 'toggle-segment-details', 'data-id': segment.id, 'aria-expanded': expanded, 'aria-controls': 'segment-details-' + id, 'aria-label': (expanded ? '收起' : '查看') + '时间详情：' + (segment.title || statusLabel)}, icon('info'))),
      el('p', {id: 'segment-details-' + id, class: 'timeline-details', hidden: !expanded}, timeLabel(segment.startedAt) + '–' + timeLabel(segment.endedAt) + ' · ' + statusLabel)));
}
function tagBars(entries) {
  const maximum = Math.max(1, ...entries.map((entry) => entry.foregroundMs));
  return entries.slice(0, 7).map((entry) => el('div', {class: 'tag-bar-row'},
    el('div', {class: 'tag-bar-label'}, el('button', {type: 'button', 'data-action': 'timeline-tag', 'data-tag': entry.tag}, entry.tag), el('span', {}, duration(entry.foregroundMs))),
    el('div', {class: 'bar-track'}, el('div', {class: 'bar-value', style: {width: entry.foregroundMs / maximum * 100 + '%'}}))));
}
function renderTimeline() {
  const header = heading('访问路径', '回到当时看过的页面。', [rangeControl('timeline-range'), iconButton('刷新记录', 'flush-refresh', 'refresh', {disabled: busy('flush') || busy('range')})]);
  if (ui.pendingRange) return [header, rangeLoading()];
  const segments = visibleSegments();
  const displayed = segments.slice(0, ui.timelineLimit);
  const timeline = [];
  let previousDay;
  for (const segment of displayed) {
    const day = dayKey(segment.startedAt);
    if (day !== previousDay) { timeline.push(el('h3', {class: 'timeline-day'}, dateLabel(segment.startedAt))); previousDay = day; }
    timeline.push(timelineEntry(segment));
  }
  const summary = !['all', 'active'].includes(ui.timelineStatus) ? [] : ui.timelineTag
    ? ui.state.attention.nodes.filter(entry => entry.tag === ui.timelineTag) : ui.state.attention.nodes;
  const empty = ui.state.segments.length && (ui.timelineTag || ui.timelineStatus !== 'all')
    ? emptyState('没有符合筛选的记录', '这个范围内有其他记录，可以清除主题和状态筛选后查看。', 'clear-timeline-filters', '查看全部记录', false, 'clock')
    : !ui.state.settings.tracking
      ? emptyState('浏览记录已暂停', isPanel ? '点击顶部的恢复按钮，或在这里恢复记录。已有任务仍可继续。' : '恢复后会继续记录前台浏览，已有历史仍会保留。', 'toggle-tracking', '恢复记录', false, 'clock')
      : emptyState('这段时间还没有记录', '正常浏览网页后，返回这里刷新。暂离与未知时段会单独显示。', null, null, false, 'clock');
  return [
    header,
    ui.state.timelineTruncated && el('p', {class: 'panel-intro'}, '这里展示所选范围内最新 2,000 条记录，图表使用该范围的完整记录。更早的历史可在设置中导出。'),
    el('div', {class: 'timeline-tools'},
      el('div', {class: 'filter-row'}, [['all', '全部记录'], ['active', '前台'], ['idle', '暂离'], ['unknown', '未知']].map(([value, label]) => el('button', {id: 'timeline-filter-' + value, type: 'button', class: 'filter-button' + (ui.timelineStatus === value ? ' active' : ''), 'data-action': 'timeline-status', 'data-status': value, 'aria-pressed': ui.timelineStatus === value}, label)))),
    ui.timelineTag && el('div', {class: 'selected-tag-banner'}, '正在回看：' + ui.timelineTag, iconButton('取消主题筛选', 'clear-timeline-tag', 'close')),
    el('div', {class: 'timeline-layout'},
      el('section', {'aria-label': '浏览访问时间线'}, timeline.length ? timeline : empty,
        segments.length > displayed.length && button('再显示 60 条', 'timeline-more', {}, 'full')),
      el('aside', {class: 'insight-aside'}, el('h3', {}, '这段时间，停留在哪里'), summary.length ? tagBars(summary) : el('p', {class: 'subtle-label'}, '有前台记录后显示主题分布。'),
        el('p', {class: 'insight-note'}, '前台时长不等于实际注意力。', el('br'), '同一页面的时长在多个主题之间分摊，避免重复累计。')))
  ];
}
function normalizedTransitions() {
  return ui.state.transitions.filter((edge) => typeof edge.from === 'string' && typeof edge.to === 'string' && edge.from !== edge.to && Number(edge.count) > 0).map((edge) => ({
    ...edge, count: Number(edge.count), probability: Math.max(0, Math.min(1, Number(edge.probability) || 0))
  })).sort((a, b) => b.count - a.count);
}
function mapData() {
  const entries = ui.state.attention.nodes.map(entry => ({...entry}));
  const edges = normalizedTransitions();
  for (const edge of edges) {
    for (const tag of [edge.from, edge.to]) if (!entries.some((entry) => entry.tag === tag)) entries.push({tag, foregroundMs: 0, visits: 0});
  }
  return {entries: entries.sort((a, b) => b.foregroundMs - a.foregroundMs), edges};
}
let mapResizeObserver;
function mapNode(node, role = '') {
  return el('button', {id: 'map-node-' + encodeURIComponent(node.tag) + (role ? '-' + role : ''), type: 'button', class: 'graph-node' + (ui.selectedTag === node.tag ? ' selected' : ''), 'data-action': 'select-tag', 'data-tag': node.tag, 'data-map-role': role, 'aria-pressed': ui.selectedTag === node.tag, 'aria-label': node.tag + '，分摊前台时长 ' + duration(node.foregroundMs)},
    el('span', {class: 'graph-node-name'}, node.tag), el('span', {class: 'graph-node-time'}, duration(node.foregroundMs)));
}
function branchConnector(count, before) {
  const arrowId = 'local-arrow-' + (before ? 'before' : 'after');
  const ends = count === 1 ? [100] : [50, 150];
  return svgEl('svg', {class: 'local-branches', viewBox: '0 0 200 28', preserveAspectRatio: 'none', 'aria-hidden': 'true'},
    svgEl('defs', {}, svgEl('marker', {id: arrowId, viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 5, markerHeight: 5, orient: 'auto'}, svgEl('path', {d: 'M1 1L7 4L1 7', fill: 'none', stroke: '#73859d', 'stroke-width': 1.2}))),
    ends.map(x => svgEl('path', {d: before ? 'M' + x + ',0V10Q' + x + ',14 ' + (x + (100 - x) / 2) + ',14H100V26' : 'M100,0V10H' + x + 'V26', fill: 'none', stroke: '#8190a5', 'stroke-width': 1.2, 'vector-effect': 'non-scaling-stroke', 'marker-end': 'url(#' + arrowId + ')'})));
}
function lightGraph(topology) {
  const local = localNeighborhood(topology, ui.selectedTag, ui.selectedEdge);
  const neighbors = (edges, before) => el('div', {class: 'local-flow-row', style: {'--neighbor-count': edges.length}}, edges.map(edge => {
    const tag = before ? edge.from : edge.to, node = topology.nodes.find(item => item.tag === tag);
    return el('div', {class: 'neighbor-node'}, mapNode(node, before ? 'before' : 'after'),
      el('button', {id: 'map-edge-' + encodeURIComponent(JSON.stringify([edge.from, edge.to])), type: 'button', class: 'neighbor-edge edge-control' + (ui.selectedEdge === edge.from + '\u0000' + edge.to ? ' selected' : ''), 'aria-pressed': ui.selectedEdge === edge.from + '\u0000' + edge.to, 'data-action': 'select-edge', 'data-from': edge.from, 'data-to': edge.to, 'aria-label': '查看' + edge.from + ' 到 ' + edge.to + '的 ' + edge.count + ' 次切换'}, edge.count + ' 次', icon('chevron')));
  }));
  return el('div', {class: 'local-map', role: 'group', 'aria-label': '选中主题的前后访问关系，箭头向下'},
    el('label', {class: 'map-topic-choice'}, el('span', {}, '查看主题'), el('select', {id: 'map-topic-choice', class: 'standard-select'}, topology.nodes.map(node => el('option', {value: node.tag, selected: node.tag === ui.selectedTag}, node.tag)))),
    local.before.length > 0 && el('div', {class: 'local-before'}, el('p', {class: 'flow-label'}, '之前访问'), neighbors(local.before, true), branchConnector(local.before.length, true)),
    el('div', {class: 'local-center'}, mapNode(local.node, 'center')),
    local.after.length > 0 && el('div', {class: 'local-after'}, branchConnector(local.after.length, false), el('p', {class: 'flow-label'}, '接着访问'), neighbors(local.after, false)),
    local.relatedCount === 0 && el('p', {class: 'map-footnote'}, '这个主题还没有有效的前后切换记录。'),
    local.hiddenCount > 0 && el('div', {class: 'map-more'}, el('p', {class: 'map-footnote'}, '另有 ' + local.hiddenCount + ' 条关系未展开。'), button('查看完整地图', 'open-full-map', {}, 'small subtle', 'external')));
}
function graph(entries, edges) {
  const topology = mapTopology(entries, edges);
  if (isPanel) return lightGraph(topology);
  const wire = svgEl('svg', {class: 'graph-wires', role: 'group', 'aria-label': '主题访问先后连线。可用 Tab 选择连线查看次数与证据。'});
  const lane = (label, nodes, role) => el('div', {class: 'map-lane ' + role}, el('h3', {class: 'map-lane-heading'}, label), nodes.map(node => mapNode(node, role)));
  const board = el('div', {class: 'graph-board'}, wire, lane('先访问', topology.sources, 'source'), el('div', {class: 'map-lane-gap', 'aria-hidden': 'true'}), lane('接着访问', topology.targets, 'target'));
  const wrapper = el('div', {class: 'graph-container'},
    edges.length > 0 && el('div', {class: 'graph-scroll'}, board),
    topology.isolated.length > 0 && el('div', {class: 'isolated-topics'}, el('h3', {}, '尚无跨主题接续'), el('div', {class: 'isolated-list'}, topology.isolated.map(node => mapNode(node, 'isolated')))));
  const draw = () => {
    if (!board.isConnected) return;
    const rect = board.getBoundingClientRect();
    wire.setAttribute('viewBox', '0 0 ' + rect.width + ' ' + rect.height);
    wire.replaceChildren(svgEl('defs', {}, ['normal', 'active'].map(name => svgEl('marker', {id: 'map-arrow-' + name, viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 5, markerHeight: 5, orient: 'auto', markerUnits: 'userSpaceOnUse'}, svgEl('path', {d: 'M1 1L7 4L1 7', fill: 'none', stroke: name === 'active' ? '#2d63cf' : '#8a99af', 'stroke-width': 1.3})))));
    const positions = new Map([...board.querySelectorAll('.graph-node')].map(node => {
      const box = node.getBoundingClientRect();
      return [node.dataset.mapRole + '\u0000' + node.dataset.tag, {x: box.left - rect.left, y: box.top - rect.top + box.height / 2, width: box.width}];
    }));
    const maximum = Math.max(1, ...edges.map(edge => edge.count));
    const shown = ui.mapScope === 'all' ? edges : edges.filter(edge => edge.from === ui.selectedTag || edge.to === ui.selectedTag);
    const sorted = shown.slice().sort((a, b) => Number(a.from + '\u0000' + a.to === ui.selectedEdge) - Number(b.from + '\u0000' + b.to === ui.selectedEdge));
    for (const edge of sorted) {
      const from = positions.get('source\u0000' + edge.from), to = positions.get('target\u0000' + edge.to);
      if (!from || !to) continue;
      const x1 = from.x + from.width + 2, x2 = to.x - 4, gap = (x2 - x1) * .45;
      const path = 'M' + x1 + ',' + from.y + 'C' + (x1 + gap) + ',' + from.y + ' ' + (x2 - gap) + ',' + to.y + ' ' + x2 + ',' + to.y;
      const selected = ui.selectedEdge === edge.from + '\u0000' + edge.to;
      const related = selected || (!ui.selectedEdge && (edge.from === ui.selectedTag || edge.to === ui.selectedTag));
      const group = svgEl('g', {id: 'map-edge-' + encodeURIComponent(JSON.stringify([edge.from, edge.to])), class: 'edge-control' + (related ? ' related' : '') + (selected ? ' selected' : ''), role: 'button', tabindex: 0, 'data-action': 'select-edge', 'data-from': edge.from, 'data-to': edge.to, 'aria-pressed': selected, 'aria-label': edge.from + ' 到 ' + edge.to + '，观察到 ' + edge.count + ' 次切换'},
        svgEl('path', {d: path, class: 'edge-hit'}),
        svgEl('path', {d: path, class: 'graph-edge', 'stroke-width': selected ? 2.5 : 1 + edge.count / maximum, 'marker-end': 'url(#map-arrow-' + (related ? 'active' : 'normal') + ')'}),
        svgEl('title', {}, edge.from + ' → ' + edge.to + ' · ' + edge.count + ' 次'));
      if (selected || ui.mapScope === 'related') {
        const labelX = edge.from === ui.selectedTag ? x2 - 24 : x1 + 24;
        const labelY = (edge.from === ui.selectedTag ? to.y : from.y) - 8;
        group.append(svgEl('g', {'pointer-events': 'all'}, svgEl('rect', {x: labelX - 18, y: labelY - 11, width: 36, height: 21, rx: 4, fill: '#fff'}), svgEl('text', {x: labelX, y: labelY + 4, class: 'edge-count'}, edge.count + ' 次')));
      }
      wire.append(group);
    }
  };
  requestAnimationFrame(() => {
    if (!board.isConnected) return;
    draw(); mapResizeObserver = new ResizeObserver(draw); mapResizeObserver.observe(board);
    for (const node of board.querySelectorAll('.graph-node')) mapResizeObserver.observe(node);
  });
  return wrapper;
}
function mapDetail(entries, edges) {
  const selected = entries.find(entry => entry.tag === ui.selectedTag) || entries[0];
  if (!selected) return null;
  const edge = edges.find(item => item.from + '\u0000' + item.to === ui.selectedEdge);
  const next = edges.filter(item => item.from === selected.tag).slice(0, 4);
  return el('aside', {class: 'map-detail', 'aria-label': '选中关系的详情'},
    !isPanel && el('div', {class: 'map-detail-heading'}, el('h2', {}, selected.tag), el('span', {}, duration(selected.foregroundMs))),
    !isPanel && !edge && el('div', {class: 'next-links'}, el('h3', {}, '曾经接着去'), next.length ? next.map(item => el('button', {type: 'button', class: 'next-link', 'data-action': 'select-edge', 'data-from': item.from, 'data-to': item.to}, item.to, el('span', {}, item.count + ' 次'), icon('chevron'))) : el('p', {class: 'subtle-label'}, '还没有观察到后续切换。')),
    edge ? el('div', {class: 'selected-relation'},
      el('h3', {}, edge.from, icon('arrow'), edge.to),
      el('p', {class: 'relation-count'}, '观察到 ' + edge.count + ' 次' + (edge.count < 5 ? ' · 样本较少' : '')),
      edge.examples?.length > 0 && el('div', {class: 'edge-examples'}, edge.examples.map(example => el('div', {class: 'edge-example'},
        el('span', {}, dateLabel(example.at) + ' ' + timeLabel(example.at)),
        el('button', {type: 'button', 'data-action': 'open-page', 'data-url': example.fromUrl}, example.fromTitle || domainOf(example.fromUrl)),
        icon('arrow'),
        el('button', {type: 'button', 'data-action': 'open-page', 'data-url': example.toUrl}, example.toTitle || domainOf(example.toUrl))))))
      : edges.some(item => item.from === selected.tag || item.to === selected.tag) && el('p', {class: 'panel-intro'}, isPanel ? '点选次数按钮，查看发生在何时、哪些页面。' : '点选次数或连线，查看发生在何时、哪些页面。'),
    button('在路径中回看', 'tag-timeline', {'data-tag': selected.tag}, 'small subtle', 'clock'));
}
function transitionTable(edges) {
  return el('div', {class: 'table-scroll'}, el('table', {class: 'transition-table'},
    el('thead', {}, el('tr', {}, ['从这个主题', '接着去', '观察次数', '占该主题后续切换'].map((label) => el('th', {scope: 'col'}, label)))),
    el('tbody', {}, edges.map((edge) => el('tr', {},
      el('td', {}, el('button', {type: 'button', 'data-action': 'select-tag', 'data-tag': edge.from}, edge.from)),
      el('td', {}, el('button', {type: 'button', 'data-action': 'select-tag', 'data-tag': edge.to}, edge.to)),
      el('td', {}, edge.count + ' 次'), el('td', {}, Math.round(edge.probability * 100) + '%' + (edge.count < 5 ? ' · 样本较少' : '')))))));
}
function renderMap() {
  const header = heading(isPanel ? '主题地图' : '注意力地图', '从真实访问的先后关系，回到当时的页面。', [rangeControl('map-range'), isPanel ? iconButton('展开完整地图', 'open-full-map', 'external', {disabled: busy('range')}) : iconButton('刷新记录', 'flush-refresh', 'refresh', {disabled: busy('flush') || busy('range')})]);
  if (ui.pendingRange) return [header, rangeLoading()];
  const {entries, edges} = mapData();
  const context = resolveMapContext(entries, edges, ui.selectedTag, ui.selectedEdge);
  if (context.invalidTopic || context.invalidRelation) ui.mapNotice = !entries.length ? '这个范围内没有所选对象的记录，可以更换时间范围。' : context.invalidTopic ? '所选主题在这个范围内没有记录，已显示可用主题。' : '所选关系在这个范围内没有记录，已保留当前主题。';
  ui.selectedTag = context.topic; ui.selectedEdge = context.relation;
  const relatedCount = edges.filter(edge => edge.from === ui.selectedTag || edge.to === ui.selectedTag).length;
  return [
    header,
    ui.mapNotice && el('p', {class: 'map-context-notice', role: 'status'}, ui.mapNotice),
    el('p', {class: 'map-summary'}, entries.length + ' 个主题 · ' + edges.length + ' 条已观察关系'),
    !isPanel && edges.length > 0 && el('div', {class: 'map-visibility'},
      el('div', {class: 'filter-row', 'aria-label': '地图显示范围'}, [['related', '选中主题'], ['all', '全部关系']].map(([scope, label]) => el('button', {id: 'map-scope-' + scope, type: 'button', class: 'filter-button' + (ui.mapScope === scope ? ' active' : ''), 'data-action': 'map-scope', 'data-scope': scope, 'aria-pressed': ui.mapScope === scope}, label))),
      el('span', {}, ui.mapScope === 'all' ? '显示全部 ' + edges.length + ' 条连线' : '显示 ' + relatedCount + ' 条直接关联，全部主题位置保持不变')),
    el('div', {class: 'map-layout'}, el('section', {class: 'map-panel', 'aria-label': '主题切换关系'},
      entries.length ? graph(entries, edges) : emptyState('从一次浏览开始', '正常浏览网页后，再回来查看访问关系。', null, null, false, 'nodes'),
      el('p', {class: 'map-footnote'}, isPanel ? '箭头向下表示访问先后；次数来自实际记录。' : '左列为先访问、右列为接着访问，按该方向的切换次数排序。线宽表示次数，位置不表示语义距离，主题大小不编码时长。完整关系始终保留在下表。')),
      mapDetail(entries, edges)),
    !isPanel && el('section', {class: 'transition-section'}, el('div', {class: 'section-heading'}, el('h2', {}, '完整关系'), el('span', {}, edges.length + ' 条关系')),
      edges.length ? transitionTable(edges) : el('p', {class: 'panel-intro'}, '暂离与未知时段不会被连接成主题关系。')),
    !isPanel && el('p', {class: 'list-footnote'}, '占比基于已观察的后续切换，不代表未来会发生。')
  ];
}
function settingRow(title, description, control) {
  return el('div', {class: 'setting-row'}, el('div', {class: 'setting-text'}, el('h3', {}, title), el('p', {}, description)), control);
}
function toggle(id, checked, label) {
  return el('label', {class: 'toggle'}, el('input', {type: 'checkbox', id, checked, 'aria-label': label}), el('span', {class: 'toggle-track', 'aria-hidden': 'true'}));
}
function selectOptions(id, value, options, label) {
  return el('select', {id, class: 'standard-select', 'aria-label': label}, options.map(([key, text]) => el('option', {value: key, selected: String(key) === String(value)}, text)));
}
function renderSettings() {
  const settings = ui.settingsDraft || ui.state.settings;
  return [
    heading('设置', '按你的节奏记录，由你决定保留什么。'),
    backupUI.view(),
    el('div', {class: 'settings-layout'},
      el('section', {class: 'settings-section'}, el('h2', {}, '浏览记录'),
        settingRow('记录前台浏览', '记录页面的前台停留与切换。暂停后不会新增浏览片段，已有记录仍会保留。', toggle('setting-tracking', settings.tracking, '记录前台浏览')),
        settingRow('暂离判断', '连续没有设备活动时，后续时间单独标记为暂离，不计入前台时长。', selectOptions('setting-idle', settings.idleSeconds, [[60, '1 分钟'], [120, '2 分钟'], [300, '5 分钟'], [600, '10 分钟']], '暂离判断时间')),
        settingRow('历史保留时间', '到期的浏览历史会清理，手动保存的任务会继续保留。', selectOptions('setting-retention', settings.retentionDays, [[7, '7 天'], [30, '30 天'], [90, '90 天'], [365, '365 天']], '历史保留时间')),
        el('div', {class: 'field exclusion-field'}, el('label', {for: 'setting-excluded'}, '不记录这些站点'), el('textarea', {id: 'setting-excluded', placeholder: '例如：bank.example.com\n每行一个域名', rows: 3}, (settings.excludedDomains || []).join('\n')), el('p', {class: 'field-help'}, '每行一个域名，或用逗号分隔。隐身页面默认不记录。'))),
      el('section', {class: 'settings-section'}, el('h2', {}, '本地智能'),
        settingRow('启用语义增强', '用本机模型补充页面分组、任务关联和资料查找。关闭后仍可使用规则与关键词。', toggle('setting-semantic', settings.semantic, '启用本地语义增强')),
        settingRow('低频返回提示', '仅在侧栏显示。连续 5 分钟、至少 2 个已确认的其他页面才会提示；每天最多 3 次。', toggle('setting-focus-support', settings.focusSupport, '启用低频返回提示')),
        settingRow('模型状态', ui.state.model.name || 'BGE-small-zh-v1.5 · 本地语义模型', button(busy('warmup') ? '正在准备…' : ui.state.model.status === 'ready' ? '模型已就绪' : '准备本地模型', 'warmup', {disabled: busy('warmup') || ui.state.model.status === 'ready'}, 'small', 'spark')),
        modelBar(),
        el('div', {class: 'settings-save'}, button(busy('settings') ? '正在保存…' : '保存设置', 'save-settings', {disabled: busy('settings')}, 'primary', 'check'), el('span', {id: 'settings-save-status'}, ui.settingsDirty ? '有尚未保存的更改。' : '所有分析均在本机完成，无需 API 密钥。'))),
      el('section', {class: 'settings-section'}, el('h2', {}, '数据与迁移'),
        settingRow('导出本机数据', '导出页面、任务、访问片段与设置为 JSON，便于备份和后续分析。', button('导出数据', 'export', {disabled: busy('export')}, 'small', 'download'))),
      el('section', {class: 'settings-section danger-section'}, el('h2', {}, '清理本机数据'),
        settingRow('清除浏览历史', '删除访问片段、自动线索、提示记录与内部恢复前快照；保留任务、确认断点及手工关联。', button('清除历史', 'clear-history', {}, 'small danger')),
        settingRow('清除关联记忆', '清除全部任务的相关和不相关判断，保留任务、断点及保存的页面。无法撤销。', button('清除关联记忆', 'clear-relations', {}, 'small danger')),
        settingRow('清除全部数据', '删除浏览历史、保存的任务并重置设置。不会关闭浏览器页面。这个操作无法撤销。', button('清除全部', 'clear-all', {}, 'small danger'))))
  ];
}
function render() {
  if (!document.getElementById('navigation')) return;
  const focused = document.activeElement;
  const focusId = focused?.id;
  const hadMainFocus = document.getElementById('main')?.contains(focused);
  const rowIndex = [...document.querySelectorAll('.tab-row')].indexOf(focused?.closest('.tab-row'));
  const wasProposal = Boolean(focused?.closest('.proposal'));
  const memberScroll = [...document.querySelectorAll('.task-pages')].map(list => [list.id, list.scrollTop]);
  const selection = focused && 'selectionStart' in focused ? {start: focused.selectionStart, end: focused.selectionEnd} : null;
  renderNavigation();
  const main = document.getElementById('main');
  const mapScroll = main.querySelector('.graph-scroll')?.scrollTop;
  const content = [];
  if (isDemo) content.push(el('div', {class: 'demo-banner'}, icon('info'), el('p', {}, '示例数据，仅用于演示')));
  if (ui.error) content.push(el('div', {class: 'alert', role: 'alert'}, el('p', {}, ui.error), button(ui.failedRange && ui.failedRange !== ui.range ? '重试' + rangeName(ui.failedRange) : '重新连接', 'refresh', {}, 'small', 'refresh')));
  if (!ui.state) {
    if (!ui.error) content.push(el('div', {class: 'loading-shell'}, el('div', {class: 'spinner'}), '正在读取本机浏览空间…'));
    else content.push(emptyState('暂时无法读取浏览空间', '确认扩展已经安装并启用，然后重试。', null, null));
  } else {
    const renderers = {review: renderReview, pages: renderPages, tasks: renderTasks, search: () => [memory.searchView()], timeline: renderTimeline, map: renderMap, settings: renderSettings};
    content.push(...renderers[ui.view]());
  }
  mapResizeObserver?.disconnect();
  main.replaceChildren(...content.filter(item => item !== null && item !== undefined && item !== false));
  if (ui.state && !ui.pendingRange) {
    const url = new URL(location.href);
    url.hash = ui.view; url.searchParams.set('range', ui.range);
    if (ui.selectedTag) url.searchParams.set('topic', ui.selectedTag); else url.searchParams.delete('topic');
    const [from, to] = ui.selectedEdge.split('\u0000');
    if (from && to) { url.searchParams.set('from', from); url.searchParams.set('to', to); }
    else { url.searchParams.delete('from'); url.searchParams.delete('to'); }
    // Keep a reused workspace URL truthful so reopening an earlier map selection
    // cannot be mistaken for navigation to the already displayed object.
    if (url.href !== location.href) history.replaceState(null, '', url.href);
  }
  if (mapScroll != null && main.querySelector('.graph-scroll')) main.querySelector('.graph-scroll').scrollTop = mapScroll;
  document.getElementById('app').setAttribute('aria-busy', String(Boolean(ui.pendingRange) || (!ui.state && !ui.error)));
  main.setAttribute('aria-busy', String(Boolean(ui.pendingRange)));
  const toastAction = document.getElementById('toast-action');
  if (toastAction) toastAction.disabled = toastAction.dataset.action === 'undo-group' ? !ui.canUndo || busy('undo') : busy('rules') || busy('semantic');
  for (const [id, scroll] of memberScroll) if (document.getElementById(id)) document.getElementById(id).scrollTop = scroll;
  if (focusId && document.getElementById(focusId) && !document.getElementById(focusId).disabled) {
    const target = document.getElementById(focusId);
    target.focus({preventScroll: true});
    if (selection && typeof target.setSelectionRange === 'function' && target.type !== 'number') {
      try { target.setSelectionRange(selection.start, selection.end); } catch { /* Selects do not expose text selection. */ }
    }
  } else if (hadMainFocus) {
    const rows = [...document.querySelectorAll('.tab-title')];
    const target = rowIndex >= 0 ? rows[Math.min(rowIndex, rows.length - 1)] : wasProposal ? document.getElementById('grouping-title') : null;
    (target || main).focus({preventScroll: true});
  }
}
function navigate(view) {
  if (!Object.hasOwn(viewNames, view)) return;
  ui.view = view;
  location.hash = view;
  if (view === 'review' && ui.range !== 'week') chooseRange('week');
  else { render(); refresh({quiet: true}); }
}
let dialogCancelHandler = null, dialogBusy = false, taskEditor = null, dialogReturnFocusId = '';
function closeDialog() {
  if (dialogBusy) return;
  if (dialogCancelHandler) dialogCancelHandler();
  else document.getElementById('dialog').close();
}
function lockDialog() {
  dialogBusy = true;
  const controls = [...document.getElementById('dialog').querySelectorAll('button,input,textarea')].map(element => [element, element.disabled]);
  for (const [element] of controls) element.disabled = true;
  let released = false;
  return () => {
    if (released) return;
    released = true; dialogBusy = false;
    for (const [element, disabled] of controls) element.disabled = disabled;
  };
}
function dialogFrame(title, description) {
  const dialog = document.getElementById('dialog');
  if (!dialog.open) dialogReturnFocusId = document.activeElement?.id || '';
  dialogCancelHandler = null;
  dialog.replaceChildren(el('div', {class: 'dialog-head'},
    el('div', {}, el('h2', {id: 'dialog-title'}, title), description && el('p', {}, description)),
    iconButton('关闭对话框', 'close-dialog', 'close')));
  const body = el('div', {class: 'dialog-body'});
  dialog.append(body);
  if (!dialog.open) dialog.showModal();
  return {dialog, body};
}
function field(id, label, value, textarea = false, attributes = {}) {
  return el('div', {class: 'field'}, el('label', {for: id}, label), textarea ? el('textarea', {id, rows: 4, ...attributes}, value || '') : el('input', {id, type: 'text', value: value || '', ...attributes}));
}
function showDialogError(body, message) {
  body.querySelector('.dialog-error')?.remove();
  body.prepend(el('p', {class: 'dialog-error', role: 'alert'}, message));
}
function taskDialog({task = null, group = null, scope = 'window'} = {}) {
  const intentOnly = scope === 'intent';
  let editorRevision = task?.revision || 0;
  const tabs = scope === 'selection' ? ui.state.tabs.filter(tab => ui.selected.has(tab.id)) : ui.state.tabs;
  const sourcePages = intentOnly ? [] : task?.pages || group?.pages || tabs;
  const taskPages = uniqueTaskPages(sourcePages);
  if (!task && !intentOnly && !taskPages.length) return toast('先选择要保存的页面。', true);
  const source = group ? '当前分组' : scope === 'selection' ? '所选页面' : '当前窗口';
  const {dialog, body} = dialogFrame(task ? '编辑任务' : intentOnly ? '新建任务' : group ? '保存这组页面' : scope === 'selection' ? '保存所选页面' : '保存当前窗口', task ? '改个名字，或留下下一次继续的线索。' : intentOnly ? '先写下目标，再设为当前任务寻找相关资料。' : source + ' · ' + taskPages.length + ' 个页面，最多保存 30 页。' + (sourcePages.length > taskPages.length ? '同一地址只保留一份。' : ''));
  const memberList = intentOnly ? null : task
    ? el('ul', {class: 'dialog-pages'}, taskPages.map(page => el('li', {}, icon('page'), el('button', {type: 'button', 'data-action': 'open-page', 'data-url': page.url, title: page.title || page.url}, page.title || domainOf(page.url)))))
    : el('div', {class: 'task-member-picker'},
      el('div', {class: 'selection-tools'}, el('span', {id: 'task-members-count', role: 'status'}), el('button', {id: 'task-select-all', type: 'button', class: 'note-toggle'}, '清空选择')),
      el('div', {class: 'dialog-pages selectable-pages', role: 'group', 'aria-label': '选择要保存的页面'}, taskPages.map((page, index) => el('label', {class: 'task-member'},
        el('input', {id: 'task-member-' + index, type: 'checkbox', 'data-task-member': index, checked: true}), el('span', {title: page.title || page.url}, page.title || domainOf(page.url))))),
      el('p', {id: 'task-members-error', class: 'member-validation', role: 'status'}));
  const form = el('form', {id: 'task-form', novalidate: ''},
    field('task-name', '任务名称', task?.name || group?.name || '', false, {required: true, placeholder: '例如：周末路线 / 一个新想法'}),
    field('task-goal', '这件事想达到什么目标？', task?.goal || '', true, {placeholder: '一句话描述目标，用来寻找相关页面。'}),
    field('task-notes', '任务笔记', task?.notes || '', true, {placeholder: '保留资料和上下文；可以在“留断点”中单独确认下一步。'}),
    memberList,
    el('div', {class: 'dialog-actions'}, task && button('删除任务', 'delete-task', {'data-id': task.id}, 'danger subtle'), el('span', {class: 'spacer'}), button('取消', 'close-dialog'), el('button', {type: 'submit', class: 'btn primary'}, icon('save'), task ? '保存修改' : '保存任务')));
  body.append(form);
  taskEditor = {form, lastField: form.querySelector('#task-name')};
  form.addEventListener('focusin', event => {
    if (event.target.matches('input[type="text"],textarea')) taskEditor.lastField = event.target;
  });
  const selectedPages = () => task ? taskPages : [...form.querySelectorAll('[data-task-member]:checked')].map(input => taskPages[Number(input.dataset.taskMember)]);
  const updateMembers = () => {
    if (task || intentOnly) return;
    const count = selectedPages().length;
    form.querySelector('#task-members-count').textContent = '已选 ' + count + ' / ' + taskPages.length + ' 页';
    form.querySelector('#task-select-all').textContent = count ? '清空选择' : '全选';
    form.querySelector('#task-members-error').textContent = count > 30 ? '最多保存 30 页，请取消至少 ' + (count - 30) + ' 页。' : count ? '' : '请选择至少一个页面。';
    form.querySelector('[type="submit"]').disabled = count === 0 || count > 30;
  };
  form.addEventListener('change', updateMembers);
  form.querySelector('#task-select-all')?.addEventListener('click', () => {
    const checked = selectedPages().length === 0;
    for (const input of form.querySelectorAll('[data-task-member]')) input.checked = checked;
    updateMembers();
  });
  updateMembers();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (dialogBusy) return;
    let name, notes, goal;
    try {
      name = taskText(form.querySelector('#task-name').value, 'name', {required: true});
      notes = taskText(form.querySelector('#task-notes').value, 'notes');
      goal = taskText(form.querySelector('#task-goal').value, 'goal');
    } catch (error) { showDialogError(body, error.message); return; }
    if (!name) { showDialogError(body, '请给任务起一个名字。'); form.querySelector('#task-name').focus(); return; }
    const pages = selectedPages();
    if (!task && !intentOnly && (pages.length === 0 || pages.length > 30)) { updateMembers(); return; }
    const submit = form.querySelector('[type="submit"]'), label = task ? '保存修改' : '保存任务';
    const unlock = lockDialog(); submit.replaceChildren(icon('save'), '正在保存…');
    try {
      if (task) await request('UPDATE_TASK', {id: task.id, revision: editorRevision, name, goal, notes});
      else await request('SAVE_TASK', {windowId, name, goal, notes, ...(intentOnly ? {mode: 'intent'} : group ? {group: {...group, pages}} : {tabIds: pages.map(page => page.id)})});
      await refresh({quiet: true}); unlock(); dialog.close(); toast(task ? '任务已更新。' : '任务已保存，下次可以从这里继续。');
    } catch (error) {
      showDialogError(body, error.message);
      if (error.code === 'STALE_TASK') {
        await refresh({quiet: true});
        const latest = ui.state.tasks.find(item => item.id === task.id);
        if (latest) {
          const rebase = el('button', {type: 'button', class: 'btn small'}, '核对最新任务后重新保存');
          rebase.addEventListener('click', () => { editorRevision = latest.revision; showDialogError(body, '最新名称：' + latest.name + '；目标：' + (latest.goal || '未填写') + '。你的草稿仍保留，请核对后保存。'); });
          body.querySelector('.dialog-error').append(rebase);
        }
      }
    }
    finally { unlock(); submit.replaceChildren(icon('save'), label); updateMembers(); }
  });
  form.querySelector('#task-name').focus();
}
function confirmDialog(title, description, label, callback, requireWord = false, onCancel = null) {
  const {dialog, body} = dialogFrame(title);
  dialogCancelHandler = onCancel;
  const form = el('form', {}, el('p', {class: 'dialog-description'}, description),
    requireWord && field('confirm-word', '输入“清除”确认', '', false, {autocomplete: 'off', required: true}),
    el('div', {class: 'dialog-actions'}, button(onCancel ? '取消删除' : '取消', 'close-dialog'), el('button', {type: 'submit', class: 'btn danger'}, label)));
  body.append(form);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (dialogBusy) return;
    if (requireWord && form.querySelector('#confirm-word').value.trim() !== '清除') return showDialogError(body, '请输入“清除”以确认。');
    const unlock = lockDialog();
    try { await callback(); await refresh({quiet: true}); unlock(); dialog.close(); }
    catch (error) { showDialogError(body, error.message); }
    finally { unlock(); }
  });
}
function confirmTaskDeletion(task) {
  const dialog = document.getElementById('dialog');
  const nodes = [...dialog.childNodes], editor = taskEditor, scroll = dialog.scrollTop;
  const field = editor?.lastField || document.activeElement;
  const selection = field && 'selectionStart' in field ? [field.selectionStart, field.selectionEnd] : null;
  const pages = dialog.querySelector('.dialog-pages'), pageScroll = pages?.scrollTop || 0;
  const restoreEditor = () => {
    dialog.replaceChildren(...nodes); dialogCancelHandler = null; taskEditor = editor; dialog.scrollTop = scroll;
    if (pages) pages.scrollTop = pageScroll;
    field?.focus({preventScroll: true});
    if (selection) field.setSelectionRange(...selection);
  };
  confirmDialog('删除这个任务？', '“' + task.name + '”的保存页面、断点、笔记与关联记忆将被删除。浏览器中打开的页面不受影响。', '删除任务', async () => { await request('DELETE_TASK', {id: task.id, revision: task.revision || 0}); toast('任务已删除。'); }, false, restoreEditor);
}
async function pollModel(callback) {
  let running = false;
  const timer = setInterval(async () => {
    if (running || busy('range')) return;
    running = true;
    try { await refresh({quiet: true}); } finally { running = false; }
  }, 1400);
  try { return await callback(); } finally { clearInterval(timer); }
}
async function propose(semantic = false) {
  const id = semantic ? 'semantic' : 'rules';
  let completed = false;
  await operation(id, async () => {
    if (semantic && !ui.state.settings.semantic) throw new Error('请先在设置中开启语义增强。');
    const load = () => request('PROPOSE_GROUPS', {windowId, semantic});
    const result = semantic ? await pollModel(load) : await load();
    const groups = result?.groups || [];
    if (result?.model) ui.state.model = {...ui.state.model, ...result.model};
    ui.state.groups = groups; ui.applied.clear(); ui.members.clear();
    if (isPanel && ui.pagesMode === 'list') ui.listScroll = document.getElementById('main').scrollTop;
    ui.pagesMode = 'groups';
    toast(groups.length ? '找到 ' + groups.length + ' 组建议。应用后才会改变浏览器分组。' : '暂时没有适合合并的页面，现有分组保持不变。');
    await refresh({quiet: true});
    completed = true;
  });
  if (completed && ui.view === 'pages') {
    document.getElementById('main').scrollTop = 0;
    document.getElementById('grouping-title')?.focus({preventScroll: true});
  }
}
function captureSettings() {
  if (ui.view !== 'settings') return;
  const byId = (id) => document.getElementById(id);
  if (!byId('setting-tracking')) return;
  ui.settingsDraft = {
    tracking: byId('setting-tracking').checked, semantic: byId('setting-semantic').checked,
    focusSupport: byId('setting-focus-support').checked,
    idleSeconds: Number(byId('setting-idle').value), retentionDays: Number(byId('setting-retention').value),
    excludedDomains: byId('setting-excluded').value.split(/[\n,，]+/).map((line) => line.trim()).filter(Boolean)
  };
  ui.settingsDirty = true;
  const status = document.getElementById('settings-save-status');
  if (status) status.textContent = '有尚未保存的更改。';
}
function cleanDomains(domains) {
  const output = [];
  for (const raw of domains) {
    let domain;
    try { domain = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw).hostname.toLowerCase(); }
    catch { throw new Error('无法识别域名：“' + raw + '”。请填写例如 example.com 的域名。'); }
    if (!domain || /\s/.test(raw) || domain.includes('*')) throw new Error('域名“' + raw + '”格式不正确，请填写完整域名。');
    if (!output.includes(domain)) output.push(domain);
  }
  return output;
}
async function exportData() {
  const data = await request('EXPORT_DATA');
  const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const anchor = el('a', {href: url, download: (isDemo ? 'focuence-demo-' : 'focuence-data-') + new Date().toISOString().slice(0, 10) + '.json'});
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast(isDemo ? '已导出示例数据。' : '已生成本机数据导出文件。');
}
async function handleAction(action, target) {
  const id = target.dataset.id;
  switch (action) {
    case 'navigate': navigate(target.dataset.view); break;
    case 'review-map': navigate('map'); break;
    case 'review-tasks': navigate('tasks'); break;
    case 'open-workspace': await openWorkspace({view: 'review', windowId, demo: isDemo}); break;
    case 'open-full-map': {
      const [from, to] = ui.selectedEdge.split('\u0000');
      await openWorkspace({view: 'map', range: ui.range, windowId, demo: isDemo, topic: ui.selectedTag, from, to}); break;
    }
    case 'open-panel': await openSidePanel({windowId, demo: isDemo}); break;
    case 'nav-pages': navigate('pages'); break;
    case 'refresh': if (ui.failedRange) await chooseRange(ui.failedRange); else await operation('refresh', () => refresh()); break;
    case 'flush-refresh': await operation('flush', async () => { await request('FLUSH_ACTIVITY'); await refresh(); }); break;
    case 'page-filter': ui.pageFilter = target.dataset.filter; render(); announceResults(); break;
    case 'pages-mode': {
      if (ui.pagesMode === 'list') ui.listScroll = document.getElementById('main').scrollTop;
      ui.pagesMode = target.dataset.mode; render();
      document.getElementById('main').scrollTop = ui.pagesMode === 'list' ? ui.listScroll : 0;
      break;
    }
    case 'propose': await propose(false); break;
    case 'semantic': await propose(true); break;
    case 'focus-tab':
      await request('FOCUS_TAB', {tabId: Number(id)});
      if (isDemo) toast('示例：已定位所选页面。');
      break;
    case 'open-page':
      await request('OPEN_PAGE', {url: target.dataset.url, windowId});
      if (isDemo) toast('示例：真实模式会打开这个页面。');
      break;
    case 'new-task': taskDialog({scope: 'intent'}); break;
    case 'save-window': taskDialog({scope: 'window'}); break;
    case 'save-selection': taskDialog({scope: 'selection'}); break;
    case 'save-group': {
      const group = ui.state.groups.find((item) => String(item.id) === id);
      if (group) taskDialog({group: selectedProposal(group, ui.state.tabs, ui.members)}); break;
    }
    case 'apply-group': {
      const group = ui.state.groups.find((item) => String(item.id) === id);
      if (!group) throw new Error('这条建议已更新，请刷新后重试。');
      await operation('group-' + id, async () => {
        const result = await request('APPLY_GROUP', {group: selectedProposal(group, ui.state.tabs, ui.members), windowId}); ui.applied.add(group.id); ui.canUndo = true;
        await refresh({quiet: true}); toast('已将 ' + result.count + ' 页放入「' + result.name + '」。', false, 'undo-group');
      }); break;
    }
    case 'undo-group':
      await operation('undo', async () => {
        const result = await request('UNDO_GROUP'); ui.canUndo = false; ui.applied.clear();
        await refresh({quiet: true}); toast(result?.restored ? '已撤销最近一次分组。' : '没有可以撤销的本次会话分组。');
      }); break;
    case 'edit-task': { const task = ui.state.tasks.find((item) => String(item.id) === id); if (task) taskDialog({task}); break; }
    case 'delete-task': {
      const task = ui.state.tasks.find((item) => String(item.id) === id);
      if (task && !dialogBusy) confirmTaskDeletion(task);
      break;
    }
    case 'toggle-task-note':
      if (ui.expandedNotes.has(id)) ui.expandedNotes.delete(id); else ui.expandedNotes.add(id);
      render(); break;
    case 'toggle-task-pages':
      if (ui.expandedPages.has(id)) ui.expandedPages.delete(id); else ui.expandedPages.add(id);
      render(); break;
    case 'toggle-segment-details':
      if (ui.expandedSegments.has(id)) ui.expandedSegments.delete(id); else ui.expandedSegments.add(id);
      render(); break;
    case 'restore-task':
      await operation('restore-' + id, async () => {
        const result = await request('RESTORE_TASK', {id, windowId, revision: ui.state.tasks.find(task => task.id === id).revision || 0, contextRevision: ui.state.work?.current.revision || 0}); await refresh({quiet: true});
        const failed = result?.failed?.length || 0;
        toast('已复用 ' + (result?.reused || 0) + ' 页，新开 ' + (result?.opened || 0) + ' 页。' + (failed ? failed + ' 页未恢复，可重试。' : '已接回任务页面。'), failed > 0);
      }); break;
    case 'toggle-tracking':
      await operation('tracking', async () => {
        const tracking = !ui.state.settings.tracking;
        await request('UPDATE_SETTINGS', {patch: {tracking}});
        if (ui.settingsDraft) ui.settingsDraft.tracking = tracking;
        await refresh({quiet: true}); toast(tracking ? '已恢复浏览记录。' : '已暂停浏览记录。');
      }); break;
    case 'timeline-status': ui.timelineStatus = target.dataset.status; ui.timelineLimit = 60; render(); announceResults(); break;
    case 'timeline-more': ui.timelineLimit += 60; render(); break;
    case 'timeline-tag': ui.timelineTag = target.dataset.tag; ui.timelineLimit = 60; if (ui.view === 'review') navigate('timeline'); else render(); break;
    case 'clear-timeline-tag': ui.timelineTag = ''; render(); document.getElementById('timeline-filter-' + ui.timelineStatus)?.focus(); announceResults(); break;
    case 'clear-timeline-filters': ui.timelineTag = ''; ui.timelineStatus = 'all'; ui.timelineLimit = 60; render(); document.getElementById('timeline-filter-all')?.focus(); announceResults(); break;
    case 'tag-timeline': ui.timelineTag = target.dataset.tag; ui.timelineStatus = 'all'; navigate('timeline'); break;
    case 'select-tag': ui.selectedTag = target.dataset.tag; ui.selectedEdge = ''; ui.mapNotice = ''; render(); break;
    case 'map-scope': ui.mapScope = target.dataset.scope; render(); break;
    case 'select-edge': if (!isPanel) ui.selectedTag = target.dataset.from; ui.selectedEdge = target.dataset.from + '\u0000' + target.dataset.to; ui.mapNotice = ''; render(); break;
    case 'save-settings':
      captureSettings();
      await operation('settings', async () => {
        const patch = {...ui.settingsDraft, excludedDomains: cleanDomains(ui.settingsDraft.excludedDomains)};
        await request('UPDATE_SETTINGS', {patch}); ui.settingsDirty = false;
        await refresh({quiet: true}); toast('设置已保存。');
      }); break;
    case 'warmup':
      await operation('warmup', async () => {
        await pollModel(() => request('MODEL_WARMUP')); await refresh({quiet: true});
        toast(ui.state.model.status === 'ready' ? '本地模型已准备好。' : '已开始准备本地模型。');
      }); break;
    case 'export': await operation('export', exportData); break;
    case 'clear-history':
      confirmDialog('清除浏览历史？', '删除访问片段、自动线索、查找行为、提示记录及内部恢复前快照。保留任务、确认断点和手工关联。原始访问证据将不可用，此操作无法撤销。', '清除历史', async () => { await request('CLEAR_HISTORY'); await backupUI.reload(); ui.selectedTag = ''; toast('浏览历史及内部恢复点已清除，任务与手工记忆仍保留。'); });
      break;
    case 'clear-relations':
      confirmDialog('清除全部关联记忆？', '清除所有任务的相关和不相关判断。任务目标、断点与保存页面仍保留；此操作无法撤销。', '清除关联记忆', async () => {
        await request('RESET_TASK_RELATIONS', {scope: 'all', expectedTasks: ui.state.tasks.map(task => ({id: task.id, revision: task.revision || 0}))}); toast('关联记忆已清除。');
      });
      break;
    case 'clear-all':
      confirmDialog('清除全部本机数据？', '这将删除浏览历史、所有保存的任务并重置设置。浏览器页面不会关闭。此操作无法撤销。', '清除全部', async () => {
        await request('CLEAR_ALL'); ui.settingsDirty = false; ui.selected.clear(); ui.selectedTag = ''; ui.applied.clear(); ui.canUndo = false; toast('全部本机数据已清除。');
      }, true);
      break;
    case 'close-dialog': closeDialog(); break;
  }
}
document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target || target.disabled) return;
  handleAction(target.dataset.action, target).catch((error) => toast(error.message || String(error), true));
});
document.addEventListener('keydown', (event) => {
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('svg [role="button"]')) {
    event.preventDefault(); handleAction(event.target.dataset.action, event.target).catch((error) => toast(error.message, true));
  }
});
document.addEventListener('input', (event) => {
  const target = event.target;
  if (target.dataset.search) { ui.queries[target.dataset.search] = target.value; render(); }
  if (target.id === 'setting-excluded') captureSettings();
});
document.addEventListener('change', (event) => {
  const target = event.target;
  if (target.dataset.groupMember) {
    const group = ui.state.groups.find(group => group.id === target.dataset.groupMember);
    if (!group) return;
    const selected = proposalMembers(group, ui.state.tabs, ui.members), id = Number(target.dataset.tabId);
    if (target.checked) selected.add(id); else selected.delete(id);
    render();
  } else if (target.dataset.tabSelect) {
    const id = Number(target.dataset.tabSelect);
    if (target.checked) ui.selected.add(id); else ui.selected.delete(id);
    render();
  } else if (target.id === 'select-all') {
    for (const tab of filteredTabs()) { if (target.checked) ui.selected.add(tab.id); else ui.selected.delete(tab.id); }
    render();
  } else if (target.id === 'workspace-view') { navigate(target.value); }
  else if (target.id === 'map-topic-choice') { ui.selectedTag = target.value; ui.selectedEdge = ''; ui.mapNotice = ''; render(); }
  else if (target.id === 'page-sort') { ui.sort = target.value; render(); }
  else if (target.dataset.rangeControl) { chooseRange(target.value); }
  else if (target.id.startsWith('setting-')) captureSettings();
});
window.addEventListener('hashchange', () => {
  const view = location.hash.slice(1);
  if (Object.hasOwn(viewNames, view) && ui.view !== view) navigate(view);
});
window.matchMedia('(max-width: 640px)').addEventListener('change', () => {
  if (ui.view === 'map' && ui.state) render();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() - ui.lastRefresh > 5000 && !ui.busy.size && !document.getElementById('dialog').open) refresh({quiet: true});
});
if (isPanel && !isDemo && globalThis.chrome?.tabs) {
  let refreshTimer;
  const schedule = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      if (!ui.busy.size && !document.getElementById('dialog').open && !document.hidden) refresh({quiet: true});
    }, 250);
  };
  for (const name of ['onCreated', 'onRemoved', 'onActivated', 'onMoved', 'onAttached', 'onDetached', 'onReplaced']) chrome.tabs[name].addListener(schedule);
  chrome.tabs.onUpdated.addListener((_id, change) => { if (change.url || change.pendingUrl || change.title || 'pinned' in change || 'groupId' in change || change.status === 'complete') schedule(); });
  const heartbeat = setInterval(schedule, 15000);
  window.addEventListener('pagehide', () => { clearTimeout(refreshTimer); clearInterval(heartbeat); });
}
document.getElementById('dialog').addEventListener('cancel', event => {
  if (dialogBusy || dialogCancelHandler) { event.preventDefault(); closeDialog(); }
});
document.getElementById('dialog').addEventListener('close', () => {
  dialogCancelHandler = null; taskEditor = null;
  const target = document.getElementById(dialogReturnFocusId) || document.getElementById('main');
  target?.focus({preventScroll: true});
});
buildShell(); render();
await refresh({quiet: true});
