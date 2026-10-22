import { createActivityState, reduceActivity, previewActivity } from './src/activity.js';
import { openStore } from './src/store.js';
import { computeAnalytics, computeReview, calendarRange } from './src/analytics.js';
import { planTaskRestore, taskViews } from './src/tasks.js';
import { pageFromTab, normalizeUrl, embeddingText, stableHash } from './src/text.js';
import { proposeGroups } from './src/grouping.js';

const VERSION = chrome.runtime.getManifest().version;
const MODEL = 'bge-small-zh-v1.5@75c43b0:q8:cls:128:v1';
const MODEL_NAME = 'BGE Small · 中文 · q8';
const COLORS = new Set(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange']);
let store, settings, activity, browserSessionId, initPromise;
let activityQueue = Promise.resolve();
let offscreenPromise = null;
let semanticQueue = Promise.resolve();
let sessionWrites = Promise.resolve();
let dataEpoch = 0;
let model = { status: 'idle', name: MODEL_NAME, progress: 0 };
let lastUndo = null;
const proposals = new Map();

function persistSession() {
  const job = sessionWrites.then(() => chrome.storage.session.set({ focuenceUndo: lastUndo, focuenceProposals: [...proposals.entries()] }));
  sessionWrites = job.catch(() => {});
  return job;
}

function excluded(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return settings.excludedDomains.some(domain => host === domain || host.endsWith(`.${domain}`));
  } catch { return true; }
}

function allowedPage(tab) {
  const page = pageFromTab(tab);
  return page && !excluded(page.url) ? page : null;
}

function queueActivity(fn) {
  const result = activityQueue.then(async () => { await init(); return fn(); });
  activityQueue = result.catch(error => console.warn('Focuence activity:', error.message));
  return result;
}

async function applyActivity(event) {
  const result = reduceActivity(activity, event);
  activity = result.state;
  await store.saveActivity(activity, result.segments);
}

async function currentContext() {
  const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
  const focused = windows.find(window => window.focused && !window.incognito);
  if (!focused) return null;
  const [tab] = await chrome.tabs.query({ active: true, windowId: focused.id });
  const page = allowedPage(tab);
  if (!page) return null;
  const tasks = await store.getTasks();
  const task = tasks.find(item => item.pages?.some(saved => (saved.pageId || saved.id) === page.id));
  return { tabId: tab.id, windowId: tab.windowId, pageId: page.id, url: page.url, title: page.title, tags: page.tags, taskId: task?.id || null };
}

async function recordCurrent() {
  const context = settings.tracking ? await currentContext() : null;
  const idleState = await chrome.idle.queryState(settings.idleSeconds);
  if (context) await store.putPages([{ id: context.pageId, url: context.url, title: context.title, tags: context.tags, lastSeen: Date.now() }]);
  await applyActivity({ type: 'context', at: Date.now(), context, idleState, tracking: settings.tracking });
}

async function init() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    store = await openStore();
    settings = await store.getSettings();
    const session = await chrome.storage.session.get(['focuenceBrowserSessionId', 'focuenceUndo', 'focuenceProposals']);
    browserSessionId = session.focuenceBrowserSessionId || crypto.randomUUID();
    if (!session.focuenceBrowserSessionId) await chrome.storage.session.set({ focuenceBrowserSessionId: browserSessionId });
    lastUndo = session.focuenceUndo || null;
    for (const [id, groups] of session.focuenceProposals || []) proposals.set(id, groups);
    activity = await store.getActivity();
    if (!activity) activity = createActivityState({ now: Date.now(), sessionId: browserSessionId, maxGapMs: 90000 });
    else if (activity.sessionId !== browserSessionId) await applyActivity({ type: 'restart', at: Date.now(), sessionId: browserSessionId });
    if (!settings.tracking) await applyActivity({ type: 'pause', at: Date.now() });
    chrome.idle.setDetectionInterval(settings.idleSeconds);
    await chrome.alarms.create('focuence-checkpoint', { periodInMinutes: .5 });
    await chrome.alarms.create('focuence-prune', { periodInMinutes: 60 });
    await recordCurrent();
  })().catch(error => { initPromise = null; throw error; });
  return initPromise;
}

async function targetWindow(windowId) {
  if (Number.isInteger(windowId) && windowId >= 0) {
    const window = await chrome.windows.get(windowId);
    if (window.type === 'normal' && !window.incognito) return window.id;
    throw new Error('请选择普通浏览窗口');
  }
  const window = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
  if (window?.id >= 0 && !window.incognito) return window.id;
  throw new Error('没有可用的普通浏览窗口');
}

