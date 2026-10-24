/** IndexedDB persistence. No Chrome globals, network, or in-memory fallback. */
import { checkpointPage } from './checkpoints.js';
import { assertRevision, failure, relationId, TASK_LIMITS } from './task-context.js';
import { statusOf } from './task-lifecycle.js';
import { backupStamp } from './backup.js';

export const DEFAULT_SETTINGS = Object.freeze({
  tracking: true,
  semantic: true,
  idleSeconds: 120,
  retentionDays: 30,
  excludedDomains: [],
  focusSupport: false,
});

const DATABASE_NAME = 'focuence-local-v2';
export const DATABASE_VERSION = 3;
const STORES = ['meta', 'pages', 'tasks', 'segments', 'vectors', 'taskRelations', 'tabOperations', 'restorePoints'];

function req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Local database request failed'));
  });
}
function persistenceError(error) {
  return error?.name === 'QuotaExceededError' ? failure('STORAGE_QUOTA','本机存储空间不足，资料没有覆盖。请释放空间后重新预览并重试。') : error;
}

function finite(value, fallback = 0) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function tags(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .filter(item => typeof item === 'string').map(item => item.trim().slice(0, 60)).filter(Boolean))].slice(0, 8);
}

function validUrl(value) {
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed : null;
  } catch {
    return null;
  }
}

export function settingsFrom(value = {}) {
  const domains = Array.isArray(value.excludedDomains) ? value.excludedDomains : [];
  const excludedDomains = [...new Set(domains.filter(item => typeof item === 'string').map(item => {
    const cleaned = item.trim().toLowerCase().replace(/^\*\./, '').replace(/^\./, '');
    try {
      return new URL(cleaned.includes('://') ? cleaned : `https://${cleaned}`).hostname;
    } catch {
      return '';
    }
  }).filter(Boolean))].slice(0, 500);
  return {
    tracking: typeof value.tracking === 'boolean' ? value.tracking : DEFAULT_SETTINGS.tracking,
    semantic: typeof value.semantic === 'boolean' ? value.semantic : DEFAULT_SETTINGS.semantic,
    idleSeconds: Math.min(3_600, Math.max(15, finite(value.idleSeconds, DEFAULT_SETTINGS.idleSeconds))),
    retentionDays: Math.min(365, Math.max(1, finite(value.retentionDays, DEFAULT_SETTINGS.retentionDays))),
    excludedDomains,
    focusSupport: typeof value.focusSupport === 'boolean' ? value.focusSupport : false,
  };
}

export function pageFrom(value) {
  const parsed = validUrl(value?.url);
  if (!parsed || value.incognito || !value.id) return null;
  return {
    id: String(value.id),
    url: parsed.href,
    title: String(value.title || parsed.hostname).slice(0, 500),
    domain: parsed.hostname,
    tags: tags(value.tags),
    lastSeen: finite(value.lastSeen, Date.now()),
  };
}

