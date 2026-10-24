import { createActivityState, reduceActivity, previewActivity } from './src/activity.js';
import { openStore, taskFrom, relationFrom, pageFrom, segmentFrom, settingsFrom } from './src/store.js';
import { computeAnalytics, computeReview, calendarRange } from './src/analytics.js';
import { planTaskRestore, taskViews } from './src/tasks.js';
import { pageFromTab, normalizeUrl, embeddingText, stableHash } from './src/text.js';
import { proposeGroups } from './src/grouping.js';
import { sealProposal, proposalIsCurrent, validateProposalSelection, STALE_PROPOSAL } from './src/proposals.js';
import { createWorkspace } from './src/workspace.js';
import { embedItems } from './src/semantic.js';
import { taskText } from './src/task-context.js';
import { workspaceCatalog } from './src/tab-workspace.js';
import { createTabOperations } from './src/tab-operations.js';
import { decodeBackup, planImport } from './src/backup.js';
import { recentSessions, restoreRecentSession } from './src/browser-history.js';

const VERSION = chrome.runtime.getManifest().version;
const MODEL = 'bge-small-zh-v1.5@75c43b0:q8:cls:128:v1';
const MODEL_NAME = 'BGE Small · 中文 · q8';
const COLORS = new Set(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange']);
let store, settings, activity, browserSessionId, initPromise, workspace, tabOperations;
const imports = new Map();
let activityQueue = Promise.resolve();
let offscreenPromise = null;
let semanticQueue = Promise.resolve();
let groupQueue = Promise.resolve();
let sessionWrites = Promise.resolve();
let dataEpoch = 0;
let model = { status: 'idle', name: MODEL_NAME, progress: 0 };
let lastUndo = null;
const proposals = new Map();
const proposalNotices = new Map();

function persistSession() {
  const job = sessionWrites.then(() => chrome.storage.session.set({ focuenceUndo: lastUndo, focuenceProposals: [...proposals.entries()], focuenceProposalNotices: [...proposalNotices.entries()], focuenceDataEpoch: dataEpoch }));
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
  const nextWorkspace = workspace?.afterObservation(result.state, result.segments);
  await store.saveActivity(result.state, result.segments, nextWorkspace);
  activity = result.state;
  workspace?.replaceState(nextWorkspace);
}

async function rawContext() {
  const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
  const focused = windows.find(window => window.focused && !window.incognito);
  if (!focused) return null;
  const [tab] = await chrome.tabs.query({ active: true, windowId: focused.id });
  const page = allowedPage(tab);
  if (!page) return null;
  return { tabId: tab.id, windowId: tab.windowId, pageId: page.id, url: page.url, title: page.title, tags: page.tags };
}

async function currentContext() {
  const raw = await rawContext();
  return workspace ? workspace.contextFor(raw) : raw;
}

function queueSemantic(operation) {
  const job = semanticQueue.then(operation);
  semanticQueue = job.catch(() => {});
  return job;
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
    const session = await chrome.storage.session.get(['focuenceBrowserSessionId', 'focuenceUndo', 'focuenceProposals', 'focuenceProposalNotices', 'focuenceDataEpoch']);
    dataEpoch = Number.isInteger(session.focuenceDataEpoch) ? session.focuenceDataEpoch : 0;
    browserSessionId = session.focuenceBrowserSessionId || crypto.randomUUID();
    if (!session.focuenceBrowserSessionId) await chrome.storage.session.set({ focuenceBrowserSessionId: browserSessionId });
    lastUndo = session.focuenceUndo || null;
    for (const [id, groups] of session.focuenceProposals || []) proposals.set(id, groups);
    for (const [id, notice] of session.focuenceProposalNotices || []) proposalNotices.set(id, notice);
    activity = await store.getActivity();
    if (!activity) activity = createActivityState({ now: Date.now(), sessionId: browserSessionId, maxGapMs: 90000 });
    else if (activity.sessionId !== browserSessionId) await applyActivity({ type: 'restart', at: Date.now(), sessionId: browserSessionId });
    workspace = createWorkspace({
      store, sessionId: browserSessionId, settings: () => settings, getActivity: () => activity, setActivity: value => { activity = value; },
      epoch: () => dataEpoch, invalidate: () => { dataEpoch++; persistSession().catch(() => {}); },
      rawContext, idleState: () => chrome.idle.queryState(settings.idleSeconds), tabs: eligibleTabs, targetWindow,
      allowed: url => Boolean(normalizeUrl(url)) && !excluded(url), restorePages, openPage,
      activateTab: async (windowId, tabId) => { await chrome.windows.update(windowId, { focused: true }); await chrome.tabs.update(tabId, { active: true }); },
      loadJobs: async () => { const saved = (await chrome.storage.session.get('focuenceMemoryJobs')).focuenceMemoryJobs; return Array.isArray(saved) ? saved : []; },
      saveJobs: values => chrome.storage.session.set({ focuenceMemoryJobs: values }),
      embed: (items, options = {}) => {
        const epoch = dataEpoch;
        return queueSemantic(() => embedItems(items, { store, infer: inputs => infer('INFERENCE_EMBED', inputs, epoch),
          isCurrent: () => epoch === dataEpoch && settings.semantic && (options.isCurrent?.() ?? true), cache: options.cache !== false }));
      },
    });
    await workspace.initialize();
    tabOperations = createTabOperations({store,sessionId:browserSessionId,allowed:url=>!!normalizeUrl(url)&&!excluded(url),
      tabs:allNormalTabs,windows:()=>chrome.windows.getAll({windowTypes:['normal']}),group:id=>chrome.tabGroups.get(id),
      save:(task,log,revision)=>workspace.saveTaskAndOperation(task,log,revision),remove:id=>chrome.tabs.remove(id),getTab:id=>chrome.tabs.get(id),
      create:async options=>{const tabs=await chrome.tabs.query({windowId:options.windowId});return chrome.tabs.create({...options,index:Math.min(options.index,tabs.length)});},
      restoreGroup:async({windowId,info,ids,reuseGroup})=>{const existing=reuseGroup?await chrome.tabGroups.get(info.id).catch(()=>null):null;
        if(existing?.windowId===windowId)await chrome.tabs.group({tabIds:ids,groupId:existing.id});
        else{const groupId=await chrome.tabs.group({tabIds:ids,createProperties:{windowId}});await chrome.tabGroups.update(groupId,{title:info.title||'',color:info.color||'grey',collapsed:!!info.collapsed});}},
      invalidate:()=>workspace.invalidate()});
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
    return page ? [{ id: tab.id, windowId: id, title: page.title, url: page.url, pendingUrl: tab.pendingUrl, domain: page.domain, active: tab.active, pinned: tab.pinned, groupId: tab.groupId, index: tab.index, lastAccessed: tab.lastAccessed || 0, pageId: page.id, tags: page.tags, foregroundMs: 0 }] : [];
  });
}