async function eligibleTabs(windowId) {
  const id = await targetWindow(windowId);
  const tabs = await chrome.tabs.query({ windowId: id });
  return tabs.flatMap(tab => {
    const page = allowedPage(tab);
    return page ? [{ id: tab.id, windowId: id, title: page.title, url: page.url, domain: page.domain, active: tab.active, pinned: tab.pinned, groupId: tab.groupId, index: tab.index, lastAccessed: tab.lastAccessed || 0, pageId: page.id, tags: page.tags, foregroundMs: 0 }] : [];
  });
}

async function ensureOffscreen() {
  const url = chrome.runtime.getURL('inference/offscreen.html');
  if ((await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] })).length) return;
  if (!offscreenPromise) offscreenPromise = chrome.offscreen.createDocument({ url: 'inference/offscreen.html', reasons: ['WORKERS'], justification: 'Run the bundled offline embedding model in one dedicated worker.' }).finally(() => { offscreenPromise = null; });
  await offscreenPromise;
}

async function infer(type, items, epoch = dataEpoch) {
  await ensureOffscreen();
  if (epoch !== dataEpoch) throw new Error('本机语义分析已取消');
  await chrome.alarms.create('focuence-model-idle', { delayInMinutes: 5 });
  const result = await chrome.runtime.sendMessage({ target: 'focuence-inference', type, items, epoch });
  if (epoch !== dataEpoch) throw new Error('本机语义分析已取消');
  if (!result?.ok) throw new Error(result?.error || '本机模型没有响应');
  model = { status: 'ready', name: MODEL_NAME, progress: 1 };
  return result.data;
}

async function embeddingsFor(tabs) {
  const generation = dataEpoch;
  const pages = [...new Map(tabs.filter(tab => !tab.pinned && tab.groupId < 0).map(tab => {
    const page = pageFromTab(tab); return [page.id, page];
  })).values()];
  const cached = new Map((await store.getVectors(pages.map(page => page.id))).map(item => [item.id, item]));
  const vectors = new Map(), pending = [];
  for (const page of pages) {
    const text = embeddingText(page), textHash = stableHash(text), item = cached.get(page.id);
    if (item?.model === MODEL && item.textHash === textHash && item.vector?.length === 512) vectors.set(page.id, item.vector);
    else pending.push({ id: page.id, text, textHash });
  }
  if (pending.length) {
    model = { status: 'loading', name: MODEL_NAME, progress: 0 };
    for (let offset = 0; offset < pending.length; offset += 48) {
      if (generation !== dataEpoch || !settings.semantic) throw new Error('本机语义分析已取消');
      const batch = pending.slice(offset, offset + 48);
      const result = await infer('INFERENCE_EMBED', batch, generation);
      if (generation !== dataEpoch || !settings.semantic) throw new Error('本机语义分析已取消');
      const records = result.vectors.map(item => ({ ...item, textHash: batch.find(input => input.id === item.id).textHash, model: MODEL, updatedAt: Date.now() }));
      await store.putVectors(records);
      for (const item of records) vectors.set(item.id, item.vector);
    }
  }
  return { vectors, cachedCount: pages.length - pending.length, computedCount: pending.length };
}

async function propose(message, epoch = dataEpoch) {
  if (epoch !== dataEpoch) throw new Error('本机语义分析已取消');
  const windowId = await targetWindow(message.windowId);
  const tabs = await eligibleTabs(windowId);
  const originalText = new Map(tabs.map(tab => [tab.pageId, stableHash(embeddingText(pageFromTab(tab)))]));
  const started = performance.now();
  let method = 'rules', metadata = { cachedCount: 0, computedCount: 0 }, embeddings;
  if (message.semantic && settings.semantic && tabs.length > 1) {
    try {
      const result = await embeddingsFor(tabs);
      embeddings = result.vectors; metadata = { cachedCount: result.cachedCount, computedCount: result.computedCount }; method = 'semantic';
    } catch (error) {
      if (epoch !== dataEpoch) throw new Error('本机语义分析已取消');
      model = { status: 'error', name: MODEL_NAME, progress: 0, error: error.message };
    }
  }
  const freshTabs = await eligibleTabs(windowId);
  if (embeddings) for (const tab of freshTabs) {
    if (originalText.get(tab.pageId) !== stableHash(embeddingText(pageFromTab(tab)))) embeddings.delete(tab.pageId);
  }
  const groups = proposeGroups(freshTabs, { embeddings, semantic: method === 'semantic', previousGroups: proposals.get(windowId) || [] });
  if (epoch !== dataEpoch) throw new Error('本机语义分析已取消');
  proposals.set(windowId, groups);
  await persistSession();
  return { groups, elapsedMs: Math.round(performance.now() - started), method, model, ...metadata };
}

