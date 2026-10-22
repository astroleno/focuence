/** Local, deterministic summaries of observed visits. No generated history. */

const SESSION_BREAK_MS = 15 * 60_000;
const TRANSITION_GAP_MS = 90_000;
const MIN_VISIT_MS = 1_000;
const END_BARRIERS = new Set(['focus-lost', 'paused', 'clock-gap', 'restart-gap', 'restarted', 'clock-regression', 'idle', 'locked']);

export function localDayStart(now = Date.now()) {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function cleanTags(value) {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list.filter(tag => typeof tag === 'string').map(tag => tag.trim()).filter(Boolean))];
}

function primaryTag(segment) {
  return cleanTags(segment?.tags)[0] || '未分类';
}

function eligibleUrl(value) {
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

/** Snapshots from previewActivity replace older snapshots with the same id. */
export function mergeSegmentSnapshots(segments = [], now = Date.now()) {
  const byId = new Map();
  for (const segment of segments) {
    if (!segment || !segment.id || !segment.pageId || !eligibleUrl(segment.url)) continue;
    if (!['active', 'idle', 'unknown'].includes(segment.status)) continue;
    if (!Number.isFinite(segment.startedAt) || !Number.isFinite(segment.endedAt)
      || segment.startedAt < 0 || segment.endedAt < segment.startedAt || segment.startedAt > now) continue;
    const existing = byId.get(segment.id);
    if (existing && existing.endedAt > segment.endedAt) continue;
    const endedAt = Math.min(segment.endedAt, now);
    const duration = endedAt - segment.startedAt;
    const rawDuration = segment.endedAt - segment.startedAt;
    const rawForeground = Number.isFinite(segment.foregroundMs) ? segment.foregroundMs : rawDuration;
    byId.set(segment.id, {
      ...segment,
      endedAt,
      foregroundMs: segment.status === 'active' ? Math.max(0, Math.min(duration, rawForeground)) : 0,
      tags: cleanTags(segment.tags),
    });
  }
  return [...byId.values()].sort((a, b) => a.startedAt - b.startedAt || a.endedAt - b.endedAt || String(a.id).localeCompare(String(b.id)));
}

function observedTransitions(segments) {
  const result = [];
  let previous = null;
  let previousEnd = null;
  let sourceSession = null;
  let episode = 0;
  let breakEpisode = false;

  for (const segment of segments) {
    const source = segment.sessionId || 'recorded';
    const sourceChanged = sourceSession !== null && source !== sourceSession;
    const separated = previousEnd !== null && segment.startedAt - previousEnd >= SESSION_BREAK_MS;
    if (sourceSession === null || sourceChanged || separated || breakEpisode) {
      episode += 1;
      previous = null;
      breakEpisode = false;
    }
    sourceSession = source;
    previousEnd = Math.max(previousEnd ?? 0, segment.endedAt);

    if (segment.status !== 'active' || segment.foregroundMs < MIN_VISIT_MS) {
      previous = null;
      if (segment.endedAt - segment.startedAt >= SESSION_BREAK_MS || segment.endReason === 'restart-gap') breakEpisode = true;
      continue;
    }

    if (previous) {
      const delay = segment.startedAt - previous.endedAt;
      if (previous.pageId !== segment.pageId && delay >= 0 && delay <= TRANSITION_GAP_MS && !END_BARRIERS.has(previous.endReason)) {
        result.push({
          from: previous,
          to: segment,
          delayMs: delay,
          episodeId: `${source}:${episode}`,
        });
      }
    }
    previous = END_BARRIERS.has(segment.endReason) ? null : segment;
  }
  return result;
}

function summarizeTransitions(observed) {
  const edges = new Map();
  const totals = new Map();
  for (const transition of observed) {
    const from = primaryTag(transition.from);
    const to = primaryTag(transition.to);
    // Same-topic page changes remain in the denominator, even though the map
    // omits self-loops. Otherwise a rare topic exit could misleadingly be 100%.
    totals.set(from, (totals.get(from) || 0) + 1);
    if (from === to) continue;
    const key = JSON.stringify([from, to]);
    const edge = edges.get(key) || { from, to, count: 0, episodes: new Set(), totalDelayMs: 0, lastSeen: 0 };
    edge.count += 1;
    edge.episodes.add(transition.episodeId);
    edge.totalDelayMs += transition.delayMs;
    edge.lastSeen = Math.max(edge.lastSeen, transition.to.startedAt);
    edges.set(key, edge);
  }
  return [...edges.values()].map(edge => ({
    from: edge.from,
    to: edge.to,
    count: edge.count,
    probability: edge.count / totals.get(edge.from),
    sourceTotal: totals.get(edge.from),
    sessions: edge.episodes.size,
    meanDelayMs: Math.round(edge.totalDelayMs / edge.count),
    lastSeen: edge.lastSeen,
  })).sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

function overlap(segment, from, to) {
  return Math.max(0, Math.min(segment.endedAt, to) - Math.max(segment.startedAt, from));
}

function summarizeToday(segments, tasks, observed, now, dayStart) {
  const pageIds = new Set();
  const tags = new Map();
  let todayForegroundMs = 0;
  let todayIdleMs = 0;
  let todayUnknownMs = 0;
  let activeUntil = dayStart;

  for (const segment of segments) {
    const duration = overlap(segment, dayStart, now);
    if (duration <= 0) continue;
    if (segment.status === 'idle') {
      todayIdleMs += duration;
      continue;
    }
    if (segment.status === 'unknown') {
      todayUnknownMs += duration;
      continue;
    }
    // Defensive union: duplicate/corrupt overlapping active records cannot
    // create more foreground time than elapsed wall time.
    const start = Math.max(segment.startedAt, dayStart, activeUntil);
    const end = Math.min(segment.endedAt, now);
    const rawDuration = segment.endedAt - segment.startedAt;
    const fraction = rawDuration > 0 ? Math.min(1, segment.foregroundMs / rawDuration) : 0;
    const counted = Math.max(0, end - start) * fraction;
    activeUntil = Math.max(activeUntil, end);
    if (counted <= 0) continue;
    todayForegroundMs += counted;
    pageIds.add(segment.pageId);
    const labels = segment.tags.length ? segment.tags : ['未分类'];
    for (const tag of labels) {
      const item = tags.get(tag) || { tag, foregroundMs: 0, visits: 0 };
      item.foregroundMs += counted / labels.length;
      item.visits += 1;
      tags.set(tag, item);
    }
  }
  return {
    todayForegroundMs: Math.round(todayForegroundMs),
    todayPages: pageIds.size,
    todaySwitches: observed.filter(item => item.to.startedAt >= dayStart && item.to.startedAt <= now).length,
    totalTasks: tasks.length,
    todayIdleMs: Math.round(todayIdleMs),
    todayUnknownMs: Math.round(todayUnknownMs),
    tags: [...tags.values()].sort((a, b) => b.foregroundMs - a.foregroundMs || a.tag.localeCompare(b.tag)),
  };
}

function buildSuggestions({ segments, tasks, pages, transitions, now, currentContext, currentPageId, limit }) {
  const candidates = new Map();
  const upsert = (value, visitedAt = 0) => {
    const id = value.pageId || value.id;
    if (!id || !eligibleUrl(value.url)) return;
    const old = candidates.get(id);
    candidates.set(id, {
      ...(old || {}),
      pageId: id,
      url: value.url,
      title: value.title || new URL(value.url).hostname,
      tags: cleanTags(value.tags),
      visitedAt: Math.max(old?.visitedAt || 0, visitedAt),
      taskIds: old?.taskIds || new Set(),
    });
  };

  for (const segment of segments) if (segment.status === 'active' && segment.foregroundMs > 0) upsert(segment, segment.endedAt);
  for (const page of pages) upsert(page); // Metadata sighting is not a foreground visit.
  const taskMap = new Map();
  for (const task of tasks) {
    taskMap.set(task.id, task);
    for (const page of task.pages || []) {
      if (!candidates.has(page.pageId || page.id)) upsert(page);
      candidates.get(page.pageId || page.id)?.taskIds.add(task.id);
    }
  }

  const last = segments[segments.length - 1];
  const liveLast = last?.status === 'active' && !END_BARRIERS.has(last.endReason) && now - last.endedAt <= TRANSITION_GAP_MS ? last : null;
  const context = currentContext === null ? null : (currentContext || liveLast);
  const activePageId = currentPageId || context?.pageId || null;
  const activeTag = context ? primaryTag(context) : null;
  const activeTaskIds = new Set();
  if (context?.taskId) activeTaskIds.add(context.taskId);
  for (const task of tasks) if (task.pages?.some(page => (page.pageId || page.id) === activePageId)) activeTaskIds.add(task.id);

  const ranked = [];
  for (const candidate of candidates.values()) {
    if (candidate.pageId === activePageId) continue;
    const sameTaskId = [...candidate.taskIds].find(id => activeTaskIds.has(id));
    const savedTaskId = sameTaskId || [...candidate.taskIds][0];
    const recency = candidate.visitedAt > 0 ? 1 / (1 + Math.max(0, now - candidate.visitedAt) / 3_600_000) : 0;
    const predicted = activeTag ? transitions.filter(edge => edge.from === activeTag && candidate.tags.includes(edge.to)
      && edge.sessions >= 3 && edge.count >= 3).sort((a, b) => b.probability - a.probability || b.count - a.count)[0] : null;
    if (!predicted && !candidate.visitedAt && !savedTaskId) continue;

    let method;
    let reason;
    let score;
    let confidence = null;
    if (predicted) {
      method = 'transition';
      confidence = Math.min(0.9, (predicted.count + 1) / (predicted.sourceTotal + 2));
      score = 2 + confidence + recency * 0.1 + (sameTaskId ? 0.2 : 0);
      reason = `在 ${predicted.sessions} 个独立工作时段中，观察到从「${predicted.from}」转向「${predicted.to}」共 ${predicted.count} 次。`;
    } else if (savedTaskId) {
      method = 'task';
      score = (sameTaskId ? 1.4 : 0.3) + recency * 0.3;
      reason = `${sameTaskId ? '与当前页面同属' : '保存在'}「${taskMap.get(savedTaskId)?.name || '已保存任务'}」，可用于恢复工作。`;
    } else {
      method = 'recent';
      score = recency;
      reason = '最近在前台访问过的页面；历史样本不足时，先提供找回入口。';
    }
    ranked.push({
      id: `suggest-${candidate.pageId}`,
      pageId: candidate.pageId,
      url: candidate.url,
      title: candidate.title,
      tags: candidate.tags,
      taskId: savedTaskId || null,
      score,
      confidence,
      reason,
      method,
      support: predicted?.count || 0,
      sessions: predicted?.sessions || 0,
      lastSeen: candidate.visitedAt,
      predictedTag: predicted?.to || null,
    });
  }

  const predictedTags = new Set();
  return ranked.sort((a, b) => b.score - a.score || b.lastSeen - a.lastSeen || a.pageId.localeCompare(b.pageId)).filter(item => {
    if (item.method !== 'transition') return true;
    if (predictedTags.has(item.predictedTag)) return false;
    predictedTags.add(item.predictedTag);
    return true;
  }).slice(0, limit).map(({ predictedTag, ...item }) => item);
}

/**
 * Relationships describe primary-tag transitions, not semantic similarity or
 * causality. A prediction needs three independently separated observed work
 * episodes. Otherwise suggestions are explicitly recent/task restore links.
 * Multi-tag duration is divided between tags, so the time total never doubles.
 */
export function computeAnalytics(options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const dayStart = Number.isFinite(options.dayStart) ? options.dayStart : localDayStart(now);
  const segments = mergeSegmentSnapshots(options.segments || [], now);
  const tasks = Array.isArray(options.tasks) ? options.tasks : [];
  const pages = Array.isArray(options.pages) ? options.pages : [];
  const observed = observedTransitions(segments);
  const transitions = summarizeTransitions(observed);
  const stats = summarizeToday(segments, tasks, observed, now, dayStart);
  const suggestions = buildSuggestions({
    segments,
    tasks,
    pages,
    transitions,
    now,
    currentContext: options.currentContext,
    currentPageId: options.currentPageId,
    limit: Number.isFinite(options.suggestionLimit) ? Math.max(0, Math.floor(options.suggestionLimit)) : 5,
  });
  return { stats, transitions, suggestions };
}
