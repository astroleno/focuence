import { normalizeUrl, pageIdForUrl } from './text.js';
import { failure, taskText, relationFor } from './task-context.js';

export function checkpointPage(value) {
  const url = normalizeUrl(value?.url);
  if (!url) return null;
  return { pageId: pageIdForUrl(url), url, title: String(value.title || new URL(url).hostname).slice(0, 500) };
}

export function observedDraft(previous = null, segments = [], taskId, now = Date.now()) {
  const last = segments.filter(item => item.taskId === taskId && item.status === 'active' && item.foregroundMs >= 1000 && item.endedAt <= now)
    .sort((a, b) => b.endedAt - a.endedAt)[0];
  if (!last || (previous?.at || 0) > last.endedAt) return previous;
  const page = checkpointPage(last);
  return page ? { at: last.endedAt, page, segmentId: last.id, startedAt: last.startedAt, source: 'observed' } : previous;
}

export function makeCheckpoint(input, { task, pages = [], relations = [], draft = null, now = Date.now() }) {
  const progress = taskText(input.progress, 'progress');
  const blocker = taskText(input.blocker, 'blocker');
  const nextStep = taskText(input.nextStep, 'nextStep');
  let page = null;
  if (input.pageId) {
    const candidate = [...(task.pages || []), ...pages, ...relations.filter(item => item.taskId === task.id && item.decision === 'related').map(item => item.page)]
      .find(item => (item?.pageId || item?.id) === input.pageId);
    if (!candidate || !relationFor(task, input.pageId, relations).related) throw failure('STALE_CHECKPOINT', '继续页面已不属于这个任务，请重新选择。');
    page = checkpointPage(candidate);
  }
  if (!progress && !blocker && !nextStep && !page) throw failure('INVALID_CHECKPOINT', '写下一条继续线索，或选择继续页面。');
  const evidence = input.evidenceId ? draft?.segmentId === input.evidenceId && draft.page?.pageId === page?.pageId ? { segmentId: draft.segmentId, at: draft.at, startedAt: draft.startedAt } : null : null;
  if (input.evidenceId && !evidence) throw failure('STALE_CHECKPOINT', '访问线索已经更新，请重新核对后保存。');
  return { at: now, confirmedAt: now, source: 'confirmed', progress, blocker, nextStep, page, evidence };
}

export function checkpointEvidence(checkpoint, segments = []) {
  if (!checkpoint?.evidence) return { available: false, reason: 'none' };
  const item = segments.find(segment => segment.id === checkpoint.evidence.segmentId && segment.pageId === checkpoint.page?.pageId
    && segment.startedAt <= checkpoint.evidence.at && segment.endedAt >= checkpoint.evidence.at);
  return { available: Boolean(item), reason: item ? 'recorded' : 'expired' };
}