function mergedSegments(saved, preview) {
  return [...new Map([...saved, ...preview].map(segment => [segment.id, segment])).values()].sort((a, b) => a.startedAt - b.startedAt);
}

async function getState(message) {
  await queueActivity(recordCurrent);
  const now = Date.now(), windowId = await targetWindow(message.windowId);
  const [tabs, tasks, saved, pages] = await Promise.all([
    eligibleTabs(windowId), store.getTasks(), store.listSegments({ since: calendarRange('week', now).startedAt }), store.getPages(),
  ]);
  const segments = mergedSegments(saved, previewActivity(activity, now));
  const lastSegment = segments.at(-1);
  const [activeTab] = await chrome.tabs.query({ windowId, active: true });
  const focusedWindow = await chrome.windows.get(windowId);
  const reviewingHere = focusedWindow.focused && activeTab?.url?.startsWith(chrome.runtime.getURL('app/'));
  const reviewContext = reviewingHere && lastSegment?.status === 'active' && lastSegment.foregroundMs > 0 && now - lastSegment.endedAt < 15 * 60000 ? lastSegment : null;
  const suggestionContext = activity.tracking && activity.idleState === 'active' && !activity.warning ? activity.context || reviewContext : null;
  const analytics = computeAnalytics({ segments, tasks, pages, now, currentContext: suggestionContext });
  const pageVisits = new Map();
  for (const segment of segments) {
    if (segment.status !== 'active') continue;
    const item = pageVisits.get(segment.pageId) || { foregroundMs: 0, lastSeen: 0 };
    item.foregroundMs += segment.foregroundMs;
    item.lastSeen = Math.max(item.lastSeen, segment.endedAt);
    pageVisits.set(segment.pageId, item);
  }
  for (const tab of tabs) Object.assign(tab, pageVisits.get(tab.pageId) || { foregroundMs: 0, lastSeen: 0 });
  const context = await currentContext();
  const idle = await chrome.idle.queryState(settings.idleSeconds);
  const { segments: scoped, transitions, ...attention } = computeReview({ segments, tasks, now, range: message.range });
  return { version: VERSION, windowId, settings, tabs, tasks: taskViews(tasks, tabs, segments), segments: scoped.slice(-2000), timelineTruncated: scoped.length > 2000, undoAvailable: Boolean(lastUndo), groups: proposals.get(windowId) || [], ...analytics, transitions, attention, model,
    trackingState: { status: !settings.tracking ? 'paused' : activity.warning ? 'unknown' : idle !== 'active' ? 'idle' : context ? 'active' : 'unfocused', activeTabId: context?.tabId, lastUpdatedAt: now, warning: activity.warning || null } };
}

async function applyGroup(group) {
  if (!Array.isArray(group?.tabIds) || !group.tabIds.length) throw new Error('请先生成一个分组建议');
  const tabs = (await Promise.all(group.tabIds.map(id => chrome.tabs.get(id).catch(() => null)))).filter(Boolean);
  const valid = tabs.filter(tab => allowedPage(tab) && !tab.pinned && tab.groupId < 0);
  if (valid.length < 2) throw new Error('至少需要两个仍未分组、未固定的页面；请刷新建议');
  if (new Set(valid.map(tab => tab.windowId)).size !== 1) throw new Error('分组只能包含同一个窗口中的页面');
  const proposedUrls = new Set((group.pages || []).map(page => normalizeUrl(page.url)));
  if (proposedUrls.size && valid.some(tab => !proposedUrls.has(normalizeUrl(tab.url)))) throw new Error('部分页面内容已经改变，请重新生成建议');
  const snapshot = valid.map(tab => ({ id: tab.id, windowId: tab.windowId, index: tab.index }));
  const groupId = await chrome.tabs.group({ tabIds: valid.map(tab => tab.id), createProperties: { windowId: valid[0].windowId } });
  const title = String(group.name || 'Focuence 分组').trim().slice(0, 60);
  const color = COLORS.has(group.color) ? group.color : 'orange';
  await chrome.tabGroups.update(groupId, { title, color, collapsed: false });
  const fingerprint = windowFingerprint(await chrome.tabs.query({ windowId: valid[0].windowId }));
  lastUndo = { groupId, title, color, tabs: snapshot, windowId: valid[0].windowId, fingerprint };
  const used = new Set(valid.map(tab => tab.id));
  const usedUrls = new Set(valid.map(tab => normalizeUrl(tab.url)));
  proposals.set(valid[0].windowId, (proposals.get(valid[0].windowId) || []).flatMap(candidate => {
    const tabIds = candidate.tabIds.filter(id => !used.has(id));
    return tabIds.length < 2 ? [] : [{ ...candidate, tabIds, pages: candidate.pages.filter(page => !usedUrls.has(normalizeUrl(page.url))) }];
  }));
  await persistSession();
  return { groupId };
}

