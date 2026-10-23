import { mergeSegmentSnapshots, localDayStart } from './analytics.js';
import { stableHash } from './text.js';

export const SUPPORT_LIMITS = Object.freeze({ minimumMs: 300000, minimumPageMs: 15000, cooldownMs: 1800000, daily: 3 });
const BARRIERS = new Set(['focus-lost', 'paused', 'clock-gap', 'restart-gap', 'restarted', 'clock-regression', 'idle', 'locked']);

export function returnPrompt({ segments = [], current, context, tracking = true, enabled = false, support = {}, now = Date.now() }) {
  if (!enabled || !tracking || !current?.taskId || !context || context.intendedTaskId !== current.taskId || !Number.isInteger(context.windowId)) return null;
  const snoozeKey = `${context.windowId}:${current.revision}:${current.startedAt}`;
  if (support.snoozed?.[snoozeKey]) return null;
  const recent = (support.shown || []).filter(item => item.at <= now);
  const activePrompt = recent.find(item => item.windowId === context.windowId && item.taskId === current.taskId && item.intentStartedAt === current.startedAt && item.contextRevision === current.revision && !item.dismissed && item.pageId === context.pageId && now - item.at < SUPPORT_LIMITS.cooldownMs);
  if (!activePrompt && (recent.filter(item => item.at >= localDayStart(now)).length >= SUPPORT_LIMITS.daily
    || recent.some(item => now - item.at < SUPPORT_LIMITS.cooldownMs))) return null;
  const sorted = mergeSegmentSnapshots(segments, now);
  let duration = 0, next = null;
  const pages = new Set(), evidence = [];
  for (let index = sorted.length - 1; index >= 0; index--) {
    const segment = sorted[index];
    if (segment.windowId !== context.windowId || segment.intendedTaskId !== current.taskId || segment.startedAt < current.startedAt
      || segment.status !== 'active' || segment.foregroundMs < SUPPORT_LIMITS.minimumPageMs || BARRIERS.has(segment.endReason)
      || (!segment.excludedFromIntent && (!segment.taskId || segment.taskId === current.taskId))) break;
    if (next && (next.startedAt - segment.endedAt > 90000 || next.sessionId !== segment.sessionId)) break;
    if (!next && (now - segment.endedAt > 90000 || segment.pageId !== context.pageId)) return null;
    pages.add(segment.pageId); evidence.push(segment); duration += segment.foregroundMs; next = segment;
  }
  if (duration < SUPPORT_LIMITS.minimumMs || pages.size < 2) return null;
  return {
    id: activePrompt?.id || `return_${stableHash(`${context.windowId}:${current.revision}:${current.startedAt}:${context.pageId}:${next.id}:${recent.at(-1)?.at || 0}`)}`,
    taskId: current.taskId, windowId: context.windowId, contextRevision: current.revision,
    intentStartedAt: current.startedAt,
    pageId: context.pageId, page: { pageId: context.pageId, url: context.url, title: context.title },
    durationMs: duration, pages: pages.size, evidence: evidence.slice(0, 8).map(item => ({ id: item.id, title: item.title, startedAt: item.startedAt, endedAt: item.endedAt })),
    shown: Boolean(activePrompt),
  };
}

export function recordPromptShown(support, prompt, now = Date.now()) {
  if ((support.shown || []).some(item => item.id === prompt.id)) return support;
  return { ...support, shown: [...(support.shown || []).filter(item => item.at >= localDayStart(now) - SUPPORT_LIMITS.cooldownMs),
    { id: prompt.id, at: now, windowId: prompt.windowId, contextRevision: prompt.contextRevision, intentStartedAt: prompt.intentStartedAt, taskId: prompt.taskId, pageId: prompt.pageId, dismissed: false }] };
}

export function dismissPrompt(support, prompt, action) {
  return { ...support,
    shown: (support.shown || []).map(item => item.id === prompt.id ? { ...item, dismissed: true, action } : item),
    snoozed: action === 'snooze' ? { ...support.snoozed, [`${prompt.windowId}:${prompt.contextRevision}:${prompt.intentStartedAt}`]: true } : { ...support.snoozed },
  };
}