export function taskFrom(value) {
  if (!value || !value.id) throw new TypeError('A task needs an id');
  const now = Date.now();
  const seen = new Set();
  const pages = (Array.isArray(value.pages) ? value.pages : []).map(item => pageFrom({ ...item, id: item.pageId || item.id }))
    .filter(item => {
      if (!item || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    }).slice(0, 30).map(item => ({ pageId: item.id, url: item.url, title: item.title, tags: item.tags }));
  return {
    id: String(value.id),
    revision: Math.floor(finite(value.revision)),
    status: statusOf(value),
    statusChangedAt: finite(value.statusChangedAt, finite(value.updatedAt, now)),
    completedAt: statusOf(value) === 'completed' ? finite(value.completedAt, finite(value.updatedAt, now)) : null,
    name: [...String(value.name || '未命名任务').trim()].slice(0, TASK_LIMITS.name).join('') || '未命名任务',
    color: String(value.color || 'blue').slice(0, 30),
    locked: true,
    createdAt: finite(value.createdAt, now),
    updatedAt: finite(value.updatedAt, now),
    lastRestoredAt: Math.max(0, finite(value.lastRestoredAt, 0)),
    lastActivePageId: pages.some(page => page.pageId === value.lastActivePageId) ? value.lastActivePageId : null,
    lastRestoreResult: value.lastRestoreResult && {
      at: finite(value.lastRestoreResult.at),
      opened: Math.min(30, Math.floor(finite(value.lastRestoreResult.opened))),
      reused: Math.min(30, Math.floor(finite(value.lastRestoreResult.reused))),
      failedCount: Math.min(30, Math.floor(finite(value.lastRestoreResult.failedCount))),
    } || null,
    notes: [...String(value.notes || '')].slice(0, TASK_LIMITS.notes).join(''),
    goal: [...String(value.goal || '')].slice(0, TASK_LIMITS.goal).join(''),
    checkpoint: value.checkpoint?.source === 'confirmed' ? {
      at: finite(value.checkpoint.at), confirmedAt: finite(value.checkpoint.confirmedAt), source: 'confirmed',
      progress: [...String(value.checkpoint.progress || '')].slice(0, TASK_LIMITS.progress).join(''),
      blocker: [...String(value.checkpoint.blocker || '')].slice(0, TASK_LIMITS.blocker).join(''),
      nextStep: [...String(value.checkpoint.nextStep || '')].slice(0, TASK_LIMITS.nextStep).join(''),
      page: checkpointPage(value.checkpoint.page),
      evidence: value.checkpoint.evidence?.segmentId ? { segmentId: String(value.checkpoint.evidence.segmentId), at: finite(value.checkpoint.evidence.at), startedAt: finite(value.checkpoint.evidence.startedAt) } : null,
    } : null,
    pages,
  };
}

export function segmentFrom(value) {
  if (!value || !value.id || !value.pageId || !validUrl(value.url)) return null;
  if (!['active', 'idle', 'unknown'].includes(value.status)) return null;
  if (!Number.isFinite(value.startedAt) || !Number.isFinite(value.endedAt)
    || value.startedAt < 0 || value.endedAt < value.startedAt) return null;
  const duration = value.endedAt - value.startedAt;
  return {
    id: String(value.id),
    sessionId: String(value.sessionId || 'legacy'),
    pageId: String(value.pageId),
    url: validUrl(value.url).href,
    title: String(value.title || '').slice(0, 500),
    tags: tags(value.tags),
    taskId: typeof value.taskId === 'string' && value.taskId ? value.taskId : null,
    intendedTaskId: typeof value.intendedTaskId === 'string' && value.intendedTaskId ? value.intendedTaskId : null,
    assignmentSource: ['saved', 'confirmed', 'excluded'].includes(value.assignmentSource) ? value.assignmentSource : 'unknown',
    excludedFromIntent: value.excludedFromIntent === true,
    tabId: Number.isInteger(value.tabId) ? value.tabId : null,
    windowId: Number.isInteger(value.windowId) ? value.windowId : null,
    startedAt: value.startedAt,
    endedAt: value.endedAt,
    foregroundMs: value.status === 'active' ? Math.min(duration, finite(value.foregroundMs, duration)) : 0,
    status: value.status,
    endReason: String(value.endReason || 'observed').slice(0, 80),
  };
}

function vectorFrom(value) {
  if (!value || !value.id || !value.model || !value.textHash) return null;
  const vector = Array.isArray(value.vector) || ArrayBuffer.isView(value.vector) ? Array.from(value.vector) : [];
  if (!vector.length || vector.length > 8_192 || vector.some(item => !Number.isFinite(item))) return null;
  return {
    id: String(value.id),
    vector,
    model: String(value.model),
    textHash: String(value.textHash),
    updatedAt: finite(value.updatedAt, Date.now()),
  };
}

export function relationFrom(value) {
  const page = checkpointPage(value?.page);
  if (!value?.taskId || !page || !['related', 'unrelated'].includes(value.decision) || !value.revision) throw failure('INVALID_RELATION', '关联记忆缺少有效页面或决定。');
  return { id: relationId(String(value.taskId), page.pageId), taskId: String(value.taskId), pageId: page.pageId,
    page, decision: value.decision, source: 'manual', revision: String(value.revision), at: finite(value.at, Date.now()) };
}

export function emptyWorkspace() { return { context: null, drafts: {}, support: { shown: [], snoozed: {} }, events: [], undo: {} }; }

/** @returns {Promise<object>} A small promise-based store API. */
export async function openStore(options = {}) {
  const factory = options.indexedDB || globalThis.indexedDB;
  const keyRange = options.IDBKeyRange || globalThis.IDBKeyRange;
  if (!factory) throw new Error('IndexedDB is unavailable; local history cannot be saved.');
  const database = await new Promise((resolve, reject) => {
    let abandoned = false;
    const request = factory.open(options.name || DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error || new Error('Could not open local history'));
    request.onblocked = () => {
      abandoned = true;
      reject(new Error('本机数据升级被另一个 Focuence 页面阻塞。请关闭其他 Focuence 页面后重试。'));
    };
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: name === 'meta' ? 'key' : 'id' });
      }
      const segments = request.transaction.objectStore('segments');
      for (const field of ['startedAt', 'endedAt', 'pageId', 'sessionId']) {
        if (!segments.indexNames.contains(field)) segments.createIndex(field, field, { unique: false });
      }
      const vectors = request.transaction.objectStore('vectors');
      if (!vectors.indexNames.contains('updatedAt')) vectors.createIndex('updatedAt', 'updatedAt', { unique: false });
    };
    request.onsuccess = () => {
      if (abandoned) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });

  function transaction(names, mode, operation) {
    return new Promise((resolve, reject) => {
      let result;
      let tx;
      try {
        tx = database.transaction(names, mode);
      } catch (error) {
        reject(error);
        return;
      }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(persistenceError(tx.error) || new Error('Local database transaction failed'));
      tx.onabort = () => reject(persistenceError(tx.error) || new Error('Local database transaction was interrupted'));
      const stores = Object.fromEntries(names.map(name => [name, tx.objectStore(name)]));
      Promise.resolve().then(() => operation(stores, tx)).then(value => { result = value; }).catch(error => {
        try { tx.abort(); } catch { /* The transaction may already have aborted. */ }
        reject(persistenceError(error));
      });
    });
  }

  function putRecords(store, values, sanitize) {
    let count = 0;
    for (const value of values || []) {
      const record = sanitize(value);
      if (!record) continue;
      store.put(record);
      count += 1;
    }
    return count;
  }

  async function exportSnapshot(stores) {
    const [settings, pages, tasks, segments, taskRelations] = await Promise.all([
      req(stores.meta.get('settings')), req(stores.pages.getAll()), req(stores.tasks.getAll()),
      req(stores.segments.getAll()), req(stores.taskRelations.getAll()),
    ]);
    return {schemaVersion: 4, exportedAt: new Date().toISOString(), pages, tasks: tasks.map(taskFrom), taskRelations,
      segments: segments.sort((a, b) => a.startedAt - b.startedAt), settings: settingsFrom(settings?.value)};
  }

  const api = {
    getMeta(key) { return transaction(['meta'], 'readonly', async ({meta}) => (await req(meta.get(key)))?.value ?? null); },
    setMeta(key, value) { return transaction(['meta'], 'readwrite', ({meta}) => { meta.put({key, value}); return value; }); },
    listTabOperations() { return transaction(['tabOperations'], 'readonly', async ({tabOperations}) => (await req(tabOperations.getAll())).sort((a,b) => b.at-a.at)); },
    getTabOperation(id) { return transaction(['tabOperations'], 'readonly', async ({tabOperations}) => await req(tabOperations.get(id)) || null); },
    putTabOperation(value) { return transaction(['tabOperations'], 'readwrite', ({tabOperations}) => { tabOperations.put(value); return value; }); },
    getRestorePoint() { return transaction(['restorePoints'], 'readonly', async ({restorePoints}) => await req(restorePoints.get('before-import')) || null); },
    getSettings() {
      return transaction(['meta'], 'readonly', async ({ meta }) => settingsFrom((await req(meta.get('settings')))?.value));
    },

    setSettings(patch) {
      return transaction(['meta'], 'readwrite', async ({ meta }) => {
        const old = (await req(meta.get('settings')))?.value || {};
        const value = settingsFrom({ ...old, ...(patch || {}) });
        meta.put({ key: 'settings', value });
        return value;
      });
    },

    putPages(values) {
      return transaction(['pages'], 'readwrite', ({ pages }) => putRecords(pages, values, pageFrom));
    },

    getPages() {
      return transaction(['pages'], 'readonly', ({ pages }) => req(pages.getAll()));
    },

    getPage(id) {
      return transaction(['pages'], 'readonly', async ({ pages }) => (await req(pages.get(id))) || null);
    },

    putTask(value) {
      const task = taskFrom(value);
      return transaction(['tasks'], 'readwrite', ({ tasks }) => {
        tasks.put(task);
        return task;
      });
    },

    getTask(id) {
      return transaction(['tasks'], 'readonly', async ({ tasks }) => { const value = await req(tasks.get(id)); return value ? taskFrom(value) : null; });
    },

    getTasks() {
      return transaction(['tasks'], 'readonly', async ({ tasks }) => (await req(tasks.getAll())).map(taskFrom).sort((a, b) => b.updatedAt - a.updatedAt));
    },

    getRelations() {
      return transaction(['taskRelations'], 'readonly', ({ taskRelations }) => req(taskRelations.getAll()));
    },

    getWorkspace() {
      return transaction(['meta'], 'readonly', async ({ meta }) => ({ ...emptyWorkspace(), ...((await req(meta.get('workspace')))?.value || {}) }));
    },

    /** Compare and atomically commit intent, task decisions and their visit boundary. */
    commitWorkspace(change = {}) {
      const normalizedTasks = (change.tasks || []).map(taskFrom);
      const normalizedRelations = (change.relations || []).map(relationFrom);
      return transaction(['meta', 'tasks', 'taskRelations', 'segments', 'vectors', 'tabOperations'], 'readwrite', async stores => {
        for (const { id, revision } of change.expectedTasks || []) assertRevision(await req(stores.tasks.get(id)), revision);
        if (change.expectedContext) {
          const actual = (await req(stores.meta.get('workspace')))?.value?.context;
          const check = change.expectedContext;
          if (actual?.sessionId !== check.sessionId || (actual.windows?.[check.windowId]?.revision || 0) !== check.revision) throw failure('STALE_CONTEXT', '当前任务已改变，请重新读取。');
        }
        for (const task of normalizedTasks) stores.tasks.put(task);
        for (const relation of normalizedRelations) stores.taskRelations.put(relation);
        for (const id of change.deleteRelations || []) stores.taskRelations.delete(id);
        const removed = new Set(change.deleteTasks || []);
        const reset = new Set([...(change.resetRelations || []), ...removed]);
        if (reset.size) for (const relation of await req(stores.taskRelations.getAll())) if (reset.has(relation.taskId)) stores.taskRelations.delete(relation.id);
        for (const id of removed) stores.tasks.delete(id);
        if (removed.size) for (const vector of await req(stores.vectors.getAll())) {
          if ([...removed].some(id => vector.id === `mem:goal:${id}` || vector.id.startsWith(`mem:task:${id}:`))) stores.vectors.delete(vector.id);
        }
        if (change.workspace) stores.meta.put({ key: 'workspace', value: change.workspace });
        if (change.activity) stores.meta.put({ key: 'activity', value: change.activity });
        putRecords(stores.segments, change.segments || [], segmentFrom);
        for (const operation of change.tabOperations || []) stores.tabOperations.put(operation);
        return { tasks: normalizedTasks, relations: normalizedRelations };
      });
    },

    deleteTask(id) {
      return transaction(['tasks'], 'readwrite', async ({ tasks }) => {
        const existed = Boolean(await req(tasks.get(id)));
        tasks.delete(id);
        return existed;
      });
    },

    addSegments(values) {
      return transaction(['segments'], 'readwrite', ({ segments }) => putRecords(segments, values, segmentFrom));
    },

    listSegments({ since = 0, until = Infinity, limit = Infinity, pageId } = {}) {
      return transaction(['segments'], 'readonly', async ({ segments }) => {
        const range = keyRange && Number.isFinite(since) ? keyRange.lowerBound(Math.max(0, since)) : undefined;
        let values = await req(segments.index('endedAt').getAll(range));
        values = values.filter(item => item.endedAt >= since && item.startedAt <= until && (!pageId || item.pageId === pageId))
          .sort((a, b) => a.startedAt - b.startedAt || a.endedAt - b.endedAt || a.id.localeCompare(b.id));
        if (Number.isFinite(limit)) {
          const count = Math.max(0, Math.floor(limit));
          values = count ? values.slice(-count) : [];
        }
        return values;
      });
    },

    saveActivity(state, values = [], workspace) {
      return transaction(['meta', 'segments'], 'readwrite', ({ meta, segments }) => {
        meta.put({ key: 'activity', value: state });
        putRecords(segments, values, segmentFrom);
        if (workspace) meta.put({ key: 'workspace', value: workspace });
        return state;
      });
    },

    getActivity() {
      return transaction(['meta'], 'readonly', async ({ meta }) => (await req(meta.get('activity')))?.value || null);
    },

    getVectors(ids = []) {
      return transaction(['vectors'], 'readonly', async ({ vectors }) => {
        const results = await Promise.all(ids.map(id => req(vectors.get(id))));
        return results.filter(Boolean);
      });
    },

    putVectors(values) {
      return transaction(['vectors'], 'readwrite', ({ vectors }) => putRecords(vectors, values, vectorFrom));
    },

    prune({ now = Date.now(), retentionDays } = {}) {
      return transaction(['meta', 'segments', 'pages', 'tasks', 'vectors', 'tabOperations'], 'readwrite', async stores => {
        const saved = (await req(stores.meta.get('settings')))?.value;
        const days = retentionDays === undefined ? settingsFrom(saved).retentionDays : Math.max(1, Math.min(365, retentionDays));
        const cutoff = now - days * 86_400_000;
        const allSegments = await req(stores.segments.getAll());
        const keptPageIds = new Set();
        let deletedSegments = 0;
        let clippedSegments = 0;
        for (const segment of allSegments) {
          if (segment.endedAt < cutoff) {
            stores.segments.delete(segment.id);
            deletedSegments += 1;
          } else {
            if (segment.startedAt < cutoff) {
              stores.segments.put({
                ...segment,
                startedAt: cutoff,
                foregroundMs: segment.status === 'active' ? Math.min(segment.foregroundMs, segment.endedAt - cutoff) : 0,
              });
              clippedSegments += 1;
            }
            keptPageIds.add(segment.pageId);
          }
        }
        const [tasks, pages, vectors, activity] = await Promise.all([
          req(stores.tasks.getAll()), req(stores.pages.getAll()), req(stores.vectors.getAll()), req(stores.meta.get('activity')),
        ]);
        for (const task of tasks) for (const page of task.pages || []) keptPageIds.add(page.pageId);
        let activityState = activity?.value || null;
        if (activityState) {
          if (activityState.lastConfirmedAt < cutoff) {
            activityState = { ...activityState, open: null, context: null };
            stores.meta.put({ key: 'activity', value: activityState });
          } else if (activityState.open?.startedAt < cutoff) {
            const open = activityState.open;
            activityState = { ...activityState, open: {
              ...open,
              startedAt: cutoff,
              foregroundMs: open.status === 'active' ? Math.min(open.foregroundMs, open.endedAt - cutoff) : 0,
            } };
            stores.meta.put({ key: 'activity', value: activityState });
          }
          if (activityState.context?.pageId) keptPageIds.add(activityState.context.pageId);
        }
        const workspace = (await req(stores.meta.get('workspace')))?.value;
        if (workspace) {
          workspace.drafts = Object.fromEntries(Object.entries(workspace.drafts || {}).filter(([, value]) => value.at >= cutoff));
          workspace.events = (workspace.events || []).filter(value => value.at >= cutoff);
          workspace.support = { ...workspace.support, shown: (workspace.support?.shown || []).filter(value => value.at >= cutoff) };
          stores.meta.put({ key: 'workspace', value: workspace });
        }
        let deletedPages = 0;
        for (const page of pages) {
          if (page.lastSeen < cutoff && !keptPageIds.has(page.id)) {
            stores.pages.delete(page.id);
            deletedPages += 1;
          }
        }
        let deletedVectors = 0;
        for (const vector of vectors) {
          if (vector.updatedAt < cutoff) {
            stores.vectors.delete(vector.id);
            deletedVectors += 1;
          }
        }
        for (const item of await req(stores.tabOperations.getAll())) if (item.at < now - 30 * 86400000) stores.tabOperations.delete(item.id);
        return { deletedSegments, clippedSegments, deletedPages, deletedVectors, cutoff, activity: activityState, workspace: workspace || null };
      });
    },

    exportData() {
      return transaction(['meta', 'pages', 'tasks', 'segments', 'taskRelations'], 'readonly', exportSnapshot);
    },

    /** Validate the reviewed base and take a rollback snapshot in the same transaction. */
    applyImport(plan) {
      return transaction(STORES, 'readwrite', async stores => {
        const before = await exportSnapshot(stores);
        if (backupStamp(before, plan.mode === 'replace') !== plan.baseStamp) throw failure('IMPORT_PREVIEW_STALE', '本机资料已改变，请保留选择并重新预览。');
        stores.restorePoints.put({id: 'before-import', at: Date.now(), data: before});
        if (plan.mode === 'replace') for (const name of ['pages','tasks','taskRelations','segments']) stores[name].clear();
        putRecords(stores.pages, plan.data.pages, pageFrom);
        putRecords(stores.tasks, plan.data.tasks, taskFrom);
        for (const id of plan.resetRelations || []) for (const relation of await req(stores.taskRelations.getAll())) if (relation.taskId === id) stores.taskRelations.delete(relation.id);
        putRecords(stores.taskRelations, plan.data.taskRelations, relationFrom);
        putRecords(stores.segments, plan.data.segments, segmentFrom);
        if (plan.adoptSettings || plan.mode === 'replace') stores.meta.put({key: 'settings', value: settingsFrom(plan.data.settings)});
        stores.meta.put({key: 'workspace', value: emptyWorkspace()});
        stores.meta.delete('activity'); stores.vectors.clear();
        return {imported: true, counts: plan.counts};
      });
    },

    clearHistory() {
      return transaction(['meta', 'segments', 'pages', 'vectors', 'restorePoints'], 'readwrite', async stores => {
        const old = (await req(stores.meta.get('workspace')))?.value;
        if (old) stores.meta.put({ key: 'workspace', value: { ...old, drafts: {}, events: [], support: { shown: [], snoozed: {} }, undo: {} } });
        stores.meta.delete('activity');
        stores.segments.clear();
        stores.pages.clear();
        stores.vectors.clear();
        stores.restorePoints.clear();
        return { cleared: true };
      });
    },

    clearAll() {
      return transaction(STORES, 'readwrite', stores => {
        for (const store of Object.values(stores)) store.clear();
        return { cleared: true };
      });
    },

    close() {
      database.close();
    },
  };

  return api;
}