async function allNormalTabs() {
  const windows=await chrome.windows.getAll({windowTypes:['normal']});
  const ids=new Set(windows.filter(window=>!window.incognito).map(window=>window.id));
  return(await chrome.tabs.query({})).filter(tab=>ids.has(tab.windowId)&&!tab.incognito);
}

async function previewImport(message) {
  for(const [id,entry]of imports)if(entry.at<Date.now()-15*60000)imports.delete(id);
  let incoming;
  if(message.restorePoint){const point=await store.getRestorePoint();if(!point)throw Error('没有可用的恢复前快照。');incoming=decodeBackup(point.data,{taskFrom,relationFrom,pageFrom,segmentFrom,settingsFrom});}
  else if(message.sourceToken){incoming=imports.get(message.sourceToken)?.incoming;if(!incoming)throw Object.assign(Error('文件预览已过期，请重新选择文件。'),{code:'IMPORT_PREVIEW_STALE'});}
  else incoming=decodeBackup(message.data,{taskFrom,relationFrom,pageFrom,segmentFrom,settingsFrom});
  const plan=planImport(incoming,await store.exportData(),message),token=crypto.randomUUID();
  imports.set(token,{at:Date.now(),incoming,plan});
  return{token,mode:plan.mode,counts:plan.counts,conflicts:plan.conflicts,schemaVersion:incoming.schemaVersion};
}

