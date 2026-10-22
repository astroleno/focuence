/**
 * Pure foreground-visit recorder. The caller supplies observations and persists
 * { state, segments } atomically. Repeated checkpoints upsert the same segment
 * id; they do not manufacture visits or transitions.
 */

export const DEFAULT_MAX_GAP_MS = 90_000;

const EVENT_TYPES = new Set(['context', 'idle', 'pause', 'resume', 'heartbeat', 'flush', 'restart']);
const IDLE_STATES = new Set(['active', 'idle', 'locked']);

function finiteTime(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function cleanContext(value) {
  if (!value || value.incognito) return null;
  let url;
  try {
    url = new URL(value.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  } catch {
    return null;
  }
  const pageId = String(value.pageId ?? value.id ?? '').trim();
  if (!pageId) return null;
  return {
    pageId,
    url: url.href,
    title: String(value.title || url.hostname).slice(0, 500),
    tags: [...new Set((Array.isArray(value.tags) ? value.tags : [])
      .filter(tag => typeof tag === 'string').map(tag => tag.trim().slice(0, 60)).filter(Boolean))].slice(0, 8),
    taskId: typeof value.taskId === 'string' && value.taskId ? value.taskId : null,
    tabId: Number.isInteger(value.tabId) ? value.tabId : null,
    windowId: Number.isInteger(value.windowId) ? value.windowId : null,
  };
}

function cloneRecord(record) {
  return record ? { ...record, tags: [...(record.tags || [])] } : null;
}

function sameContext(a, b) {
  if (!a || !b) return a === b;
  return a.pageId === b.pageId && a.url === b.url && a.tabId === b.tabId
    && a.windowId === b.windowId && a.title === b.title && a.taskId === b.taskId
    && a.tags.length === b.tags.length && a.tags.every((tag, index) => tag === b.tags[index]);
}

function atTime(record, endedAt, endReason) {
  const end = Math.max(record.startedAt, endedAt);
  return {
    ...record,
    tags: [...record.tags],
    endedAt: end,
    foregroundMs: record.status === 'active' ? end - record.startedAt : 0,
    endReason,
  };
}

function makeSegment(state, context, startedAt, endedAt, status, endReason) {
  state.sequence += 1;
  return {
    id: `${state.sessionId}:${state.sequence}:${startedAt}`,
    sessionId: state.sessionId,
    pageId: context.pageId,
    url: context.url,
    title: context.title,
    tags: [...context.tags],
    taskId: context.taskId,
    tabId: context.tabId,
    windowId: context.windowId,
    startedAt,
    endedAt,
    foregroundMs: status === 'active' ? Math.max(0, endedAt - startedAt) : 0,
    status,
    endReason,
  };
}

function reasonForChange(event, previous, next, status) {
  if (event.type === 'pause' || !next.tracking) return 'paused';
  if (event.type === 'restart') return 'restarted';
  if (!next.context) return 'focus-lost';
  if (status === 'idle') return next.idleState === 'locked' ? 'locked' : 'idle';
  if (previous.idleState !== next.idleState) return 'became-active';
  if (previous.context?.tabId !== next.context.tabId || previous.context?.windowId !== next.context.windowId) return 'tab-switch';
  if (previous.context?.pageId !== next.context.pageId || previous.context?.url !== next.context.url) return 'navigation';
  return 'metadata-change';
}

function applyObservation(state, event) {
  if (Object.prototype.hasOwnProperty.call(event, 'context')) state.context = cleanContext(event.context);
  if (IDLE_STATES.has(event.idleState)) state.idleState = event.idleState;
  if (typeof event.tracking === 'boolean') state.tracking = event.tracking;
  if (event.type === 'pause') state.tracking = false;
  if (event.type === 'resume') state.tracking = true;
}

/** Load a persisted state as-is; create a state only for a genuinely new ledger. */
export function createActivityState(options = {}) {
  const now = finiteTime(options.now, Date.now());
  return {
    version: 2,
    sessionId: String(options.sessionId || `s-${now}`),
    sequence: 0,
    tracking: options.tracking !== false,
    idleState: IDLE_STATES.has(options.idleState) ? options.idleState : 'active',
    context: null,
    open: null,
    lastEventAt: now,
    lastConfirmedAt: now,
    maxGapMs: Math.max(1_000, finiteTime(options.maxGapMs, DEFAULT_MAX_GAP_MS)),
    clockRegressedUntil: null,
    warning: null,
  };
}

/**
 * Events: {type, at, context?, idleState?, tracking?, sessionId?}.
 * context=null means no eligible focused HTTP(S) page. Every context must carry
 * the URL/tag snapshot for that visit, rather than a mutable page reference.
 * `restart` means an actual browser restart/discontinuity, NOT a routine MV3
 * service-worker wake. Routine wakes reload state and send context/heartbeat.
 */
export function reduceActivity(inputState, event) {
  if (!event || !EVENT_TYPES.has(event.type)) throw new TypeError('Unknown activity event');
  if (!Number.isFinite(event.at) || event.at < 0) throw new TypeError('Activity event needs a nonnegative timestamp');
  if (event.idleState !== undefined && !IDLE_STATES.has(event.idleState)) throw new TypeError('Unknown idle state');

  const base = inputState || createActivityState({ now: event.at });
  const state = {
    ...base,
    context: cleanContext(base.context),
    open: cloneRecord(base.open),
    maxGapMs: Math.max(1_000, finiteTime(base.maxGapMs, DEFAULT_MAX_GAP_MS)),
  };
  const segments = [];
  const at = event.at;
  const previous = { context: state.context, idleState: state.idleState };

  // A wall-clock regression must never create negative or overlapping active
  // time. Keep observations current, but suspend counting until the prior time
  // is reached. The warning makes this conservative missing interval explicit.
  if (at < state.lastEventAt) {
    if (state.open) segments.push(atTime(state.open, state.lastConfirmedAt, 'clock-regression'));
    state.open = null;
    state.clockRegressedUntil = state.lastEventAt;
    state.warning = 'clock-regression';
    applyObservation(state, event);
    return { state, segments };
  }

  if (state.clockRegressedUntil !== null && state.clockRegressedUntil !== undefined) {
    state.clockRegressedUntil = null;
    state.warning = null;
    state.lastConfirmedAt = at;
  }

  const gap = Math.max(0, at - state.lastConfirmedAt);
  const discontinuity = event.type === 'restart' || gap > state.maxGapMs;
  let current = null;

  if (state.open && discontinuity) {
    const reason = event.type === 'restart' ? 'restart-gap' : 'clock-gap';
    segments.push(atTime(state.open, state.lastConfirmedAt, reason));
    if (gap > 0 && state.context && state.tracking) {
      segments.push(makeSegment(state, state.context, state.lastConfirmedAt, at, 'unknown', reason));
    }
    state.open = null;
  } else if (state.open) {
    current = atTime(state.open, at, 'checkpoint');
  }

  if (event.type === 'restart') {
    state.sessionId = String(event.sessionId || `s-${at}-r${state.sequence + 1}`);
    state.open = null;
    // A browser restart gives no evidence that the old page is still focused.
    // Reopen only after an explicit fresh context observation.
    if (!Object.prototype.hasOwnProperty.call(event, 'context')) state.context = null;
  }

  applyObservation(state, event);
  const desiredStatus = state.tracking && state.context
    ? (state.idleState === 'active' ? 'active' : 'idle')
    : null;

  if (current) {
    if (desiredStatus === current.status && sameContext(previous.context, state.context)) {
      state.open = current;
      segments.push(cloneRecord(current));
    } else {
      current.endReason = reasonForChange(event, previous, state, desiredStatus);
      segments.push(current);
      state.open = null;
    }
  }

  if (!state.open && desiredStatus) {
    state.open = makeSegment(state, state.context, at, at, desiredStatus, 'checkpoint');
    segments.push(cloneRecord(state.open));
  }

  state.lastEventAt = at;
  state.lastConfirmedAt = at;
  return { state, segments };
}

/** Non-mutating preview; merge returned records by id over persisted records. */
export function previewActivity(state, now = Date.now()) {
  if (!state) return [];
  return reduceActivity(state, { type: 'heartbeat', at: now }).segments;
}
