import { reduceActivity, previewActivity } from './activity.js';
import { taskPatterns } from './task-patterns.js';
import { assertRevision, failure, taskText, resolveTaskContext, normalizeWorkContext, windowContext, changeWindowContext, relationId, relationFor } from './task-context.js';
import { observedDraft, makeCheckpoint, checkpointEvidence, checkpointPage } from './checkpoints.js';
import { returnPrompt, recordPromptShown, dismissPrompt } from './focus-support.js';
import { matchTaskPages, goalItem, pageItem, candidateSnapshot } from './task-matching.js';
import { memoryCorpus, searchDocuments, rankMemory, accumulateSearchScores, SEARCH_SCOPES } from './memory-search.js';
import { semanticItem, QUERY_INSTRUCTION } from './semantic.js';
import { stableHash, normalizeUrl } from './text.js';

/** One background-owned coordinator. Mutations run in the activity queue. */
export function createWorkspace(deps) {
  const { store } = deps;
  const now = deps.now || Date.now;
  let state;
  const jobs = new Map(), running = new Set();
  let writes = Promise.resolve();

  const clone = value => structuredClone(value);
  async function persistJobs() {
    const snapshot = [...jobs.values()].map(job => ({ ...job, busy: false }));
    const pending = writes.then(() => deps.saveJobs(snapshot));
    writes = pending.catch(() => {});
    await pending;
  }

  async function initialize() {
    state = await store.getWorkspace();
    const context = normalizeWorkContext(state.context, deps.sessionId);
    if (context !== state.context) {
      state = { ...state, context };
      await store.commitWorkspace({ workspace: state });
    }
    for (const job of await deps.loadJobs()) if (job.sessionId === deps.sessionId && now() - job.at < 3600000) jobs.set(job.id, job);
  }

  function afterObservation(activity, segments) {
    if (!deps.settings().tracking) return state;
    const drafts = { ...state.drafts };
    const records = [...segments, ...previewActivity(activity, now())];
    for (const taskId of new Set(records.map(item => item.taskId).filter(Boolean))) {
      const draft = observedDraft(drafts[taskId], records, taskId, now());
      if (draft) drafts[taskId] = draft;
    }
    return { ...state, drafts };
  }

  async function bundle() {
    const [tasks, relations] = await Promise.all([store.getTasks(), store.getRelations()]);
    return { tasks, relations };
  }

  async function contextFor(raw, context = state.context, overrides = {}) {
    if (!raw) return null;
    const data = await bundle();
    return { ...raw, ...resolveTaskContext(raw.pageId, windowContext(context, raw.windowId).taskId,
      overrides.tasks || data.tasks, overrides.relations || data.relations) };
  }

  async function commit(change, nextState = state, { observe = true, tasks, relations } = {}) {
    let activity = deps.getActivity(), segments = [];
    if (observe) {
      const raw = deps.settings().tracking ? await deps.rawContext() : null;
      const context = await contextFor(raw, nextState.context, { tasks, relations });
      const result = reduceActivity(activity, { type: 'context', at: now(), context, tracking: deps.settings().tracking, idleState: await deps.idleState() });
      activity = result.state; segments = result.segments;
      if (deps.settings().tracking) {
        const drafts = { ...nextState.drafts };
        for (const taskId of new Set(segments.map(item => item.taskId).filter(Boolean))) {
          const draft = observedDraft(drafts[taskId], segments, taskId, now());
          if (draft && !(change.deleteTasks || []).includes(taskId)) drafts[taskId] = draft;
        }
        nextState = { ...nextState, drafts };
      }
    }
    const output = await store.commitWorkspace({ ...change, workspace: nextState, activity, segments });
    state = nextState; deps.setActivity(activity);
    return output;
  }

  function invalidate() {
    deps.invalidate();
    for (const job of jobs.values()) {
      job.status = 'stale'; job.error = '资料或任务已经更新，请重新查找或分析。';
      job.results = []; job.candidates = []; job.scores = {}; job.queryVector = null;
    }
    persistJobs().catch(() => {});
  }

  async function editTask(message) {
    const { tasks, relations } = await bundle();
    const task = clone(assertRevision(tasks.find(item => item.id === message.id), message.revision));
    for (const field of ['name', 'notes', 'goal']) if (typeof message[field] === 'string') task[field] = taskText(message[field], field, { required: field === 'name' });
    task.revision++; task.updatedAt = now();
    await commit({ tasks: [task], expectedTasks: [{id: task.id, revision: message.revision}] }, state, { tasks: tasks.map(item => item.id === task.id ? task : item), relations });
    invalidate(); return task;
  }

  async function selectTask(message, pause = false) {
    const windowId = await deps.targetWindow(message.windowId);
    const { tasks, relations } = await bundle();
    const task = tasks.find(item => item.id === message.id);
    if (!task) throw failure('TASK_NOT_FOUND', '这个任务已经不存在。');
    const current = windowContext(state.context, windowId);
    if (pause && current.taskId !== task.id) throw failure('STALE_CONTEXT', '当前任务已改变，请重新读取。');
    const context = changeWindowContext(state.context, windowId, pause ? null : task.id, message.contextRevision, now());
    const next = { ...state, context };
    let changedTask = null;
    if (message.checkpoint) {
      const checkpointTask = message.previousTaskId ? tasks.find(item => item.id === message.previousTaskId) : task;
      if (message.previousTaskId && current.taskId !== message.previousTaskId) throw failure('STALE_CONTEXT', '原来的任务已改变，请重新核对断点。');
      assertRevision(checkpointTask, message.previousTaskId ? message.previousRevision : message.revision);
      changedTask = { ...checkpointTask, checkpoint: makeCheckpoint(message.checkpoint, { task: checkpointTask, relations, draft: state.drafts[checkpointTask.id], now: now() }), revision: checkpointTask.revision + 1, updatedAt: now() };
    }
    await commit({ tasks: changedTask ? [changedTask] : [], expectedTasks: changedTask ? [{id: changedTask.id, revision: changedTask.revision - 1}] : [],
      expectedContext: {sessionId: deps.sessionId, windowId, revision: message.contextRevision} }, next,
    { tasks: changedTask ? tasks.map(item => item.id === changedTask.id ? changedTask : item) : tasks, relations });
    invalidate(); return { current: windowContext(state.context, windowId), task: changedTask || task };
  }

  async function saveCheckpoint(message) {
    const task = assertRevision(await store.getTask(message.id), message.revision);
    const relations = await store.getRelations();
    const checkpoint = makeCheckpoint(message.checkpoint || {}, { task, relations, draft: state.drafts[task.id], now: now() });
    const updated = { ...task, checkpoint, revision: task.revision + 1, updatedAt: now() };
    await commit({ tasks: [updated], expectedTasks: [{ id: task.id, revision: message.revision }] });
    invalidate(); return updated;
  }

  async function authoritativePage(message, task, relations) {
    if (Number.isInteger(message.tabId)) {
      const tabs = await deps.tabs(message.windowId);
      const tab = tabs.find(item => item.id === message.tabId && item.pageId === message.pageId);
      if (!tab || candidateSnapshot(tab).hash !== message.snapshotHash) throw failure('STALE_SUGGESTION', '页面已经变化，请重新核对关联建议。');
      if (!deps.allowed(tab.url)) throw failure('EXCLUDED_PAGE', '这个站点已排除，不能作为新的关联资料。');
      return checkpointPage(tab);
    }
    const page = [...(task.pages || []), ...relations.filter(item => item.taskId === task.id).map(item => item.page)]
      .find(item => item?.pageId === message.pageId);
    if (!page) throw failure('STALE_SUGGESTION', '这条页面记录已经不存在，请重新读取。');
    if (!deps.allowed(page.url)) throw failure('EXCLUDED_PAGE', '这个站点已排除，不能作为新的关联资料。');
    return checkpointPage(page);
  }

  async function setRelation(message) {
    if (!['related', 'unrelated'].includes(message.decision)) throw failure('INVALID_RELATION', '请选择相关或不相关。');
    const data = await bundle();
    const task = assertRevision(data.tasks.find(item => item.id === message.id), message.revision);
    const page = await authoritativePage(message, task, data.relations);
    const id = relationId(task.id, page.pageId), previous = data.relations.find(item => item.id === id) || null;
    const relation = { id, taskId: task.id, pageId: page.pageId, page, decision: message.decision, revision: crypto.randomUUID(), at: now() };
    const undo = { token: crypto.randomUUID(), relationId: id, revision: relation.revision, previous };
    const updated = { ...task, revision: task.revision + 1, updatedAt: now() };
    const next = { ...state, undo: { ...state.undo, [task.id]: undo } };
    await commit({ tasks: [updated], relations: [relation], expectedTasks: [{ id: task.id, revision: message.revision }] }, next,
      { tasks: data.tasks.map(item => item.id === task.id ? updated : item), relations: [...data.relations.filter(item => item.id !== id), relation] });
    invalidate(); return { relation, undoToken: undo.token, task: updated };
  }

  async function undoRelation(message) {
    const data = await bundle(), task = assertRevision(data.tasks.find(item => item.id === message.id), message.revision);
    const undo = state.undo[task.id];
    if (!undo || undo.token !== message.token || !data.relations.some(item => item.id === undo.relationId && item.revision === undo.revision)) throw failure('STALE_TASK', '这条关联已有新的修改，不能覆盖。');
    const next = clone(state); delete next.undo[task.id];
    const relationList = data.relations.filter(item => item.id !== undo.relationId);
    if (undo.previous) relationList.push(undo.previous);
    const updated = { ...task, revision: task.revision + 1, updatedAt: now() };
    await commit({ tasks: [updated], relations: undo.previous ? [undo.previous] : [], deleteRelations: undo.previous ? [] : [undo.relationId],
      expectedTasks: [{ id: task.id, revision: message.revision }] }, next, { tasks: data.tasks, relations: relationList });
    invalidate(); return { restored: true };
  }

  async function resetRelations(message) {
    if (message.scope === 'all') {
      const data = await bundle(), expected = message.expectedTasks || [];
      if (expected.length !== data.tasks.length) throw failure('STALE_TASK', '任务列表已改变，请重新读取后再清除关联记忆。');
      for (const task of data.tasks) assertRevision(task, expected.find(item => item.id === task.id)?.revision);
      const updated = data.tasks.map(task => ({ ...task, revision: task.revision + 1, updatedAt: now() }));
      await commit({ tasks: updated, resetRelations: data.tasks.map(task => task.id), expectedTasks: expected }, { ...state, undo: {} }, { tasks: updated, relations: [] });
      invalidate(); return { reset: true };
    }
    const data = await bundle(), task = assertRevision(data.tasks.find(item => item.id === message.id), message.revision);
    const next = clone(state); delete next.undo[task.id];
    const updated = { ...task, revision: task.revision + 1, updatedAt: now() };
    await commit({ tasks: [updated], resetRelations: [task.id], expectedTasks: [{ id: task.id, revision: message.revision }] }, next,
      { tasks: data.tasks, relations: data.relations.filter(item => item.taskId !== task.id) });
    invalidate(); return { reset: true };
  }

  async function updatePages(message) {
    const data = await bundle(), task = assertRevision(data.tasks.find(item => item.id === message.id), message.revision);
    let pages = task.pages;
    if (message.removePageId) pages = pages.filter(page => page.pageId !== message.removePageId);
    else {
      const page = await authoritativePage(message, task, data.relations);
      if (!pages.some(item => item.pageId === page.pageId)) pages = [...pages, page];
    }
    if (pages.length > 30) throw failure('TASK_PAGE_LIMIT', '任务已保存 30 页。请先移出不需要恢复的页面。');
    const updated = { ...task, pages, revision: task.revision + 1, updatedAt: now() };
    await commit({ tasks: [updated], expectedTasks: [{id: task.id, revision: message.revision}] }, state,
      { tasks: data.tasks.map(item => item.id === task.id ? updated : item), relations: data.relations });
    invalidate(); return updated;
  }

  async function deleteTask(message) {
    const data = await bundle(), task = assertRevision(data.tasks.find(item => item.id === message.id), message.revision);
    const next = clone(state); delete next.drafts[task.id]; delete next.undo[task.id];
    for (const [windowId, current] of Object.entries(next.context.windows)) if (current.taskId === task.id) next.context.windows[windowId] = { taskId: null, revision: current.revision + 1, startedAt: 0 };
    next.events = next.events.filter(item => item.taskId !== task.id);
    await commit({ deleteTasks: [task.id], expectedTasks: [{id: task.id, revision: message.revision}] }, next,
      { tasks: data.tasks.filter(item => item.id !== task.id), relations: data.relations.filter(item => item.taskId !== task.id) });
    invalidate(); return { deleted: true };
  }

  async function restoreTask(message) {
    const data = await bundle(), task = assertRevision(data.tasks.find(item => item.id === message.id), message.revision);
    const windowId = await deps.targetWindow(message.windowId);
    const current = windowContext(state.context, windowId);
    if (message.contextRevision !== current.revision) throw failure('STALE_CONTEXT', '窗口的当前任务已改变，请重新核对。');
    let single = null;
    if (message.mode === 'page') {
      single = task.checkpoint?.page || state.drafts[task.id]?.page || task.pages.find(page => relationFor(task, page.pageId, data.relations).related);
      if (!single || relationFor(task, single.pageId, data.relations).source === 'excluded') throw failure('NO_CONTINUE_PAGE', '没有可用的继续页面，请在断点中重新选择。');
    }
    const result = await deps.restorePages(task, windowId, single);
    const updated = { ...task, lastRestoreResult: { at: now(), opened: result.opened, reused: result.reused, failedCount: result.failed.length }, revision: task.revision + 1 };
    const next = clone(state);
    if (result.resumePage) {
      updated.lastRestoredAt = now(); updated.lastActivePageId = result.resumePage.pageId;
      next.context = changeWindowContext(next.context, windowId, task.id, message.contextRevision, now());
      if (deps.settings().tracking) next.events.push({ id: crypto.randomUUID(), kind: 'restore', taskId: task.id, at: now(), opened: result.opened, reused: result.reused, mode: message.mode === 'page' ? 'page' : 'all' });
    }
    await commit({ tasks: [updated], expectedTasks: [{id: task.id, revision: message.revision}], expectedContext: {sessionId: deps.sessionId, windowId, revision: message.contextRevision} }, next,
      { tasks: data.tasks.map(item => item.id === task.id ? updated : item), relations: data.relations });
    invalidate();
    if (result.activeTabId != null) await deps.activateTab(windowId, result.activeTabId);
    return { ...result, checkpoint: updated.checkpoint, current: windowContext(state.context, windowId) };
  }

  async function view({ windowId, tasks, tabs, segments, from, to }) {
    const relations = await store.getRelations();
    const current = windowContext(state.context, windowId);
    const task = tasks.find(item => item.id === current.taskId);
    const activity = deps.getActivity();
    const allSegments = await store.listSegments({ since: now() - deps.settings().retentionDays * 86400000 });
    const live = [...allSegments, ...previewActivity(activity, now())];
    const allowedLive = live.map(item => deps.allowed(item.url) ? item : { ...item, status: 'unknown', foregroundMs: 0 });
    const association = [...jobs.values()].reverse().find(job => job.kind === 'association' && job.windowId === windowId && job.taskId === task?.id && job.epoch === deps.epoch() && job.taskRevision === task?.revision && job.contextRevision === current.revision);
    const candidates = task && deps.settings().tracking ? matchTaskPages(task, tabs, relations) : [];
    const stillValid = association && association.snapshots.every(snapshot => tabs.some(tab => tab.id === snapshot.tabId && candidateSnapshot(tab).hash === snapshot.hash));
    const prompt = returnPrompt({ segments: allowedLive, current, context: activity.context,
      tracking: deps.settings().tracking && activity.idleState === 'active' && !activity.warning, enabled: deps.settings().focusSupport, support: state.support, now: now() });
    return { epoch: deps.epoch(), current, relations, drafts: state.drafts, undo: state.undo,
      checkpointEvidence: Object.fromEntries(tasks.map(task => [task.id, checkpointEvidence(task.checkpoint, live)])),
      association: stillValid ? publicJob(association) : { status: 'ready', candidates, total: tabs.length, completed: 0, error: !deps.settings().tracking ? '记录已暂停，自动关联也已暂停。仍可手动管理关联记忆。' : association ? '页面已变化，请重新分析关联。' : '' },
      returnPrompt: prompt,
      patterns: taskPatterns(segments, tasks, state.events.filter(item => (!from || item.at >= from) && (!to || item.at < to)), now()),
    };
  }

  function publicJob(job) {
    const { query, scores, queryVector, documents, snapshots, epoch, signature, sessionId, ...safe } = job;
    return safe;
  }

  async function createJob(message, kind = 'search') {
    const windowId = await deps.targetWindow(message.windowId);
    const data = await bundle();
    const task = kind === 'association' ? assertRevision(data.tasks.find(item => item.id === message.id), message.revision) : null;
    const current = windowContext(state.context, windowId);
    if (task && (task.id !== current.taskId || current.revision !== message.contextRevision)) throw failure('STALE_CONTEXT', '当前任务已改变，请重新读取。');
    if (task && !deps.settings().tracking) throw failure('TRACKING_PAUSED', '记录已暂停；恢复记录后可更新自动关联。');
    const query = task ? task.goal || task.name : String(message.query || '').trim();
    if (!query || [...query].length > 3000) throw failure('INVALID_QUERY', '请输入 1—3000 个字符的查找内容。');
    const scope = SEARCH_SCOPES.includes(message.scope) ? message.scope : 'all';
    const job = { id: crypto.randomUUID(), kind, at: now(), sessionId: deps.sessionId, epoch: deps.epoch(), windowId, query,
      clientId: String(message.clientId || windowId), scope, status: deps.settings().semantic ? 'queued' : 'done', completed: 0, total: 0,
      taskId: task?.id, taskRevision: task?.revision, contextRevision: current.revision, scores: {}, queryVector: null, results: [], candidates: [], error: '' };
    const prepared = await prepareJob(job, data);
    if (job.epoch !== deps.epoch()) throw failure('STALE_SUGGESTION', '资料已经变化，请重新查找或分析。');
    job.documents = prepared.documents.map(item => item.item.id); job.signature = prepared.signature; job.total = job.documents.length;
    job.snapshots = kind === 'association' ? prepared.tabs.map(candidateSnapshot) : [];
    if (task) job.candidates = matchTaskPages(task, prepared.tabs, data.relations);
    else Object.assign(job, rankMemory(prepared.entries, query), { total: job.documents.length, resultTotal: rankMemory(prepared.entries, query).total });
    for (const [id, old] of jobs) if ((old.kind === kind && old.windowId === windowId && old.clientId === job.clientId) || now() - old.at > 3600000) {
      old.status = 'cancelled'; old.error = '这次分析已由新请求替代或已过期。'; old.results = []; old.candidates = []; old.queryVector = null;
      jobs.delete(id);
    }
    jobs.set(job.id, job); await persistJobs(); return publicJob(job);
  }

  async function prepareJob(job, known) {
    const data = known || await bundle();
    const tabs = await deps.tabs(job.windowId);
    if (job.kind === 'association') {
      const task = data.tasks.find(item => item.id === job.taskId);
      if (!task || task.revision !== job.taskRevision || windowContext(state.context, job.windowId).revision !== job.contextRevision) throw failure('STALE_SUGGESTION', '任务已经更新，请重新分析。');
      const sources = [...new Map([...tabs, ...task.pages, ...data.relations.filter(item => item.taskId === task.id && item.decision === 'related').map(item => item.page)]
        .filter(page => deps.allowed(page.url)).map(page => [page.pageId || page.id, page])).values()];
      const documents = sources.map(page => ({ entryId: page.pageId || page.id, item: pageItem(page) }));
      return { ...data, task, tabs, documents, entries: [], signature: stableHash(JSON.stringify(tabs.map(candidateSnapshot))), goal: goalItem(task) };
    }
    const [pages, segments] = await Promise.all([store.getPages(), store.listSegments({ since: now() - deps.settings().retentionDays * 86400000 })]);
    const entries = memoryCorpus({ tabs, ...data, pages, segments, scope: job.scope, allowed: deps.allowed });
    const documents = searchDocuments(entries);
    return { ...data, tabs, documents, entries, signature: stableHash(JSON.stringify(documents.map(item => [item.item.id, item.item.textHash]))) };
  }

  async function advanceJob(message) {
    const job = jobs.get(message.jobId);
    if (!job) throw failure('JOB_NOT_FOUND', '这次查找已结束或浏览器已重启，请重新查找。');
    if (job.epoch !== deps.epoch()) { job.status = 'stale'; job.error = '资料已经更新，请重新查找或分析。'; }
    if (['done', 'failed', 'cancelled', 'stale'].includes(job.status) || running.has(job.id)) return publicJob(job);
    running.add(job.id); job.status = 'running';
    const valid = () => jobs.get(job.id) === job && job.epoch === deps.epoch() && job.status === 'running' && deps.settings().semantic;
    try {
      const prepared = snapshotJob(job, await prepareJob(job));
      if (prepared.signature !== job.signature) throw failure('STALE_SUGGESTION', '检索范围内的资料已变化，请重新查找或分析。');
      if (!job.queryVector) {
        const item = job.kind === 'association' ? prepared.goal : semanticItem(job.id, QUERY_INSTRUCTION + job.query, 'query');
        const result = await deps.embed([item], { isCurrent: valid, cache: job.kind === 'association' });
        if (!valid()) throw failure('CANCELLED', '分析已取消。');
        job.queryVector = result.vectors.get(item.id);
      }
      const batch = prepared.documents.slice(job.completed, job.completed + 24);
      if (batch.length) {
        const result = await deps.embed(batch.map(item => item.item), { isCurrent: valid });
        if (!valid()) throw failure('CANCELLED', '分析已取消。');
        if (job.kind === 'search') job.scores = accumulateSearchScores(job.scores, batch, result.vectors, job.queryVector);
      }
      // Revalidate after inference; navigation may have changed titles or URLs.
      const fresh = snapshotJob(job, await prepareJob(job));
      if (!valid() || fresh.signature !== job.signature) throw failure('STALE_SUGGESTION', '资料已经变化，请重新查找或分析。');
      job.completed += batch.length;
      if (job.kind === 'association') {
        const cached = await store.getVectors(prepared.documents.map(item => item.item.id));
        const hashes = new Map(prepared.documents.map(item => [item.item.id, item.item.textHash]));
        const vectors = new Map(cached.filter(item => item.textHash === hashes.get(item.id)).map(item => [item.id, item.vector]));
        vectors.set(prepared.goal.id, job.queryVector);
        job.candidates = matchTaskPages(prepared.task, prepared.tabs, prepared.relations, vectors);
      } else {
        const ranked = rankMemory(prepared.entries, job.query, job.scores);
        job.results = ranked.results; job.resultTotal = ranked.total;
      }
      job.status = job.completed >= job.total ? 'done' : 'queued';
    } catch (error) {
      if (jobs.get(job.id) === job && job.status !== 'cancelled') { job.status = ['CANCELLED', 'STALE_SUGGESTION'].includes(error.code) ? 'stale' : 'failed'; job.error = error.message; }
    } finally { running.delete(job.id); await persistJobs(); }
    return publicJob(job);
  }

  function snapshotJob(job, prepared) {
    if (job.kind !== 'search') return prepared;
    const byId = new Map(prepared.documents.map(item => [item.item.id, item]));
    const documents = job.documents.map(id => byId.get(id));
    if (documents.some(item => !item)) throw failure('STALE_SUGGESTION', '检索中的资料已更新，请重新查找。');
    const ids = new Set(documents.map(item => item.entryId));
    return { ...prepared, documents, entries: prepared.entries.filter(item => ids.has(item.id)),
      signature: stableHash(JSON.stringify(documents.map(item => [item.item.id, item.item.textHash]))) };
  }

  async function cancelJob(message) {
    const job = jobs.get(message.jobId);
    if (job) { job.status = 'cancelled'; job.error = '已停止本次分析，保留已找到的结果。'; await persistJobs(); }
    return job ? publicJob(job) : { status: 'cancelled' };
  }

  async function openResult(message) {
    const job = jobs.get(message.jobId);
    if (!job || job.epoch !== deps.epoch() || job.status === 'stale' || !job.results.some(item => item.id === message.entryId)) throw failure('STALE_SUGGESTION', '结果已经更新，请重新查找。');
    const prepared = await prepareJob(job);
    const entry = prepared.entries.find(item => item.id === message.entryId);
    if (!entry || entry.kind !== 'page' || !deps.allowed(entry.url)) throw failure('STALE_SUGGESTION', '这条资料已不可用，请重新查找。');
    const result = await deps.openPage(entry.url, job.windowId);
    if (deps.settings().tracking) {
      const next = clone(state);
      next.events.push({ id: crypto.randomUUID(), kind: 'search-open', pageId: entry.pageId, title: entry.title, url: entry.url, at: now() });
      await commit({}, next);
    }
    return result;
  }

  async function focusFeedback(message) {
    const windowId = await deps.targetWindow(message.windowId), activity = deps.getActivity(), current = windowContext(state.context, windowId);
    const segments = [...await store.listSegments({ since: now() - 3600000 }), ...previewActivity(activity, now())]
      .map(item => deps.allowed(item.url) ? item : { ...item, status: 'unknown', foregroundMs: 0 });
    const prompt = returnPrompt({ segments, current, context: activity.context, enabled: deps.settings().focusSupport,
      tracking: deps.settings().tracking && activity.idleState === 'active' && !activity.warning, support: state.support, now: now() });
    if (!prompt || prompt.id !== message.promptId || prompt.windowId !== windowId) throw failure('STALE_CONTEXT', '这条提示已失效。');
    if (!['shown', 'related', 'dismiss', 'snooze', 'return'].includes(message.action)) throw new Error('无效的提示操作。');
    const shown = recordPromptShown(state.support, prompt, now());
    const next = { ...state, support: message.action === 'shown' ? shown : dismissPrompt(shown, prompt, message.action) };
    await commit({}, next, { observe: false });
    if (message.action === 'related') {
      const task = await store.getTask(current.taskId), tabs = await deps.tabs(windowId), tab = tabs.find(item => item.pageId === prompt.pageId && item.active);
      if (!tab) throw failure('STALE_SUGGESTION', '当前页面已经变化。');
      return setRelation({ id: task.id, revision: task.revision, pageId: tab.pageId, tabId: tab.id, windowId, snapshotHash: candidateSnapshot(tab).hash, decision: 'related' });
    }
    if (message.action === 'return') {
      const task = await store.getTask(current.taskId);
      return restoreTask({ id: task.id, revision: task.revision, windowId, contextRevision: current.revision, mode: 'page' });
    }
    return { accepted: true };
  }

  const handlers = { UPDATE_TASK: editTask, SET_CURRENT_TASK: selectTask, PAUSE_TASK: message => selectTask(message, true), SAVE_CHECKPOINT: saveCheckpoint,
    SET_TASK_RELATION: setRelation, UNDO_TASK_RELATION: undoRelation, RESET_TASK_RELATIONS: resetRelations, UPDATE_TASK_PAGES: updatePages,
    DELETE_TASK: deleteTask, RESTORE_TASK: restoreTask, OPEN_MEMORY_RESULT: openResult, FOCUS_FEEDBACK: focusFeedback };
  return { initialize, contextFor, view, afterObservation, replaceState: value => { if (value) state = value; }, getState: () => state,
    invalidate, hasMutation: type => Boolean(handlers[type]), mutate: message => handlers[message.type](message), createJob, advanceJob, cancelJob,
    async reload() { state = await store.getWorkspace(); state.context = normalizeWorkContext(state.context, deps.sessionId); await store.commitWorkspace({workspace: state}); invalidate(); jobs.clear(); await persistJobs(); },
    async closeWindow(windowId) { const next = clone(state); delete next.context.windows[windowId]; await commit({}, next); invalidate(); },
  };
}