async function applyImport(message) {
  const saved=imports.get(message.token);
  if(!saved||saved.at<Date.now()-15*60000)throw Object.assign(Error('导入预览已过期，请重新预览。'),{code:'IMPORT_PREVIEW_STALE'});
  dataEpoch++;
  const result=await store.applyImport(saved.plan);
  imports.clear();tabOperations.invalidate();proposals.clear();proposalNotices.clear();lastUndo=null;
  settings=await store.getSettings();activity=createActivityState({now:Date.now(),sessionId:browserSessionId,maxGapMs:90000});
  await workspace.reload();
  if((await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']})).length)await chrome.offscreen.closeDocument();
  model={status:'idle',name:MODEL_NAME,progress:0};chrome.idle.setDetectionInterval(settings.idleSeconds);await persistSession();
  return result;
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
  const groups = proposeGroups(freshTabs.filter(tab => !tab.pendingUrl || normalizeUrl(tab.pendingUrl) === tab.url), { embeddings, semantic: method === 'semantic', previousGroups: proposals.get(windowId) || [] }).map(group => sealProposal(group, freshTabs));
  if (epoch !== dataEpoch) throw new Error('本机语义分析已取消');
  proposals.set(windowId, groups);
  proposalNotices.delete(windowId);
  await persistSession();
  return { groups, elapsedMs: Math.round(performance.now() - started), method, model, ...metadata };
}

function mergedSegments(saved, preview) {
  return [...new Map([...saved, ...preview].map(segment => [segment.id, segment])).values()].sort((a, b) => a.startedAt - b.startedAt);
}

async function currentProposals(windowId, tabs) {
  const cached = proposals.get(windowId) || [];
  const current = cached.filter(group => proposalIsCurrent(group, tabs, windowId));
  if (current.length !== cached.length) {
    proposals.set(windowId, current);
    proposalNotices.set(windowId, '页面已经变化，相关旧建议已撤回。请重新生成建议。');
    await persistSession();
  }
  return current;
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
  const groups = await currentProposals(windowId, tabs);
  const work = await workspace.view({ windowId, tabs, tasks, segments: scoped, from: attention.range.startedAt, to: attention.range.endedAt });
  return { version: VERSION, windowId, settings, tabs, tasks: taskViews(tasks, tabs, segments), work, segments: scoped.slice(-2000), timelineTruncated: scoped.length > 2000, undoAvailable: Boolean(lastUndo), groups, proposalNotice: proposalNotices.get(windowId) || '', ...analytics, transitions, attention, model,
    trackingState: { status: !settings.tracking ? 'paused' : activity.warning ? 'unknown' : idle !== 'active' ? 'idle' : context ? 'active' : 'unfocused', activeTabId: context?.tabId, lastUpdatedAt: now, warning: activity.warning || null } };
}

async function applyGroup(message) {
  const windowId = await targetWindow(message.windowId);
  const group = (proposals.get(windowId) || []).find(candidate => candidate.id === message.group?.id);
  const tabs = await eligibleTabs(windowId);
  let valid;
  try { valid = validateProposalSelection(group, message.group, tabs, windowId); }
  catch (error) { await currentProposals(windowId, tabs); throw error; }
  // A concurrent regeneration supersedes the consent for this revision.
  if (!(proposals.get(windowId) || []).some(candidate => candidate.revision === group.revision)) throw Object.assign(new Error(STALE_PROPOSAL), {code: 'STALE_PROPOSAL'});
  const snapshot = valid.map(tab => ({ id: tab.id, windowId: tab.windowId, index: tab.index }));
  const groupId = await chrome.tabs.group({ tabIds: valid.map(tab => tab.id), createProperties: { windowId } });
  const title = String(group.name || 'Focuence 分组').trim().slice(0, 60);
  const color = COLORS.has(group.color) ? group.color : 'orange';
  await chrome.tabGroups.update(groupId, { title, color, collapsed: false });
  const actual = await chrome.tabs.query({groupId});
  const fingerprint = windowFingerprint(await chrome.tabs.query({ windowId }));
  lastUndo = { groupId, title, color, tabs: snapshot, windowId, fingerprint };
  const used = new Set(valid.map(tab => tab.id));
  proposals.set(windowId, (proposals.get(windowId) || []).filter(candidate => !candidate.tabIds.some(id => used.has(id))));
  await persistSession();
  return { groupId, tabIds: actual.map(tab => tab.id), count: actual.length, name: title };
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
  if (message.mode === 'intent') rawPages = [];
  else if (message.group?.pages) {
    const tabs = await eligibleTabs(message.windowId);
    const selected = new Set(message.group.pages.map(page => normalizeUrl(page.url)));
    rawPages = tabs.filter(tab => selected.has(normalizeUrl(tab.url)));
  }
  else {
    const tabs = await eligibleTabs(message.windowId);
    rawPages = tabs.filter(tab => !Array.isArray(message.tabIds) || message.tabIds.includes(tab.id));
  }
  const pages = [...new Map(rawPages.flatMap(raw => {
    const page = allowedPage(raw); return page ? [[page.id, { pageId: page.id, url: page.url, title: page.title, tags: page.tags }]] : [];
  })).values()];
  if (!pages.length && message.mode !== 'intent') throw new Error('请选择至少一个可保存的网页');
  if (pages.length > 30) throw new Error('单个任务最多保存 30 个页面，请缩小选择范围');
  const name = taskText(message.name || message.group?.name || '未命名任务', 'name', { required: true });
  const now = Date.now();
  const task = { id: `task_${crypto.randomUUID()}`, revision: 0, name, goal: taskText(message.goal, 'goal'), checkpoint: null, color: COLORS.has(message.group?.color) ? message.group.color : 'orange', locked: true, createdAt: now, updatedAt: now, notes: taskText(message.notes, 'notes'), pages };
  await store.putTask(task);
  workspace.invalidate();
  return task;
}

async function restorePages(task, windowId, single = null) {
  const existing = await chrome.tabs.query({ windowId });
  const segments = await store.listSegments({ since: calendarRange('week').startedAt });
  const plan = single ? { pages: [single], resumePage: single } : planTaskRestore(task, existing, segments);
  if (!plan.pages.length) throw Object.assign(new Error('还没有保存的恢复页面。可以先关联并保存资料。'), { code: 'NO_CONTINUE_PAGE' });
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
  return { opened, reused, failed, resumePage, activeTabId: resumePage ? urls.get(resumePage.url) : null };
}

async function openPage(value, windowId) {
  const url = normalizeUrl(value); if (!url) throw new Error('只能打开 HTTP(S) 网页');
  const tabs = await chrome.tabs.query({ windowId });
  const existing = tabs.find(tab => normalizeUrl(tab.url) === url);
  if (existing) { await chrome.tabs.update(existing.id, { active: true }); return { opened: false, reused: true }; }
  await chrome.tabs.create({ windowId, url }); return { opened: true, reused: false };
}

async function updateSettings(patch = {}) {
  const clean = {};
  if (typeof patch.tracking === 'boolean') clean.tracking = patch.tracking;
  if (typeof patch.semantic === 'boolean') clean.semantic = patch.semantic;
  if (typeof patch.focusSupport === 'boolean') clean.focusSupport = patch.focusSupport;
  if (patch.idleSeconds != null && Number.isFinite(Number(patch.idleSeconds))) clean.idleSeconds = Math.max(15, Math.min(3600, Math.round(Number(patch.idleSeconds))));
  if (patch.retentionDays != null && Number.isFinite(Number(patch.retentionDays))) clean.retentionDays = Math.max(1, Math.min(365, Math.round(Number(patch.retentionDays))));
  if (Array.isArray(patch.excludedDomains)) clean.excludedDomains = [...new Set(patch.excludedDomains.map(value => {
    const raw = String(value).trim().replace(/^\*\./, '').replace(/^\./, '');
    try { return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.toLowerCase(); } catch { return ''; }
  }).filter(Boolean))].slice(0, 200);
  const previous = settings;
  settings = await store.setSettings(clean);
  const inferenceChanged = previous.semantic !== settings.semantic || JSON.stringify(previous.excludedDomains) !== JSON.stringify(settings.excludedDomains);
  if (inferenceChanged || previous.tracking !== settings.tracking || previous.retentionDays !== settings.retentionDays) workspace.invalidate();
  if (inferenceChanged) {
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
  workspace.replaceState(pruned.workspace);
  return settings;
}

async function clearData(all) {
  dataEpoch++;
  imports.clear();tabOperations.invalidate();
  if ((await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length) await chrome.offscreen.closeDocument();
  model = { status: 'idle', name: MODEL_NAME, progress: 0 };
  if (all) await store.clearAll(); else await store.clearHistory();
  settings = await store.getSettings();
  await workspace.reload();
  activity = createActivityState({ now: Date.now(), sessionId: browserSessionId, maxGapMs: 90000 });
  if (!settings.tracking) await applyActivity({ type: 'pause', at: Date.now() });
  else await store.saveActivity(activity);
  proposals.clear(); proposalNotices.clear(); lastUndo = null;
  await persistSession();
  return { cleared: true };
}

async function handle(message) {
  await init();
  if (workspace.hasMutation(message.type)) return queueActivity(() => workspace.mutate(message));
  switch (message.type) {
    case 'LIST_WORKSPACE_TABS': return workspaceCatalog(await chrome.windows.getAll({windowTypes:['normal']}),await allNormalTabs(),url=>!excluded(url));
    case 'PREVIEW_TAB_ACTION': return queueActivity(()=>tabOperations.preview(message));
    case 'EXECUTE_TAB_ACTION': return queueActivity(()=>tabOperations.execute(message));
    case 'GET_TAB_OPERATIONS': return tabOperations.list();
    case 'PREVIEW_RESTORE_OPERATION': return tabOperations.previewRestore(message);
    case 'RESTORE_TAB_OPERATION': return queueActivity(()=>tabOperations.restore(message));
    case 'LIST_RECENTLY_CLOSED': return recentSessions(chrome,url=>!excluded(url));
    case 'RESTORE_RECENTLY_CLOSED': return queueActivity(()=>restoreRecentSession(chrome,message.id,url=>!excluded(url)));
    case 'PREVIEW_IMPORT': return queueActivity(()=>previewImport(message));
    case 'APPLY_IMPORT': return queueActivity(()=>applyImport(message));
    case 'GET_RESTORE_POINT': { const point=await store.getRestorePoint();return point?{at:point.at}:null; }
    case 'GET_STATE': return getState(message);
    case 'PROPOSE_GROUPS': {
      if (!message.semantic) return propose(message);
      const epoch = dataEpoch;
      return queueSemantic(() => propose(message, epoch));
    }
    case 'APPLY_GROUP':
    case 'UNDO_GROUP': {
      const job = groupQueue.then(() => message.type === 'APPLY_GROUP' ? applyGroup(message) : undoGroup());
      groupQueue = job.catch(() => {}); return job;
    }
    case 'SAVE_TASK': return queueActivity(() => saveTask(message));
    case 'SUGGEST_TASK_PAGES': return workspace.createJob(message, 'association');
    case 'SEARCH_MEMORY': return workspace.createJob(message, 'search');
    case 'GET_SEARCH_STATUS': return workspace.advanceJob(message);
    case 'CANCEL_SEARCH': return workspace.cancelJob(message);
    case 'UPDATE_FOCUS_SUPPORT': return queueActivity(() => updateSettings({ focusSupport: message.enabled === true }));
    case 'FOCUS_TAB': {
      const tab = await chrome.tabs.get(message.tabId);
      await chrome.windows.update(tab.windowId, { focused: true }); await chrome.tabs.update(tab.id, { active: true }); return { focused: true };
    }
    case 'OPEN_PAGE': {
      const windowId = await targetWindow(message.windowId);
      return openPage(message.url, windowId);
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
  handle(message).then(data => sendResponse({ ok: true, data })).catch(error => sendResponse({ ok: false, error: error.message || String(error), code: error.code }));
  return true;
});

const reconcile = () => queueActivity(recordCurrent).catch(() => {});
chrome.tabs.onActivated.addListener(reconcile);
chrome.tabs.onUpdated.addListener((_id, change) => { if (change.url || change.title || change.status === 'complete') reconcile(); });
chrome.tabs.onRemoved.addListener(reconcile);
chrome.tabs.onReplaced.addListener(reconcile);
chrome.windows.onFocusChanged.addListener(reconcile);
chrome.windows.onRemoved.addListener(id => { proposals.delete(id); proposalNotices.delete(id); if (lastUndo?.windowId === id) lastUndo = null; persistSession().catch(() => {}); queueActivity(() => workspace.closeWindow(id)).catch(() => {}); });
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
    workspace.replaceState(result.workspace);
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