function windowFingerprint(tabs) {
  return JSON.stringify([...tabs].sort((a, b) => a.index - b.index).map(tab => [tab.id, tab.groupId, tab.pinned]));
}

async function undoGroup() {
  if (!lastUndo) return { restored: false };
  const undo = lastUndo;
  const current = await chrome.tabGroups.get(undo.groupId).catch(() => null);
  if (!current) { lastUndo = null; await persistSession(); return { restored: false }; }
  if (current.title !== undo.title || current.color !== undo.color) throw new Error('这个分组已被手动修改，为保留你的修改，未撤销');
  const windowTabs = await chrome.tabs.query({ windowId: undo.windowId });
  if (windowFingerprint(windowTabs) !== undo.fingerprint) throw new Error('窗口中的页面顺序或分组已改变，为保留你的修改，未撤销');
  const tabs = (await chrome.tabs.query({ groupId: undo.groupId })).filter(tab => undo.tabs.some(saved => saved.id === tab.id));
  if (tabs.length) await chrome.tabs.ungroup(tabs.map(tab => tab.id));
  // Vacate every original member first, then insert them back. Direct one-pass
  // moves fail for interleaved original positions such as A / X / B / Y / C.
  for (const tab of undo.tabs) await chrome.tabs.move(tab.id, { index: -1 });
  for (const tab of [...undo.tabs].sort((a, b) => a.index - b.index)) {
    if (tabs.some(currentTab => currentTab.id === tab.id && currentTab.windowId === tab.windowId)) await chrome.tabs.move(tab.id, { index: tab.index }).catch(() => {});
  }
  lastUndo = null;
  await persistSession();
  return { restored: tabs.length > 0 };
}

async function saveTask(message) {
  let rawPages;
  if (message.group?.pages) rawPages = message.group.pages;
  else {
    const tabs = await eligibleTabs(message.windowId);
    rawPages = tabs.filter(tab => !Array.isArray(message.tabIds) || message.tabIds.includes(tab.id));
  }
  const pages = [...new Map(rawPages.flatMap(raw => {
    const page = allowedPage(raw); return page ? [[page.id, { pageId: page.id, url: page.url, title: page.title, tags: page.tags }]] : [];
  })).values()];
  if (!pages.length) throw new Error('请选择至少一个可保存的网页');
  if (pages.length > 30) throw new Error('单个任务最多保存 30 个页面，请缩小选择范围');
  const name = String(message.name || message.group?.name || '未命名任务').trim().slice(0, 80);
  if (!name) throw new Error('请填写任务名称');
  const now = Date.now();
  const task = { id: `task_${crypto.randomUUID()}`, name, color: COLORS.has(message.group?.color) ? message.group.color : 'orange', locked: true, createdAt: now, updatedAt: now, notes: String(message.notes || '').slice(0, 10000), pages };
  await store.putTask(task);
  return task;
}

