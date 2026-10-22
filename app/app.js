const params = new URLSearchParams(location.search);
const isDemo = params.get('demo') === '1';
const viewNames = {pages: '当前页面', tasks: '任务工作台', timeline: '时间线', map: '注意力地图', settings: '设置'};
const viewIcons = {pages: 'layers', tasks: 'folder', timeline: 'clock', map: 'nodes', settings: 'settings'};
const palette = {grey: '#929889', gray: '#929889', blue: '#8a9eb3', red: '#bd8579', yellow: '#c0a56c', green: '#8caa8c', pink: '#b492a4', purple: '#a494b3', cyan: '#7ba9a4', orange: '#d89068'};
const iconPaths = {
  mark: ['M5 19V6a2 2 0 0 1 2-2h12', 'M5 11h11', 'M11 11v8'],
  layers: ['M4 5h16v14H4z', 'M4 9h16', 'M8 5v4'],
  folder: ['M3 7h7l2-3h8v16H3z', 'M3 7v-3h6l3 3'],
  clock: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18', 'M12 7v5l3 2'],
  nodes: ['M8 6l8 1', 'M6 9l3 8', 'M17 10l-5 7', 'M3 6a3 3 0 1 0 6 0 3 3 0 0 0-6 0', 'M16 7a3 3 0 1 0 6 0 3 3 0 0 0-6 0', 'M7 20a3 3 0 1 0 6 0 3 3 0 0 0-6 0'],
  settings: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8', 'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z'],
  shield: ['M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z', 'M8 12l3 3 5-6'],
  pause: ['M8 5v14', 'M16 5v14'],
  play: ['M7 4l13 8-13 8z'],
  arrow: ['M5 12h14', 'M14 7l5 5-5 5'],
  chevron: ['M9 5l7 7-7 7'],
  refresh: ['M20 7v5h-5', 'M4 17v-5h5', 'M5.2 7a8 8 0 0 1 13-2L20 8', 'M4 16l1.8 3a8 8 0 0 0 13-2'],
  search: ['M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14', 'M15 15l6 6'],
  plus: ['M12 5v14', 'M5 12h14'],
  spark: ['M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z'],
  undo: ['M8 5L3 10l5 5', 'M3 10h11a6 6 0 0 1 0 12'],
  save: ['M4 3h14l3 3v15H3V3z', 'M7 3v6h10V3', 'M7 21v-8h10v8'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  check: ['M4 12l5 5L20 6'],
  edit: ['M4 16l12-12 4 4L8 20H4z', 'M13 7l4 4'],
  trash: ['M3 6h18', 'M9 6V3h6v3', 'M6 6l1 15h10l1-15', 'M10 10v7', 'M14 10v7'],
  page: ['M6 3h8l4 4v14H6z', 'M14 3v5h4', 'M9 12h6', 'M9 16h6'],
  download: ['M12 3v12', 'M7 10l5 5 5-5', 'M4 17v4h16v-4'],
  lock: ['M5 10h14v11H5z', 'M8 10V7a4 4 0 0 1 8 0v3', 'M12 14v3'],
  info: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18', 'M12 11v6', 'M12 7h.01'],
  external: ['M14 3h7v7', 'M21 3L10 14', 'M10 5H4v15h15v-6']
};
function el(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') element.className = value;
    else if (key === 'style' && typeof value === 'object') {
      for (const [property, setting] of Object.entries(value)) {
        if (property.startsWith('--')) element.style.setProperty(property, setting);
        else element.style[property] = setting;
      }
    }
    else if (key === 'checked' || key === 'disabled' || key === 'selected') element[key] = Boolean(value);
    else if (key === 'value') element.value = value;
    else element.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}
function svgEl(tag, attributes = {}, ...children) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  for (const child of children.flat(Infinity)) if (child != null) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
function icon(name) {
  return svgEl('svg', {viewBox: '0 0 24 24', class: 'icon', 'aria-hidden': 'true'}, (iconPaths[name] || iconPaths.page).map((d) => svgEl('path', {d})));
}
function button(label, action, attributes = {}, className = '', iconName) {
  return el('button', {type: 'button', class: 'btn ' + className, 'data-action': action, ...attributes}, iconName && icon(iconName), label);
}
function iconButton(label, action, iconName, attributes = {}, className = '') {
  return el('button', {type: 'button', class: 'icon-button ' + className, title: label, 'aria-label': label, 'data-action': action, ...attributes}, icon(iconName));
}
function tagChip(text, action, attributes = {}) {
  return el(action ? 'button' : 'span', {class: 'tag', ...(action ? {type: 'button', 'data-action': action, 'data-tag': text} : {}), ...attributes}, text);
}
function duration(ms, precise = false) {
  const seconds = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  if (!seconds) return '0 分钟';
  if (seconds < 60) return precise ? seconds + ' 秒' : '< 1 分钟';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + ' 分钟';
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return hours + ' 小时' + (rest ? ' ' + rest + ' 分' : '');
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
    version: value?.version || '2.0.0',
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
  view: Object.hasOwn(viewNames, location.hash.slice(1)) ? location.hash.slice(1) : 'pages',
  state: null, error: '', busy: new Set(), selected: new Set(), applied: new Set(),
  queries: {pages: '', tasks: ''}, pageFilter: 'all', sort: 'recent', timelineDays: 'today',
  timelineStatus: 'all', timelineLimit: 60, timelineTag: '', selectedTag: '',
  selectedEdge: '', canUndo: false, settingsDraft: null, settingsDirty: false, lastRefresh: 0
};
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
async function refresh({quiet = false} = {}) {
  try {
    const value = await request('GET_STATE', {windowId});
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
  const sidebar = el('aside', {class: 'sidebar', 'aria-label': '主要导航'},
    el('a', {class: 'brand', href: '#pages', 'aria-label': 'Focuence 智序 · 当前页面'}, el('span', {class: 'brand-mark'}, icon('mark')), el('span', {class: 'brand-name'}, 'Focuence', el('small', {}, '智序'))),
    el('nav', {class: 'nav-list', id: 'navigation'}),
    el('div', {class: 'sidebar-bottom'}, el('div', {class: 'local-note'}, icon('shield'), '你的思路，留在本机'),
      el('p', {}, '页面与浏览记录保存在本地。', el('br'), '无需账号，也无需 API 密钥。'),
      el('div', {id: 'sidebar-tracking'}), el('div', {class: 'version'}, 'FOCUENCE / 2.0')));
  const workspace = el('div', {class: 'workspace'},
    el('header', {class: 'topbar'}, el('div', {class: 'breadcrumbs'}, el('span', {}, '我的浏览空间'), icon('chevron'), el('strong', {id: 'breadcrumb'}, viewNames[ui.view])),
      el('div', {class: 'topbar-actions'}, el('span', {class: 'local-status', id: 'top-status'}), iconButton('刷新当前数据', 'refresh', 'refresh'))),
    el('main', {class: 'main', id: 'main', tabindex: '-1'}));
  app.replaceChildren(sidebar, workspace);
}
function renderNavigation() {
  const count = ui.state?.tasks.length || 0;
  document.getElementById('navigation').replaceChildren(...Object.keys(viewNames).map((view) => el('button', {
    type: 'button', class: 'nav-button' + (ui.view === view ? ' active' : ''),
    'data-action': 'navigate', 'data-view': view, 'aria-current': ui.view === view ? 'page' : undefined
  }, icon(viewIcons[view]), viewNames[view], view === 'tasks' && count > 0 && el('span', {class: 'nav-count'}, count))));
  document.getElementById('breadcrumb').textContent = viewNames[ui.view];
  const tracking = ui.state?.settings.tracking !== false;
  document.getElementById('sidebar-tracking').replaceChildren(el('button', {type: 'button', class: 'pause-button', 'data-action': 'toggle-tracking', disabled: !ui.state || busy('tracking')}, icon(tracking ? 'pause' : 'play'), tracking ? '暂停浏览记录' : '恢复浏览记录'));
  document.getElementById('top-status').replaceChildren(el('span', {class: 'status-dot' + (tracking ? '' : ' paused')}), isDemo ? 'DEMO · 独立示例' : tracking ? 'LOCAL · 本机处理' : 'LOCAL · 记录已暂停');
}
function heading(title, description, actions = []) {
  return el('div', {class: 'page-header'}, el('div', {class: 'page-heading'}, el('h1', {}, title), el('p', {}, description)), actions.length > 0 && el('div', {class: 'header-actions'}, actions));
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
    el('input', {type: 'checkbox', 'data-tab-select': tab.id, checked: ui.selected.has(tab.id), 'aria-label': '选择 ' + (tab.title || tab.domain)}),
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
      button(applied ? '已应用' : '应用分组', 'apply-group', {'data-id': group.id, disabled: applied || group.protected || busy('group-' + group.id)}, 'small', applied ? 'check' : 'plus')));
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
      button(selectedCount ? '保存所选 · ' + selectedCount : '保存为任务', 'save-selection', {disabled: ui.state.tabs.length === 0}, '', 'save'),
      button(busy('rules') ? '正在整理…' : '快速整理', 'propose', {disabled: busy('rules') || busy('semantic') || ui.state.tabs.length < 2}, 'primary', 'layers')
    ]),
    statStrip(),
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
function taskCard(task) {
  const pages = task.pages || [];
  return el('article', {class: 'task-card', style: {'--task-color': colorOf(task.color)}},
    el('div', {class: 'task-card-head'}, el('div', {},
      el('button', {class: 'task-name', type: 'button', 'data-action': 'edit-task', 'data-id': task.id}, task.name),
      el('p', {class: 'task-date'}, dateLabel(task.updatedAt || task.createdAt) + ' 更新')),
      iconButton('编辑 ' + task.name, 'edit-task', 'edit', {'data-id': task.id})),
    task.notes && el('p', {class: 'task-note'}, task.notes),
    el('ul', {class: 'task-pages'}, pages.slice(0, 3).map((page) => el('li', {}, icon('page'), el('span', {title: page.title || page.url}, page.title || domainOf(page.url))))),
    el('div', {class: 'task-footer'}, el('span', {class: 'task-count'}, pages.length + ' 个页面 · 手动保留'),
      el('div', {class: 'button-cluster'},
        iconButton('删除 ' + task.name, 'delete-task', 'trash', {'data-id': task.id}, 'danger'),
        button(busy('restore-' + task.id) ? '恢复中…' : '继续任务', 'restore-task', {'data-id': task.id, disabled: busy('restore-' + task.id)}, 'small', 'arrow'))));
}
function renderTasks() {
  const query = ui.queries.tasks.trim().toLocaleLowerCase();
  const tasks = ui.state.tasks.filter((task) => !query || [task.name, task.notes, ...(task.pages || []).map((page) => page.title)].join(' ').toLocaleLowerCase().includes(query));
  return [
    heading('任务工作台', '把相关页面留在一起，下次从这里接着走。', [button('保存当前页面', 'save-selection', {disabled: !ui.state.tabs.length}, 'primary', 'plus')]),
    continuationSuggestions(),
    el('div', {class: 'list-tools tasks-tools'}, searchBox('tasks', '搜索任务、备注或保存的页面'), el('span', {class: 'subtle-label'}, ui.state.tasks.length + ' 个已保存任务')),
    tasks.length ? el('section', {class: 'task-grid', 'aria-label': '已保存任务'}, tasks.map(taskCard)) : emptyState(query ? '没有找到这个任务' : '为一件事，留下一组页面', query ? '试试任务名、备注里的关键词，或者页面标题。' : '先在当前页面选择相关资料，保存任务并写下下一次要继续的地方。', query ? null : 'nav-pages', '去选择页面', false, 'folder'),
    el('p', {class: 'list-footnote'}, '恢复任务会复用已经打开的页面；每次最多恢复 30 个。保存任务不会自动判断事情是否完成。')
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
  const midnight = new Date().setHours(0, 0, 0, 0);
  const rangeStart = ui.timelineDays === 'today' ? midnight : ui.timelineDays === 'yesterday' ? midnight - 86400000 : midnight - 6 * 86400000;
  const rangeEnd = ui.timelineDays === 'yesterday' ? midnight : midnight + 86400000;
  return ui.state.segments.filter((segment) => {
    if (Number(segment.endedAt) <= rangeStart || Number(segment.startedAt) >= rangeEnd) return false;
    if (ui.timelineStatus !== 'all' && segment.status !== ui.timelineStatus) return false;
    return !ui.timelineTag || tagsOf(segment).includes(ui.timelineTag);
  }).map((segment) => {
    const startedAt = Math.max(rangeStart, Number(segment.startedAt));
    const endedAt = Math.min(rangeEnd, Number(segment.endedAt));
    const portion = Math.max(0, endedAt - startedAt) / Math.max(1, Number(segment.endedAt) - Number(segment.startedAt));
    return {...segment, startedAt, endedAt, foregroundMs: (Number(segment.foregroundMs) || 0) * portion};
  }).sort((a, b) => b.startedAt - a.startedAt);
}
function timelineEntry(segment) {
  const statusLabel = {active: '前台停留', idle: '暂离 · 不计入前台', unknown: '记录缺口 · 不计入前台'}[segment.status] || '未知状态';
  return el('article', {class: 'timeline-entry ' + segment.status},
    el('div', {class: 'timeline-clock'}, timeLabel(segment.startedAt)),
    el('div', {class: 'timeline-track'}, el('span', {class: 'timeline-point'})),
    el('div', {class: 'timeline-content'},
      el('div', {class: 'timeline-title-row'},
        el('button', {type: 'button', class: 'timeline-title', 'data-action': 'open-page', 'data-url': segment.url, disabled: !/^https?:\/\//.test(segment.url || '')}, segment.title || domainOf(segment.url)),
        el('span', {class: 'timeline-duration'}, duration(segment.status === 'active' ? segment.foregroundMs : segment.endedAt - segment.startedAt, true))),
      el('div', {class: 'timeline-meta'}, el('span', {}, timeLabel(segment.startedAt) + '–' + timeLabel(segment.endedAt)), el('span', {class: segment.status === 'active' ? '' : 'timeline-status'}, statusLabel), tagsOf(segment).slice(0, 3).map((tag) => tagChip(tag, 'timeline-tag')))));
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
  const summary = tagStats(segments);
  return [
    heading('时间线', '回到某个片刻，看看思路是怎样走到这里的。', [button('刷新记录', 'flush-refresh', {disabled: busy('flush')}, '', 'refresh')]),
    ui.state.timelineTruncated && el('p', {class: 'panel-intro'}, '界面展示最近 2,000 条记录；今日概况与关系统计使用近 7 天全部记录。完整历史可在设置中导出。'),
    el('div', {class: 'timeline-tools'},
      el('div', {class: 'filter-row'}, [['all', '全部记录'], ['active', '前台'], ['idle', '暂离'], ['unknown', '未知']].map(([value, label]) => el('button', {type: 'button', class: 'filter-button' + (ui.timelineStatus === value ? ' active' : ''), 'data-action': 'timeline-status', 'data-status': value, 'aria-pressed': ui.timelineStatus === value}, label))),
      el('select', {class: 'standard-select', id: 'timeline-range', 'aria-label': '时间范围'}, [['today', '今天'], ['yesterday', '昨天'], ['week', '最近 7 天']].map(([value, label]) => el('option', {value, selected: ui.timelineDays === value}, label)))),
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
  const entries = tagStats(ui.state.segments);
  const edges = normalizedTransitions();
  for (const edge of edges) {
    for (const tag of [edge.from, edge.to]) if (!entries.some((entry) => entry.tag === tag)) entries.push({tag, foregroundMs: 0, visits: 0});
  }
  return {entries: entries.sort((a, b) => b.foregroundMs - a.foregroundMs), edges};
}
function graph(entries, edges) {
  const compact = window.matchMedia('(max-width: 640px)').matches;
  const nodes = entries.slice(0, compact ? 5 : 8);
  const width = compact ? 360 : 700, height = compact ? 400 : 440, center = {x: width / 2, y: height / 2};
  const maximum = Math.max(1, ...nodes.map((node) => node.foregroundMs));
  const positions = new Map();
  nodes.forEach((node, index) => {
    const count = nodes.length - 1;
    const angle = ((index - 1) / Math.max(1, count)) * Math.PI * 2 - Math.PI / 2;
    positions.set(node.tag, index === 0 ? {...center, radius: compact ? 43 : 53} : {x: center.x + Math.cos(angle) * (compact ? 115 : 225), y: center.y + Math.sin(angle) * (compact ? 128 : 151), radius: (compact ? 30 : 34) + node.foregroundMs / maximum * (compact ? 6 : 11)});
  });
  const arrow = svgEl('marker', {id: 'map-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse'}, svgEl('path', {d: 'M 0 0 L 10 5 L 0 10 z', fill: '#aebf9e'}));
  const highlightedArrow = svgEl('marker', {id: 'map-arrow-active', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse'}, svgEl('path', {d: 'M 0 0 L 10 5 L 0 10 z', fill: '#db653a'}));
  const svg = svgEl('svg', {viewBox: '0 0 ' + width + ' ' + height, class: 'graph-canvas', role: 'group', 'aria-label': '主题切换有向图。点击主题查看停留时间，点击连线查看切换次数。下方有同等信息的表格。'}, svgEl('defs', {}, arrow, highlightedArrow));
  const shownEdges = edges.filter((edge) => positions.has(edge.from) && positions.has(edge.to)).slice(0, 16);
  const maxCount = Math.max(1, ...shownEdges.map((edge) => edge.count));
  for (const edge of shownEdges) {
    const from = positions.get(edge.from), to = positions.get(edge.to);
    const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy) || 1;
    const baseBend = shownEdges.some((other) => other.from === edge.to && other.to === edge.from) ? 24 : 10;
    // Route around unrelated nodes so a direct edge cannot look like a visit
    // through the central topic. Endpoints follow the curve's actual tangent.
    const obstacles = [...positions.values()].filter(position => position !== from && position !== to);
    const candidates = [baseBend, -baseBend, 70, -70, 140, -140, 210, -210, 280, -280].map(bend => {
      const control = {x: (from.x + to.x) / 2 - dy / length * bend, y: (from.y + to.y) / 2 + dx / length * bend};
      const aLength = Math.hypot(control.x - from.x, control.y - from.y) || 1;
      const bLength = Math.hypot(control.x - to.x, control.y - to.y) || 1;
      const start = {x: from.x + (control.x - from.x) / aLength * (from.radius + 4), y: from.y + (control.y - from.y) / aLength * (from.radius + 4)};
      const end = {x: to.x + (control.x - to.x) / bLength * (to.radius + 9), y: to.y + (control.y - to.y) / bLength * (to.radius + 9)};
      let penalty = Math.abs(bend) / 1000;
      for (let step = 0; step <= 24; step++) {
        const t = step / 24, u = 1 - t;
        const point = {x: u * u * start.x + 2 * u * t * control.x + t * t * end.x, y: u * u * start.y + 2 * u * t * control.y + t * t * end.y};
        if (point.x < 8 || point.x > width - 8 || point.y < 8 || point.y > height - 8) penalty += 10000;
        for (const obstacle of obstacles) penalty += Math.max(0, obstacle.radius + 9 - Math.hypot(point.x - obstacle.x, point.y - obstacle.y)) * 100;
      }
      return {start, end, control, penalty};
    }).sort((a, b) => a.penalty - b.penalty);
    const {start, end, control: {x: cx, y: cy}} = candidates[0];
    const key = edge.from + '\u0000' + edge.to, selected = ui.selectedEdge === key;
    svg.append(svgEl('path', {d: 'M' + start.x + ',' + start.y + ' Q' + cx + ',' + cy + ' ' + end.x + ',' + end.y, class: 'graph-edge' + (selected ? ' selected' : ''), 'stroke-width': 1.2 + edge.count / maxCount * 3, 'marker-end': selected ? 'url(#map-arrow-active)' : 'url(#map-arrow)', role: 'button', tabindex: 0, 'data-action': 'select-edge', 'data-from': edge.from, 'data-to': edge.to, 'aria-label': edge.from + ' 到 ' + edge.to + '，观察到 ' + edge.count + ' 次切换'}, svgEl('title', {}, edge.from + ' → ' + edge.to + ' · ' + edge.count + ' 次')));
  }
  for (const node of nodes) {
    const position = positions.get(node.tag);
    const limit = compact ? 5 : 8;
    const label = node.tag.length > limit ? node.tag.slice(0, limit - 1) + '…' : node.tag;
    const group = svgEl('g', {id: 'map-node-' + encodeURIComponent(node.tag), class: 'graph-node' + (ui.selectedTag === node.tag ? ' selected' : ''), transform: 'translate(' + position.x + ',' + position.y + ')', role: 'button', tabindex: 0, 'data-action': 'select-tag', 'data-tag': node.tag, 'aria-label': node.tag + '，分摊前台时长 ' + duration(node.foregroundMs), 'aria-pressed': ui.selectedTag === node.tag}, svgEl('circle', {r: position.radius}), svgEl('text', {y: -2}, label), svgEl('text', {y: 15, class: 'graph-node-time'}, duration(node.foregroundMs)), svgEl('title', {}, node.tag));
    svg.append(group);
  }
  return svg;
}
function mapDetail(entries, edges) {
  const selected = entries.find((entry) => entry.tag === ui.selectedTag) || entries[0];
  if (!selected) return el('aside', {class: 'map-detail'}, el('p', {class: 'detail-label'}, '主题详情'), el('h2', {}, '从一次浏览开始'), el('p', {class: 'panel-intro'}, '积累记录后，点选主题即可查看停留与切换关系。'));
  if (!ui.selectedTag) ui.selectedTag = selected.tag;
  const next = edges.filter((edge) => edge.from === selected.tag).slice(0, 4);
  const selectedEdge = edges.find((edge) => edge.from + '\u0000' + edge.to === ui.selectedEdge);
  return el('aside', {class: 'map-detail'},
    el('p', {class: 'detail-label'}, '选中的主题'), el('h2', {}, selected.tag),
    el('p', {class: 'map-detail-value'}, duration(selected.foregroundMs)), el('p', {class: 'map-detail-caption'}, '最近记录的分摊前台时长'),
    el('div', {class: 'next-links'}, el('h3', {}, '曾经接着去'),
      next.length ? next.map((edge) => el('button', {type: 'button', class: 'next-link', 'data-action': 'select-tag', 'data-tag': edge.to}, edge.to, el('span', {}, edge.count + ' 次'), icon('chevron'))) : el('p', {class: 'subtle-label'}, '还没有足够的后续切换记录。')),
    selectedEdge && el('p', {class: 'panel-intro'}, selectedEdge.from + ' → ' + selectedEdge.to + '：观察到 ' + selectedEdge.count + ' 次。' + (selectedEdge.count < 5 ? '样本较少，仅作回顾线索。' : '这是过去的路径，不能保证下一步会发生。')),
    button('在时间线中回看', 'tag-timeline', {'data-tag': selected.tag}, 'small', 'clock'));
}
function transitionTable(edges) {
  return el('div', {class: 'table-scroll'}, el('table', {class: 'transition-table'},
    el('thead', {}, el('tr', {}, ['从这个主题', '接着去', '观察次数', '占该主题后续切换'].map((label) => el('th', {scope: 'col'}, label)))),
    el('tbody', {}, edges.slice(0, 20).map((edge) => el('tr', {},
      el('td', {}, el('button', {type: 'button', 'data-action': 'select-tag', 'data-tag': edge.from}, edge.from)),
      el('td', {}, el('button', {type: 'button', 'data-action': 'select-tag', 'data-tag': edge.to}, edge.to)),
      el('td', {}, edge.count + ' 次'), el('td', {}, Math.round(edge.probability * 100) + '%' + (edge.count < 5 ? ' · 样本较少' : '')))))));
}
function renderMap() {
  const {entries, edges} = mapData();
  if (!entries.some((entry) => entry.tag === ui.selectedTag)) ui.selectedTag = entries[0]?.tag || '';
  return [
    heading('注意力地图', '主题之间的来回，留下了思路的路径。', [button('刷新记录', 'flush-refresh', {disabled: busy('flush')}, '', 'refresh')]),
    el('div', {class: 'map-layout'}, el('section', {class: 'map-panel', 'aria-label': '主题切换关系'},
      el('div', {class: 'map-toolbar'}, el('strong', {}, '最近记录的主题关系'), el('span', {}, '圆点 · 前台时长　箭头 · 后续切换')),
      entries.length ? graph(entries, edges) : emptyState('地图会随浏览慢慢长出来', '它从真实的页面访问与切换记录中生成。先正常浏览，再回来看看。', null, null, false, 'nodes'),
      el('p', {class: 'map-footnote'}, '前台时长不等于实际注意力。连线只表示先后关系；图中展示主要主题，完整关系可导出。')),
      mapDetail(entries, edges)),
    el('section', {class: 'transition-section'}, el('div', {class: 'section-heading'}, el('h2', {}, '看清每一次接续'), el('span', {}, edges.length + ' 条已观察关系')),
      edges.length ? transitionTable(edges) : el('p', {class: 'panel-intro'}, '暂未观察到跨主题的有效切换。暂离与未知时段不会被连接成路径。')),
    el('p', {class: 'list-footnote'}, '占比基于已观察的切换次数，仅用于回顾。低样本时不据此作确定性预测。')
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
  const content = [];
  if (isDemo) content.push(el('div', {class: 'demo-banner'}, icon('info'), el('p', {}, '示例模式 · 所有页面、时长与路径均为示例。交互只保留在当前页面内存，不写入真实记录。')));
  if (ui.error) content.push(el('div', {class: 'alert', role: 'alert'}, el('p', {}, ui.error), button('重新连接', 'refresh', {}, 'small', 'refresh')));
  if (!ui.state) {
    if (!ui.error) content.push(el('div', {class: 'loading-shell'}, el('div', {class: 'spinner'}), '正在读取本机浏览空间…'));
    else content.push(emptyState('暂时无法读取浏览空间', '确认扩展已经安装并启用，然后重试。', null, null));
  } else {
    const renderers = {pages: renderPages, tasks: renderTasks, timeline: renderTimeline, map: renderMap, settings: renderSettings};
    content.push(...renderers[ui.view]());
  }
  main.replaceChildren(...content);
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
  ui.view = view; location.hash = view; render();
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
    el('div', {class: 'dialog-actions'}, button('取消', 'close-dialog'), el('button', {type: 'submit', class: 'btn primary'}, icon('save'), task ? '保存修改' : '保存任务')));
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
        toast('已复用 ' + (result?.reused || 0) + ' 个页面，新开 ' + (result?.opened || 0) + ' 个。');
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
    case 'timeline-tag': ui.timelineTag = target.dataset.tag; ui.timelineLimit = 60; render(); break;
    case 'clear-timeline-tag': ui.timelineTag = ''; render(); break;
    case 'tag-timeline': ui.timelineTag = target.dataset.tag; ui.timelineDays = 'week'; ui.timelineStatus = 'all'; navigate('timeline'); break;
    case 'select-tag': ui.selectedTag = target.dataset.tag; ui.selectedEdge = ''; render(); break;
    case 'select-edge': ui.selectedTag = target.dataset.from; ui.selectedEdge = target.dataset.from + '\u0000' + target.dataset.to; render(); break;
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
  } else if (target.id === 'page-sort') { ui.sort = target.value; render(); }
  else if (target.id === 'timeline-range') { ui.timelineDays = target.value; ui.timelineLimit = 60; render(); }
  else if (target.id.startsWith('setting-')) captureSettings();
});
window.addEventListener('hashchange', () => {
  const view = location.hash.slice(1);
  if (Object.hasOwn(viewNames, view) && ui.view !== view) { ui.view = view; render(); }
});
window.matchMedia('(max-width: 640px)').addEventListener('change', () => {
  if (ui.view === 'map' && ui.state) render();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() - ui.lastRefresh > 5000 && !ui.busy.size && !document.getElementById('dialog').open) refresh({quiet: true});
});
buildShell(); render();
await refresh({quiet: true});
