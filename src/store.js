/** IndexedDB persistence. No Chrome globals, network, or in-memory fallback. */

export const DEFAULT_SETTINGS = Object.freeze({
  tracking: true,
  semantic: true,
  idleSeconds: 120,
  retentionDays: 30,
  excludedDomains: [],
});

const DATABASE_NAME = 'focuence-local-v2';
const DATABASE_VERSION = 1;
const STORES = ['meta', 'pages', 'tasks', 'segments', 'vectors'];

function req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Local database request failed'));
  });
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

function settingsFrom(value = {}) {
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
  };
}

function pageFrom(value) {
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

function taskFrom(value) {
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
    name: String(value.name || '未命名任务').trim().slice(0, 120) || '未命名任务',
    color: String(value.color || 'blue').slice(0, 30),
    locked: true,
    createdAt: finite(value.createdAt, now),
    updatedAt: finite(value.updatedAt, now),
    notes: String(value.notes || '').slice(0, 20_000),
    pages,
  };
}

function segmentFrom(value) {
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

/** @returns {Promise<object>} A small promise-based store API. */
export async function openStore(options = {}) {
  const factory = options.indexedDB || globalThis.indexedDB;
  const keyRange = options.IDBKeyRange || globalThis.IDBKeyRange;
  if (!factory) throw new Error('IndexedDB is unavailable; local history cannot be saved.');
  const database = await new Promise((resolve, reject) => {
    const request = factory.open(options.name || DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error || new Error('Could not open local history'));
    request.onblocked = () => reject(new Error('Local database is blocked by another open Focuence page. Close it and retry.'));
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
      tx.onerror = () => reject(tx.error || new Error('Local database transaction failed'));
      tx.onabort = () => reject(tx.error || new Error('Local database transaction was interrupted'));
      const stores = Object.fromEntries(names.map(name => [name, tx.objectStore(name)]));
      Promise.resolve().then(() => operation(stores, tx)).then(value => { result = value; }).catch(error => {
        try { tx.abort(); } catch { /* The transaction may already have aborted. */ }
        reject(error);
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

  const api = {
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
      return transaction(['tasks'], 'readonly', async ({ tasks }) => (await req(tasks.get(id))) || null);
    },

    getTasks() {
      return transaction(['tasks'], 'readonly', async ({ tasks }) => (await req(tasks.getAll())).sort((a, b) => b.updatedAt - a.updatedAt));
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

    saveActivity(state, values = []) {
      return transaction(['meta', 'segments'], 'readwrite', ({ meta, segments }) => {
        meta.put({ key: 'activity', value: state });
        putRecords(segments, values, segmentFrom);
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
      return transaction(['meta', 'segments', 'pages', 'tasks', 'vectors'], 'readwrite', async stores => {
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
        return { deletedSegments, clippedSegments, deletedPages, deletedVectors, cutoff, activity: activityState };
      });
    },

    exportData() {
      return transaction(['meta', 'pages', 'tasks', 'segments'], 'readonly', async stores => {
        const [settings, pages, tasks, segments] = await Promise.all([
          req(stores.meta.get('settings')), req(stores.pages.getAll()), req(stores.tasks.getAll()), req(stores.segments.getAll()),
        ]);
        return {
          schemaVersion: 2,
          exportedAt: new Date().toISOString(),
          pages,
          tasks,
          segments: segments.sort((a, b) => a.startedAt - b.startedAt),
          settings: settingsFrom(settings?.value),
        };
      });
    },

    clearHistory() {
      return transaction(['meta', 'segments', 'pages', 'vectors'], 'readwrite', stores => {
        stores.meta.delete('activity');
        stores.segments.clear();
        stores.pages.clear();
        stores.vectors.clear();
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