async function restoreTask(message) {
  const task = await store.getTask(message.id);
  if (!task) throw new Error('这个任务已经不存在');
  const windowId = await targetWindow(message.windowId);
  const existing = await chrome.tabs.query({ windowId });
  const segments = await store.listSegments({ since: calendarRange('week').startedAt });
  const plan = planTaskRestore(task, existing, segments);
  const urls = new Map(existing.map(tab => [normalizeUrl(tab.url), tab.id]));
  let opened = 0, reused = 0;
  const failed = [], restored = [];
  for (const page of plan.pages) {
    if (urls.has(page.url)) { reused++; restored.push(page); continue; }
    try {
      const tab = await chrome.tabs.create({ windowId, url: page.url, active: false });
      urls.set(page.url, tab.id); opened++; restored.push(page);
    } catch (error) { failed.push({ pageId: page.pageId, title: page.title, error: error.message }); }
  }
  const resumePage = restored.find(page => page.url === plan.resumePage?.url) || restored[0];
  task.lastRestoreResult = { at: Date.now(), opened, reused, failedCount: failed.length };
  if (resumePage) {
    task.lastRestoredAt = task.lastRestoreResult.at; task.lastActivePageId = resumePage.pageId;
  }
  await store.putTask(task);
  if (resumePage) {
    await chrome.windows.update(windowId, { focused: true });
    await chrome.tabs.update(urls.get(resumePage.url), { active: true });
  }
  return { opened, reused, failed, activeTabId: resumePage ? urls.get(resumePage.url) : null };
}

