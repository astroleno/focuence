import { el, svgEl, icon, duration } from '../src/ui.js';
import { openWorkspace, openSidePanel } from '../src/navigation.js';
import { mapTopology, localNeighborhood } from '../src/map-layout.js';

const params = new URLSearchParams(location.search);
const isPanel = document.body.dataset.surface === 'panel';
const isDemo = params.get('demo') === '1';
const viewNames = isPanel ? {tasks: '任务', pages: '页面', timeline: '路径', map: '地图'} : {review: '一周回顾', tasks: '任务工作台', pages: '当前页面', timeline: '访问路径', map: '注意力地图', settings: '数据与设置'};
const viewIcons = {review: 'clock', pages: 'layers', tasks: 'folder', timeline: 'clock', map: 'nodes', settings: 'settings'};
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
    version: value?.version || '2.1.0',
    attention: value?.attention || {nodes: [], daily: [], summary: {}, range: {key: 'week', label: '最近 7 天'}},
    undoAvailable: Boolean(value?.undoAvailable),
    timelineTruncated: Boolean(value?.timelineTruncated),
    settings: {tracking: true, semantic: true, idleSeconds: 120, retentionDays: 30, excludedDomains: [], ...value?.settings},
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
  queries: {pages: '', tasks: ''}, pageFilter: 'all', sort: 'recent',
  timelineStatus: 'all', timelineLimit: 60, timelineTag: '', selectedTag: '',
  selectedEdge: '', mapScope: 'related', canUndo: false, settingsDraft: null, settingsDirty: false, lastRefresh: 0
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
    throw new Error(message || '操作没有完成，请刷新后重试。');
  }
  return response.data;
}
let toastTimer;
function toast(message, error = false) {
  const region = document.getElementById('toast-region');
  region.replaceChildren(el('div', {class: 'toast' + (error ? ' error' : '')}, icon(error ? 'info' : 'check'), el('span', {}, message)));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => region.replaceChildren(), error ? 6500 : 3700);
}
function busy(id) { return ui.busy.has(id); }
async function operation(id, callback) {
  if (busy(id)) return;
  ui.busy.add(id); render();
  try { return await callback(); }
  catch (error) { toast(error.message || String(error), true); }
  finally { ui.busy.delete(id); render(); }
}
let refreshEpoch = 0;
async function refresh({quiet = false} = {}) {
  const epoch = ++refreshEpoch;
  try {
    const value = await request('GET_STATE', {windowId, range: ui.range});
    if (epoch !== refreshEpoch) return false;
    if (Number.isInteger(value.windowId)) windowId = value.windowId;
    ui.state = normalizeState(value); ui.error = ''; ui.lastRefresh = Date.now();
    ui.canUndo = ui.state.undoAvailable;
    ui.selected = new Set([...ui.selected].filter((id) => ui.state.tabs.some((tab) => tab.id === id)));
    if (!ui.settingsDirty) ui.settingsDraft = {...ui.state.settings, excludedDomains: [...ui.state.settings.excludedDomains]};
    render();
    return true;
  } catch (error) {
    ui.error = error.message;
    if (!quiet && ui.state) toast(error.message, true);
    render(); return false;
  }
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
    return;
  }
  const sidebar = el('aside', {class: 'sidebar', 'aria-label': '主要导航'},
    el('a', {class: 'brand', href: '#review', 'aria-label': 'Focuence · 一周回顾'}, el('img', {src: '../icons/icon-48.png', width: 28, height: 28, alt: ''}), el('strong', {class: 'brand-name'}, 'Focuence')),
    el('nav', {class: 'nav-list', id: 'navigation', 'aria-label': '工作空间'}),
    el('div', {class: 'sidebar-bottom'}, el('div', {id: 'sidebar-tracking'}), el('div', {class: 'local-note'}, icon('shield'), '本机保存'), el('div', {class: 'version'}, 'Focuence 2.1')));
  const workspace = el('div', {class: 'workspace'},
    el('header', {class: 'topbar'},
      el('span', {id: 'breadcrumb', class: 'sr-only'}, viewNames[ui.view]),
      el('div', {class: 'workspace-context', id: 'workspace-context'}, '浏览工作空间'),
      el('label', {class: 'mobile-navigation'}, el('span', {class: 'sr-only'}, '切换功能'), el('select', {id: 'workspace-view', 'aria-label': '切换功能'}, Object.entries(viewNames).map(([key, label]) => el('option', {value: key}, label)))),
      el('div', {class: 'topbar-actions'}, el('span', {class: 'local-status', id: 'top-status'}), button('打开侧栏', 'open-panel', {}, 'small', 'layers'), iconButton('刷新当前数据', 'refresh', 'refresh'))),
    el('main', {class: 'main', id: 'main', tabindex: '-1'}));
  app.replaceChildren(sidebar, workspace);
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
  document.getElementById('top-status').replaceChildren(el('span', {class: 'status-dot' + (tracking ? '' : ' paused')}), isDemo ? '示例模式' : tracking ? '本机记录中' : '记录已暂停');
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
function tabRow(tab, index) {
  const meta = [el('span', {class: 'domain-text'}, tab.domain || domainOf(tab.url))];
  if (tab.pinned) meta.push(el('span', {class: 'tag protected'}, '已固定'));
  else if (Number(tab.groupId) >= 0) meta.push(el('span', {class: 'tag protected'}, '已分组'));
  else meta.push(...tagsOf(tab).slice(0, 2).map((tag) => tagChip(tag)));
  return el('article', {class: 'tab-row' + (ui.selected.has(tab.id) ? ' selected' : '')},
    el('input', {id: 'tab-select-' + tab.id, type: 'checkbox', 'data-tab-select': tab.id, checked: ui.selected.has(tab.id), 'aria-label': '选择 ' + (tab.title || tab.domain)}),
    domainMark(tab, index), el('div', {class: 'tab-content'},
      el('button', {type: 'button', class: 'tab-title', 'data-action': 'focus-tab', 'data-id': tab.id, title: tab.title || tab.url}, tab.title || tab.domain || '未命名页面'),
      el('div', {class: 'tab-meta'}, meta)),
    el('span', {class: 'tab-time', title: '已记录前台停留'}, duration(tab.foregroundMs)),
    iconButton('定位 ' + (tab.title || '页面'), 'focus-tab', 'arrow', {'data-id': tab.id}));
}
function proposalCard(group) {
  const pages = group.pages || [];
  const tabIds = group.tabIds || [];
  const applied = ui.applied.has(group.id);
  return el('article', {class: 'proposal'},
    el('div', {class: 'proposal-title'}, el('span', {class: 'color-dot', style: {background: colorOf(group.color)}}), el('h3', {}, group.name || '相关页面'), el('small', {}, tabIds.length + ' 页')),
    el('p', {class: 'proposal-reason'}, group.reason || (group.method === 'semantic' ? '根据页面的语义关系生成建议。' : '根据标题与域名生成建议。')),
    el('ul', {class: 'proposal-pages'}, pages.slice(0, 3).map((page) => el('li', {title: page.title || page.url}, page.title || page.url)), pages.length > 3 && el('li', {}, '还有 ' + (pages.length - 3) + ' 个页面')),
    el('div', {class: 'proposal-actions'},
      button('存为任务', 'save-group', {'data-id': group.id, disabled: !pages.length}, 'small subtle', 'save'),
      button(applied ? '已应用' : '应用分组', 'apply-group', {'data-id': group.id, disabled: applied || group.protected || busy('group-' + group.id)}, 'small' + (applied ? '' : ' primary'), applied ? 'check' : 'plus')));
}
function groupingPanel() {
  const state = ui.state;
  return el('aside', {class: 'panel group-panel', 'aria-label': '分组建议'},
    el('div', {class: 'section-heading'}, el('h2', {}, '整理建议'), button('撤销', 'undo-group', {disabled: !ui.canUndo || busy('undo')}, 'small subtle', 'undo')),
    el('p', {class: 'panel-intro'}, '先给页面一个落点，再决定哪些值得留下。'),
    modelBar(),
    state.groups.length ? el('div', {class: 'proposal-list'}, state.groups.map(proposalCard)) :
      emptyState('还没有分组建议', '点击“快速整理”，为尚未分组、未固定的页面寻找共同主题。', null, null, true, 'layers'),
    el('div', {class: 'panel-bottom'},
      button(busy('semantic') ? '正在进行语义增强…' : '用本地语义再看一遍', 'semantic', {disabled: busy('semantic') || busy('rules') || !state.settings.semantic || state.tabs.length < 2}, 'full dark', busy('semantic') ? undefined : 'spark'),
      el('p', {}, !state.settings.semantic ? '语义增强已在设置中关闭。' : '在本机完成，不会发送页面内容。')));
}
function renderPages() {
  const tabs = filteredTabs();
  const allSelected = tabs.length > 0 && tabs.every((tab) => ui.selected.has(tab.id));
  const selectedCount = ui.selected.size;
  const ungrouped = ui.state.tabs.filter((tab) => !isProtected(tab)).length;
  const filters = [['all', '全部 ' + ui.state.tabs.length], ['ungrouped', '待整理 ' + ungrouped], ['protected', '已保护 ' + (ui.state.tabs.length - ungrouped)]];
  return [
    heading('当前页面', '整理此刻的页面，留住下次继续的线索。', [
      button(selectedCount ? '保存所选 · ' + selectedCount : '保存当前窗口 · ' + ui.state.tabs.length + ' 页', 'save-selection', {disabled: ui.state.tabs.length === 0}, '', 'save'),
      button(busy('rules') ? '正在整理…' : '生成分组建议', 'propose', {disabled: busy('rules') || busy('semantic') || ui.state.tabs.length < 2}, ui.state.groups.length ? '' : 'primary', 'layers')
    ]),
    !isPanel && statStrip(),
    el('div', {class: 'two-column'},
      el('section', {'aria-label': '当前窗口页面'},
        el('div', {class: 'section-heading'}, el('h2', {}, '打开的页面', el('small', {}, '当前窗口')), el('span', {}, dateLabel(Date.now()))),
        el('div', {class: 'list-tools'}, searchBox('pages', '搜索标题、站点或主题'), el('div', {class: 'filter-row'}, filters.map(([filter, label]) => el('button', {type: 'button', class: 'filter-button' + (ui.pageFilter === filter ? ' active' : ''), 'data-action': 'page-filter', 'data-filter': filter, 'aria-pressed': ui.pageFilter === filter}, label)))),
        el('div', {class: 'select-toolbar'},
          el('label', {class: 'checkbox-label'}, el('input', {type: 'checkbox', id: 'select-all', checked: allSelected, disabled: !tabs.length, 'aria-label': '选择当前列表全部页面'}), selectedCount ? '已选 ' + selectedCount + ' 页' : '选择页面'),
          el('span', {class: 'spacer'}),
          el('select', {class: 'text-select', id: 'page-sort', 'aria-label': '页面排序'}, el('option', {value: 'recent', selected: ui.sort === 'recent'}, '最近访问优先'), el('option', {value: 'time', selected: ui.sort === 'time'}, '前台停留优先'))),
        el('div', {class: 'tab-list'}, tabs.length ? tabs.map(tabRow) : emptyState(ui.queries.pages || ui.pageFilter !== 'all' ? '没有匹配的页面' : '这里还没有页面', ui.queries.pages || ui.pageFilter !== 'all' ? '换一个关键词或筛选条件试试。' : '在这个窗口打开几个网页，刷新后就可以开始整理。', null, null, false)),
        el('p', {class: 'list-footnote'}, '已固定和已有分组的页面会受到保护。前台时长不等于实际注意力。')),
      groupingPanel())
  ];
}
function taskCard(task, {featured = false} = {}) {
  const pages = task.pages || [], preview = task.restorePreview || {reused: 0, willOpen: pages.length};
  return el('article', {class: 'task-card' + (featured ? ' featured' : '')},
    el('div', {class: 'task-card-head'},
      el('button', {id: 'task-name-' + task.id, class: 'task-name', type: 'button', 'data-action': 'edit-task', 'data-id': task.id}, task.name),
      iconButton('编辑 ' + task.name, 'edit-task', 'edit', {'data-id': task.id})),
    task.notes ? el('p', {class: 'task-note'}, task.notes) : button('添加下一步', 'edit-task', {'data-id': task.id}, 'text-button'),
    task.resumePage && el('div', {class: 'resume-context'}, icon('page'),
      el('button', {type: 'button', class: 'resume-page-link', title: task.resumePage.title || task.resumePage.url, 'data-action': 'open-page', 'data-url': task.resumePage.url}, task.resumePage.title || domainOf(task.resumePage.url))),
    task.lastRestoreResult?.failedCount > 0 && el('p', {class: 'restore-warning'}, '上次有 ' + task.lastRestoreResult.failedCount + ' 页未恢复，可以重试。'),
    !isPanel && pages.length > 1 && el('details', {class: 'task-page-details'}, el('summary', {}, '任务内的 ' + pages.length + ' 个页面'),
      el('ul', {class: 'task-pages'}, pages.map(page => el('li', {}, el('button', {type: 'button', 'data-action': 'open-page', 'data-url': page.url}, page.title || domainOf(page.url)))))),
    el('div', {class: 'task-footer'},
      el('div', {class: 'task-count'}, el('span', {}, '复用 ' + preview.reused + ' 页 · 新开 ' + preview.willOpen + ' 页'),
        el('span', {class: 'task-date'}, dateLabel(task.lastActivityAt || task.updatedAt || task.createdAt))),
      button(busy('restore-' + task.id) ? '恢复中…' : '继续任务', 'restore-task', {'data-id': task.id, disabled: busy('restore-' + task.id)}, 'small' + (featured ? ' primary' : ''), 'arrow')));
}
function renderTasks() {
  const query = ui.queries.tasks.trim().toLocaleLowerCase();
  const tasks = ui.state.tasks.filter(task => !query || [task.name, task.notes, ...(task.pages || []).map(page => page.title)].join(' ').toLocaleLowerCase().includes(query));
  return [
    heading(isPanel ? '任务' : '任务工作台', '保存下一步，回到正在做的事。', [
      button(isPanel ? '保存窗口' : '保存当前窗口', 'save-selection', {disabled: !ui.state.tabs.length}, isPanel ? 'small' : '', 'plus')]),
    el('div', {class: 'list-tools tasks-tools'}, searchBox('tasks', '搜索任务或页面'), el('span', {class: 'subtle-label'}, ui.state.tasks.length + ' 个任务')),
    tasks.length ? el('section', {class: 'task-grid', 'aria-label': '已保存任务'}, tasks.map((task, index) => taskCard(task, {featured: index === 0}))) :
      emptyState(query ? '没有找到这个任务' : '保存一件正在做的事', query ? '试试任务名、备注或页面标题。' : '选择相关页面，再写下一步。回来时就能继续。', query ? null : 'nav-pages', '去选择页面', false, 'folder'),
    !isPanel && continuationSuggestions(),
    el('p', {class: 'list-footnote'}, '优先复用已打开页面，每个任务最多保存 30 页。')
  ];
}
function rangeControl(id) {
  return el('select', {id, class: 'standard-select', 'aria-label': '时间范围', 'data-range-control': 'true', disabled: busy('range')},
    [['today', '今天'], ['yesterday', '昨天'], ['week', '最近 7 天']].map(([value, label]) => el('option', {value, selected: ui.range === value}, label)));
}
function renderReview() {
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
  return el('article', {class: 'timeline-entry ' + segment.status},
    el('div', {class: 'timeline-clock'}, timeLabel(segment.startedAt)),
    el('div', {class: 'timeline-track'}, el('span', {class: 'timeline-point'})),
    el('div', {class: 'timeline-content'},
      el('div', {class: 'timeline-title-row'},
        el('button', {type: 'button', class: 'timeline-title', 'data-action': 'open-page', 'data-url': segment.url, disabled: !/^https?:\/\//.test(segment.url || '')}, segment.title || domainOf(segment.url)),
        !isPanel && el('span', {class: 'timeline-duration'}, elapsed)),
      el('div', {class: 'timeline-meta'},
        isPanel && el('span', {class: 'timeline-duration'}, elapsed),
        el('span', {}, timeLabel(segment.startedAt) + '–' + timeLabel(segment.endedAt)),
        el('span', {class: segment.status === 'active' ? '' : 'timeline-status'}, statusLabel),
        tagsOf(segment).slice(0, 3).map(tag => tagChip(tag, 'timeline-tag')))));
}
function tagBars(entries) {
  const maximum = Math.max(1, ...entries.map((entry) => entry.foregroundMs));
  return entries.slice(0, 7).map((entry) => el('div', {class: 'tag-bar-row'},
    el('div', {class: 'tag-bar-label'}, el('button', {type: 'button', 'data-action': 'timeline-tag', 'data-tag': entry.tag}, entry.tag), el('span', {}, duration(entry.foregroundMs))),
    el('div', {class: 'bar-track'}, el('div', {class: 'bar-value', style: {width: entry.foregroundMs / maximum * 100 + '%'}}))));
}
function renderTimeline() {
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
  return [
    heading('访问路径', '回到当时看过的页面。', [rangeControl('timeline-range'), iconButton('刷新记录', 'flush-refresh', 'refresh', {disabled: busy('flush')})]),
    ui.state.timelineTruncated && el('p', {class: 'panel-intro'}, '这里展示所选范围内最新 2,000 条记录，图表使用该范围的完整记录。更早的历史可在设置中导出。'),
    el('div', {class: 'timeline-tools'},
      el('div', {class: 'filter-row'}, [['all', '全部记录'], ['active', '前台'], ['idle', '暂离'], ['unknown', '未知']].map(([value, label]) => el('button', {type: 'button', class: 'filter-button' + (ui.timelineStatus === value ? ' active' : ''), 'data-action': 'timeline-status', 'data-status': value, 'aria-pressed': ui.timelineStatus === value}, label)))),
    ui.timelineTag && el('div', {class: 'selected-tag-banner'}, '正在回看：' + ui.timelineTag, iconButton('取消主题筛选', 'clear-timeline-tag', 'close')),
    el('div', {class: 'timeline-layout'},
      el('section', {'aria-label': '浏览访问时间线'}, timeline.length ? timeline : emptyState('这段时间还没有记录', ui.state.settings.tracking ? '正常浏览网页后，返回这里刷新。暂离与未知时段会单独显示。' : '浏览记录已暂停，可以在左栏或设置中恢复。', null, null, false, 'clock'),
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
      el('button', {id: 'map-edge-' + encodeURIComponent(JSON.stringify([edge.from, edge.to])), type: 'button', class: 'neighbor-edge edge-control' + (ui.selectedEdge === edge.from + '\u0000' + edge.to ? ' selected' : ''), 'aria-pressed': ui.selectedEdge === edge.from + '\u0000' + edge.to, 'data-action': 'select-edge', 'data-from': edge.from, 'data-to': edge.to, 'aria-label': edge.from + ' 到 ' + edge.to + '，观察到 ' + edge.count + ' 次切换'}, edge.count + ' 次'));
  }));
  return el('div', {class: 'local-map', role: 'group', 'aria-label': '选中主题的前后访问关系，箭头向下'},
    el('label', {class: 'map-topic-choice'}, el('span', {}, '查看主题'), el('select', {id: 'map-topic-choice', class: 'standard-select'}, topology.nodes.map(node => el('option', {value: node.tag, selected: node.tag === ui.selectedTag}, node.tag)))),
    local.before.length > 0 && el('div', {class: 'local-before'}, el('p', {class: 'flow-label'}, '之前访问'), neighbors(local.before, true), branchConnector(local.before.length, true)),
    el('div', {class: 'local-center'}, mapNode(local.node, 'center')),
    local.after.length > 0 && el('div', {class: 'local-after'}, branchConnector(local.after.length, false), el('p', {class: 'flow-label'}, '接着访问'), neighbors(local.after, false)),
    local.relatedCount === 0 && el('p', {class: 'map-footnote'}, '这个主题还没有有效的前后切换记录。'),
    local.relatedCount > 4 && el('p', {class: 'map-footnote'}, '展示最常见的前后关系，完整地图包含其余关系。'));
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
      : el('p', {class: 'panel-intro'}, '点选次数或连线，查看发生在何时、哪些页面。'),
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
  const {entries, edges} = mapData();
  if (!entries.some(entry => entry.tag === ui.selectedTag)) ui.selectedTag = entries.find(entry => edges.some(edge => edge.from === entry.tag || edge.to === entry.tag))?.tag || entries[0]?.tag || '';
  const relatedCount = edges.filter(edge => edge.from === ui.selectedTag || edge.to === ui.selectedTag).length;
  return [
    heading(isPanel ? '主题地图' : '注意力地图', '从真实访问的先后关系，回到当时的页面。', [rangeControl('map-range'), isPanel ? iconButton('展开完整地图', 'open-full-map', 'external') : iconButton('刷新记录', 'flush-refresh', 'refresh', {disabled: busy('flush')})]),
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
    el('div', {class: 'settings-layout'},
      el('section', {class: 'settings-section'}, el('h2', {}, '浏览记录'),
        settingRow('记录前台浏览', '记录页面的前台停留与切换。暂停后不会新增浏览片段，已有记录仍会保留。', toggle('setting-tracking', settings.tracking, '记录前台浏览')),
        settingRow('暂离判断', '连续没有设备活动时，后续时间单独标记为暂离，不计入前台时长。', selectOptions('setting-idle', settings.idleSeconds, [[60, '1 分钟'], [120, '2 分钟'], [300, '5 分钟'], [600, '10 分钟']], '暂离判断时间')),
        settingRow('历史保留时间', '到期的浏览历史会清理，手动保存的任务会继续保留。', selectOptions('setting-retention', settings.retentionDays, [[7, '7 天'], [30, '30 天'], [90, '90 天'], [365, '365 天']], '历史保留时间')),
        el('div', {class: 'field exclusion-field'}, el('label', {for: 'setting-excluded'}, '不记录这些站点'), el('textarea', {id: 'setting-excluded', placeholder: '例如：bank.example.com\n每行一个域名', rows: 3}, (settings.excludedDomains || []).join('\n')), el('p', {class: 'field-help'}, '每行一个域名，或用逗号分隔。隐身页面默认不记录。'))),
      el('section', {class: 'settings-section'}, el('h2', {}, '本地智能'),
        settingRow('启用语义增强', '用随扩展提供的小模型理解页面之间的联系。关闭后仍能使用快速规则分组。', toggle('setting-semantic', settings.semantic, '启用本地语义增强')),
        settingRow('模型状态', ui.state.model.name || 'BGE-small-zh-v1.5 · 本地语义模型', button(busy('warmup') ? '正在准备…' : ui.state.model.status === 'ready' ? '模型已就绪' : '准备本地模型', 'warmup', {disabled: busy('warmup') || ui.state.model.status === 'ready'}, 'small', 'spark')),
        modelBar(),
        el('div', {class: 'settings-save'}, button(busy('settings') ? '正在保存…' : '保存设置', 'save-settings', {disabled: busy('settings')}, 'primary', 'check'), el('span', {id: 'settings-save-status'}, ui.settingsDirty ? '有尚未保存的更改。' : '所有分析均在本机完成，无需 API 密钥。'))),
      el('section', {class: 'settings-section'}, el('h2', {}, '数据与迁移'),
        settingRow('导出本机数据', '导出页面、任务、访问片段与设置为 JSON，便于备份和后续分析。', button('导出数据', 'export', {disabled: busy('export')}, 'small', 'download'))),
      el('section', {class: 'settings-section danger-section'}, el('h2', {}, '清理本机数据'),
        settingRow('清除浏览历史', '删除已记录的访问片段，保留手动保存的任务。这个操作无法撤销。', button('清除历史', 'clear-history', {}, 'small danger')),
        settingRow('清除全部数据', '删除浏览历史、保存的任务并重置设置。不会关闭浏览器页面。这个操作无法撤销。', button('清除全部', 'clear-all', {}, 'small danger'))))
  ];
}
function render() {
  if (!document.getElementById('navigation')) return;
  const focused = document.activeElement;
  const focusId = focused?.id;
  const selection = focused && 'selectionStart' in focused ? {start: focused.selectionStart, end: focused.selectionEnd} : null;
  renderNavigation();
  const main = document.getElementById('main');
  const mapScroll = main.querySelector('.graph-scroll')?.scrollTop;
  const content = [];
  if (isDemo) content.push(el('div', {class: 'demo-banner'}, icon('info'), el('p', {}, '示例数据，仅用于演示')));
  if (ui.error) content.push(el('div', {class: 'alert', role: 'alert'}, el('p', {}, ui.error), button('重新连接', 'refresh', {}, 'small', 'refresh')));
  if (!ui.state) {
    if (!ui.error) content.push(el('div', {class: 'loading-shell'}, el('div', {class: 'spinner'}), '正在读取本机浏览空间…'));
    else content.push(emptyState('暂时无法读取浏览空间', '确认扩展已经安装并启用，然后重试。', null, null));
  } else {
    const renderers = {review: renderReview, pages: renderPages, tasks: renderTasks, timeline: renderTimeline, map: renderMap, settings: renderSettings};
    content.push(...renderers[ui.view]());
  }
  mapResizeObserver?.disconnect();
  main.replaceChildren(...content.filter(item => item !== null && item !== undefined && item !== false));
  if (mapScroll != null && main.querySelector('.graph-scroll')) main.querySelector('.graph-scroll').scrollTop = mapScroll;
  document.getElementById('app').setAttribute('aria-busy', String(!ui.state && !ui.error));
  if (focusId && document.getElementById(focusId)) {
    const target = document.getElementById(focusId);
    target.focus({preventScroll: true});
    if (selection && typeof target.setSelectionRange === 'function' && target.type !== 'number') {
      try { target.setSelectionRange(selection.start, selection.end); } catch { /* Selects do not expose text selection. */ }
    }
  }
}
function navigate(view) {
  if (!Object.hasOwn(viewNames, view)) return;
  ui.view = view;
  if (view === 'review') ui.range = 'week';
  location.hash = view; render(); refresh({quiet: true});
}
function dialogFrame(title, description) {
  const dialog = document.getElementById('dialog');
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
function taskDialog({task = null, group = null} = {}) {
  const tabs = ui.state.tabs.filter((tab) => !ui.selected.size || ui.selected.has(tab.id));
  const taskPages = task?.pages || group?.pages || tabs;
  if (!task && !taskPages.length) return toast('先选择要保存的页面。', true);
  const {dialog, body} = dialogFrame(task ? '编辑任务' : '为这组页面留个位置', task ? '改个名字，或留下下一次继续的线索。' : taskPages.length + ' 个页面将保留为一个任务。');
  const form = el('form', {id: 'task-form'},
    field('task-name', '任务名称', task?.name || group?.name || '', false, {required: true, maxlength: 80, placeholder: '例如：周末路线 / 一个新想法'}),
    field('task-notes', '接下来想做什么？', task?.notes || '', true, {maxlength: 3000, placeholder: '记下一点上下文，下一次就容易继续。'}),
    taskPages.length > 0 && el('ul', {class: 'dialog-pages'}, taskPages.map((page) => el('li', {}, icon('page'), el('button', {type: 'button', 'data-action': 'open-page', 'data-url': page.url, title: page.title || page.url}, page.title || domainOf(page.url))))),
    el('div', {class: 'dialog-actions'}, task && button('删除任务', 'delete-task', {'data-id': task.id}, 'danger subtle'), el('span', {class: 'spacer'}), button('取消', 'close-dialog'), el('button', {type: 'submit', class: 'btn primary'}, icon('save'), task ? '保存修改' : '保存任务')));
  body.append(form);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = form.querySelector('#task-name').value.trim();
    const notes = form.querySelector('#task-notes').value.trim();
    if (!name) return showDialogError(body, '请给任务起一个名字。');
    const submit = form.querySelector('[type="submit"]'); submit.disabled = true;
    try {
      if (task) await request('UPDATE_TASK', {id: task.id, name, notes});
      else await request('SAVE_TASK', {windowId, name, notes, ...(group ? {group} : {tabIds: tabs.map((tab) => tab.id)})});
      dialog.close(); await refresh({quiet: true}); toast(task ? '任务已更新。' : '任务已保存，下次可以从这里继续。');
    } catch (error) { showDialogError(body, error.message); submit.disabled = false; }
  });
  setTimeout(() => form.querySelector('#task-name').focus(), 30);
}
function confirmDialog(title, description, label, callback, requireWord = false) {
  const {dialog, body} = dialogFrame(title);
  const form = el('form', {}, el('p', {class: 'dialog-description'}, description),
    requireWord && field('confirm-word', '输入“清除”确认', '', false, {autocomplete: 'off', required: true}),
    el('div', {class: 'dialog-actions'}, button('取消', 'close-dialog'), el('button', {type: 'submit', class: 'btn danger'}, label)));
  body.append(form);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (requireWord && form.querySelector('#confirm-word').value.trim() !== '清除') return showDialogError(body, '请输入“清除”以确认。');
    const submit = form.querySelector('[type="submit"]'); submit.disabled = true;
    try { await callback(); dialog.close(); await refresh({quiet: true}); }
    catch (error) { showDialogError(body, error.message); submit.disabled = false; }
  });
}
async function pollModel(callback) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try { await refresh({quiet: true}); } finally { running = false; }
  }, 1400);
  try { return await callback(); } finally { clearInterval(timer); }
}
async function propose(semantic = false) {
  const id = semantic ? 'semantic' : 'rules';
  await operation(id, async () => {
    if (semantic && !ui.state.settings.semantic) throw new Error('请先在设置中开启语义增强。');
    const load = () => request('PROPOSE_GROUPS', {windowId, semantic});
    const result = semantic ? await pollModel(load) : await load();
    const groups = result?.groups || [];
    if (result?.model) ui.state.model = {...ui.state.model, ...result.model};
    ui.state.groups = groups; ui.applied.clear();
    toast(groups.length ? '找到 ' + groups.length + ' 组建议。应用后才会改变浏览器分组。' : '暂时没有适合合并的页面，现有分组保持不变。');
    await refresh({quiet: true});
  });
}
function captureSettings() {
  if (ui.view !== 'settings') return;
  const byId = (id) => document.getElementById(id);
  if (!byId('setting-tracking')) return;
  ui.settingsDraft = {
    tracking: byId('setting-tracking').checked, semantic: byId('setting-semantic').checked,
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
    case 'open-full-map': await openWorkspace({view: 'map', range: ui.range, windowId, demo: isDemo}); break;
    case 'open-panel': await openSidePanel({windowId, demo: isDemo}); break;
    case 'nav-pages': navigate('pages'); break;
    case 'refresh': await operation('refresh', () => refresh()); break;
    case 'flush-refresh': await operation('flush', async () => { await request('FLUSH_ACTIVITY'); await refresh(); }); break;
    case 'page-filter': ui.pageFilter = target.dataset.filter; render(); break;
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
    case 'save-selection': taskDialog(); break;
    case 'save-group': {
      const group = ui.state.groups.find((item) => String(item.id) === id);
      if (group) taskDialog({group}); break;
    }
    case 'apply-group': {
      const group = ui.state.groups.find((item) => String(item.id) === id);
      if (!group) throw new Error('这条建议已更新，请刷新后重试。');
      await operation('group-' + id, async () => {
        await request('APPLY_GROUP', {group, windowId}); ui.applied.add(group.id); ui.canUndo = true;
        await refresh({quiet: true}); toast('分组已应用。可以撤销最近一次分组。');
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
      if (task) confirmDialog('删除这个任务？', '“' + task.name + '”的保存页面和备注将被删除。浏览器中打开的页面不受影响。', '删除任务', async () => { await request('DELETE_TASK', {id}); toast('任务已删除。'); });
      break;
    }
    case 'restore-task':
      await operation('restore-' + id, async () => {
        const result = await request('RESTORE_TASK', {id, windowId}); await refresh({quiet: true});
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
    case 'timeline-status': ui.timelineStatus = target.dataset.status; ui.timelineLimit = 60; render(); break;
    case 'timeline-more': ui.timelineLimit += 60; render(); break;
    case 'timeline-tag': ui.timelineTag = target.dataset.tag; ui.timelineLimit = 60; if (ui.view === 'review') navigate('timeline'); else render(); break;
    case 'clear-timeline-tag': ui.timelineTag = ''; render(); break;
    case 'tag-timeline': ui.timelineTag = target.dataset.tag; ui.timelineStatus = 'all'; navigate('timeline'); break;
    case 'select-tag': ui.selectedTag = target.dataset.tag; ui.selectedEdge = ''; render(); break;
    case 'map-scope': ui.mapScope = target.dataset.scope; render(); break;
    case 'select-edge': if (!isPanel) ui.selectedTag = target.dataset.from; ui.selectedEdge = target.dataset.from + '\u0000' + target.dataset.to; render(); break;
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
      confirmDialog('清除浏览历史？', '删除已记录的浏览片段与历史分析，保留手动保存的任务。清除后无法恢复，建议先导出备份。', '清除历史', async () => { await request('CLEAR_HISTORY'); ui.selectedTag = ''; toast('浏览历史已清除，保存的任务仍在。'); });
      break;
    case 'clear-all':
      confirmDialog('清除全部本机数据？', '这将删除浏览历史、所有保存的任务并重置设置。浏览器页面不会关闭。此操作无法撤销。', '清除全部', async () => {
        await request('CLEAR_ALL'); ui.settingsDirty = false; ui.selected.clear(); ui.selectedTag = ''; ui.applied.clear(); ui.canUndo = false; toast('全部本机数据已清除。');
      }, true);
      break;
    case 'close-dialog': document.getElementById('dialog').close(); break;
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
  if (target.dataset.tabSelect) {
    const id = Number(target.dataset.tabSelect);
    if (target.checked) ui.selected.add(id); else ui.selected.delete(id);
    render();
  } else if (target.id === 'select-all') {
    for (const tab of filteredTabs()) { if (target.checked) ui.selected.add(tab.id); else ui.selected.delete(tab.id); }
    render();
  } else if (target.id === 'workspace-view') { navigate(target.value); }
  else if (target.id === 'map-topic-choice') { ui.selectedTag = target.value; ui.selectedEdge = ''; render(); }
  else if (target.id === 'page-sort') { ui.sort = target.value; render(); }
  else if (target.dataset.rangeControl) { ui.range = target.value; ui.timelineLimit = 60; operation('range', () => refresh({quiet: true})); }
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
  chrome.tabs.onActivated.addListener(schedule);
  chrome.tabs.onUpdated.addListener((_id, change) => { if (change.url || change.title || change.status === 'complete') schedule(); });
  chrome.tabs.onRemoved.addListener(schedule);
  const heartbeat = setInterval(schedule, 15000);
  window.addEventListener('pagehide', () => { clearTimeout(refreshTimer); clearInterval(heartbeat); });
}
buildShell(); render();
await refresh({quiet: true});
