import { normalizeUrl } from './text.js';

/** Match saved page identity before presenting counts or selecting members. */
export function uniqueTaskPages(pages = []) {
  const unique = new Map();
  for (const page of pages) {
    const url = normalizeUrl(page.url);
    if (url && !unique.has(url)) unique.set(url, {...page, url});
  }
  return [...unique.values()];
}

/** A restore plan is based on live URLs, not a stale count from a saved task. */
export function planTaskRestore(task, tabs = [], segments = []) {
  const unique = new Map();
  for (const page of task?.pages || []) {
    const url = normalizeUrl(page.url);
    if (url && !unique.has(url)) unique.set(url, { ...page, url });
  }
  const pages = [...unique.values()].slice(0, 30);
  const open = new Map();
  for (const tab of tabs) {
    const url = normalizeUrl(tab.url);
    if (url && (!open.has(url) || tab.active)) open.set(url, tab);
  }
  const pageUrls = new Set(pages.map(page => page.url));
  const visits = segments.filter(segment => segment.status === 'active' && segment.foregroundMs > 0 && pageUrls.has(normalizeUrl(segment.url)))
    .sort((a, b) => b.endedAt - a.endedAt);
  const active = tabs.find(tab => tab.active && pageUrls.has(normalizeUrl(tab.url)));
  const recent = visits[0];
  const remembered = pages.find(page => (page.pageId || page.id) === task?.lastActivePageId);
  const resumeUrl = active ? normalizeUrl(active.url) : recent ? normalizeUrl(recent.url) : remembered?.url;
  const resumePage = pages.find(page => page.url === resumeUrl) || pages[0] || null;
  const missing = pages.filter(page => !open.has(page.url));
  return {
    pages, missing, total: pages.length, reused: pages.length - missing.length,
    willOpen: missing.length, resumePage, lastVisitedAt: recent?.endedAt || 0,
  };
}

export function taskViews(tasks = [], tabs = [], segments = []) {
  return tasks.map(task => {
    const plan = planTaskRestore(task, tabs, segments);
    return {
      ...task, resumePage: plan.resumePage,
      lastActivityAt: Math.max(task.updatedAt || task.createdAt || 0, task.lastRestoredAt || 0, task.lastRestoreResult?.at || 0, plan.lastVisitedAt),
      restorePreview: { total: plan.total, reused: plan.reused, willOpen: plan.willOpen },
    };
  }).sort((a, b) => b.lastActivityAt - a.lastActivityAt || String(a.id).localeCompare(String(b.id)));
}