async function updateSettings(patch = {}) {
  const clean = {};
  if (typeof patch.tracking === 'boolean') clean.tracking = patch.tracking;
  if (typeof patch.semantic === 'boolean') clean.semantic = patch.semantic;
  if (patch.idleSeconds != null && Number.isFinite(Number(patch.idleSeconds))) clean.idleSeconds = Math.max(15, Math.min(3600, Math.round(Number(patch.idleSeconds))));
  if (patch.retentionDays != null && Number.isFinite(Number(patch.retentionDays))) clean.retentionDays = Math.max(1, Math.min(365, Math.round(Number(patch.retentionDays))));
  if (Array.isArray(patch.excludedDomains)) clean.excludedDomains = [...new Set(patch.excludedDomains.map(value => {
    const raw = String(value).trim().replace(/^\*\./, '').replace(/^\./, '');
    try { return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.toLowerCase(); } catch { return ''; }
  }).filter(Boolean))].slice(0, 200);
  const previous = settings;
  settings = await store.setSettings(clean);
  const inferenceChanged = previous.semantic !== settings.semantic || JSON.stringify(previous.excludedDomains) !== JSON.stringify(settings.excludedDomains);
  if (inferenceChanged) {
    dataEpoch++;
    if ((await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length) await chrome.offscreen.closeDocument();
    model = { status: 'idle', name: MODEL_NAME, progress: 0 };
  }
  chrome.idle.setDetectionInterval(settings.idleSeconds);
  if (previous.tracking !== settings.tracking) await applyActivity({ type: settings.tracking ? 'resume' : 'pause', at: Date.now(), context: settings.tracking ? await currentContext() : null });
  await recordCurrent();
  proposals.clear();
  await persistSession();
  const pruned = await store.prune({ now: Date.now(), retentionDays: settings.retentionDays });
  if (pruned.activity) activity = pruned.activity;
  return settings;
}

async function clearData(all) {
  dataEpoch++;
  if ((await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length) await chrome.offscreen.closeDocument();
  model = { status: 'idle', name: MODEL_NAME, progress: 0 };
  if (all) await store.clearAll(); else await store.clearHistory();
  settings = await store.getSettings();
  activity = createActivityState({ now: Date.now(), sessionId: browserSessionId, maxGapMs: 90000 });
  if (!settings.tracking) await applyActivity({ type: 'pause', at: Date.now() });
  else await store.saveActivity(activity);
  proposals.clear(); lastUndo = null;
  await persistSession();
  return { cleared: true };
}

async function handle(message) {
  await init();
  switch (message.type) {
    case 'GET_STATE': return getState(message);
    case 'PROPOSE_GROUPS': {
      if (!message.semantic) return propose(message);
      const epoch = dataEpoch;
      const job = semanticQueue.then(() => propose(message, epoch));
      semanticQueue = job.catch(() => {}); return job;
    }
    case 'APPLY_GROUP': return applyGroup(message.group);
    case 'UNDO_GROUP': return undoGroup();
    case 'SAVE_TASK': return saveTask(message);
    case 'UPDATE_TASK': {
      const task = await store.getTask(message.id);
      if (!task) throw new Error('任务不存在');
      if (typeof message.name === 'string') { const name = message.name.trim().slice(0, 80); if (!name) throw new Error('任务名称不能为空'); task.name = name; }
      if (typeof message.notes === 'string') task.notes = message.notes.slice(0, 10000);
      task.updatedAt = Date.now(); await store.putTask(task); return task;
    }
    case 'DELETE_TASK': await store.deleteTask(message.id); return { deleted: true };
    case 'RESTORE_TASK': return restoreTask(message);
    case 'FOCUS_TAB': {
      const tab = await chrome.tabs.get(message.tabId);
      await chrome.windows.update(tab.windowId, { focused: true }); await chrome.tabs.update(tab.id, { active: true }); return { focused: true };
    }
    case 'OPEN_PAGE': {
      const url = normalizeUrl(message.url); if (!url) throw new Error('只能打开 HTTP(S) 网页');
      const windowId = await targetWindow(message.windowId);
      const tabs = await chrome.tabs.query({ windowId });
      const existing = tabs.find(tab => normalizeUrl(tab.url) === url);
      if (existing) { await chrome.tabs.update(existing.id, { active: true }); return { opened: false, reused: true }; }
      await chrome.tabs.create({ windowId, url }); return { opened: true, reused: false };
    }
    case 'UPDATE_SETTINGS': return queueActivity(() => updateSettings(message.patch));
    case 'FLUSH_ACTIVITY': await queueActivity(recordCurrent); return { saved: true };
    case 'EXPORT_DATA': await queueActivity(recordCurrent); return store.exportData();
    case 'CLEAR_HISTORY': return queueActivity(() => clearData(false));
    case 'CLEAR_ALL': return queueActivity(() => clearData(true));
    case 'MODEL_WARMUP': {
      if (!settings.semantic) throw new Error('请先启用本机语义分析');
      model = { status: 'loading', name: MODEL_NAME, progress: 0 };
      const epoch = dataEpoch;
      try { return await infer('INFERENCE_WARMUP', undefined, epoch); } catch (error) { if (epoch === dataEpoch) model = { status: 'error', name: MODEL_NAME, progress: 0, error: error.message }; throw error; }
    }
    default: throw new Error('未知操作');
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== 'background') return false;
  if (sender.id !== chrome.runtime.id) { sendResponse({ ok: false, error: '调用来源无效' }); return false; }
  if (message.type === 'MODEL_PROGRESS') {
    if (message.epoch !== dataEpoch) { sendResponse({ ok: true, data: model }); return false; }
    model = { status: message.status, name: MODEL_NAME, progress: message.progress || 0, ...(message.error ? { error: message.error } : {}) };
    sendResponse({ ok: true, data: model }); return false;
  }
  handle(message).then(data => sendResponse({ ok: true, data })).catch(error => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

const reconcile = () => queueActivity(recordCurrent).catch(() => {});
chrome.tabs.onActivated.addListener(reconcile);
chrome.tabs.onUpdated.addListener((_id, change) => { if (change.url || change.title || change.status === 'complete') reconcile(); });
chrome.tabs.onRemoved.addListener(reconcile);
chrome.tabs.onReplaced.addListener(reconcile);
chrome.windows.onFocusChanged.addListener(reconcile);
chrome.windows.onRemoved.addListener(id => { proposals.delete(id); if (lastUndo?.windowId === id) lastUndo = null; persistSession().catch(() => {}); });
chrome.idle.onStateChanged.addListener(state => queueActivity(async () => { await applyActivity({ type: 'idle', at: Date.now(), idleState: state }); await recordCurrent(); }).catch(() => {}));
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'focuence-model-idle') {
    chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }).then(async contexts => {
      if (contexts.length) await chrome.offscreen.closeDocument();
      model = { status: 'idle', name: MODEL_NAME, progress: 0 };
    }).catch(() => {});
  }
  if (alarm.name === 'focuence-checkpoint') reconcile();
  if (alarm.name === 'focuence-prune') queueActivity(async () => {
    const result = await store.prune({ now: Date.now(), retentionDays: settings.retentionDays });
    if (result.activity) activity = result.activity;
  }).catch(() => {});
});
chrome.runtime.onInstalled.addListener(reconcile);
chrome.runtime.onStartup.addListener(reconcile);
chrome.commands.onCommand.addListener(async command => {
  if (command !== 'open_workspace' && command !== 'open_side_panel') return;
  const windowId = await targetWindow();
  if (command === 'open_side_panel' && chrome.sidePanel?.open) {
    await chrome.sidePanel.open({ windowId }); return;
  }
  await chrome.tabs.create({ url: chrome.runtime.getURL(`app/index.html?windowId=${windowId}#review`), windowId });
});
init().catch(error => console.error('Focuence initialization:', error.message));
