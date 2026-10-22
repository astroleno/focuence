import test from 'node:test';
import assert from 'node:assert/strict';
import { createActivityState, reduceActivity, previewActivity } from '../src/activity.js';

const BASE = 1_700_000_000_000;
const page = (id, extra = {}) => ({ pageId: id, url: `https://example.com/${id}`, title: `Page ${id}`, tags: [id], tabId: 1, windowId: 1, ...extra });

function replay(events, options = {}) {
  let state = createActivityState({ now: BASE, sessionId: 'browser-1', ...options });
  const records = new Map();
  for (const event of events) {
    const result = reduceActivity(state, { ...event, at: BASE + event.at });
    state = result.state;
    for (const segment of result.segments) records.set(segment.id, segment);
  }
  const segments = [...records.values()];
  return { state, segments, activeMs: segments.reduce((sum, segment) => sum + segment.foregroundMs, 0) };
}

test('heartbeat updates one visit instead of duplicating elapsed time', () => {
  const { state, segments, activeMs } = replay([
    { type: 'context', at: 0, context: page('a') },
    { type: 'heartbeat', at: 30_000 },
    { type: 'context', at: 40_000, context: page('b', { tabId: 2 }) },
    { type: 'heartbeat', at: 60_000 },
  ]);
  assert.equal(activeMs, 60_000);
  assert.equal(segments.length, 2);
  assert.equal(segments[0].endReason, 'tab-switch');
  assert.equal(state.open.pageId, 'b');
});

test('navigation in the same tab closes the old content identity', () => {
  const { segments, activeMs } = replay([
    { type: 'context', at: 0, context: page('article', { tags: ['研究'] }) },
    { type: 'context', at: 20_000, context: page('shop', { tags: ['采购'] }) },
    { type: 'heartbeat', at: 35_000 },
  ]);
  assert.equal(activeMs, 35_000);
  assert.equal(segments[0].foregroundMs, 20_000);
  assert.equal(segments[0].endReason, 'navigation');
  assert.deepEqual(segments[0].tags, ['研究']);
  assert.equal(segments[1].pageId, 'shop');
});

test('time away from the browser is never credited to its last active tab', () => {
  const { activeMs, segments } = replay([
    { type: 'context', at: 0, context: page('a') },
    { type: 'context', at: 20_000, context: null },
    { type: 'heartbeat', at: 60_000 },
    { type: 'context', at: 70_000, context: page('a') },
    { type: 'heartbeat', at: 90_000 },
  ]);
  assert.equal(activeMs, 40_000);
  assert.equal(segments[0].endReason, 'focus-lost');
});

test('idle and locked observations stop active duration', () => {
  const { activeMs, segments } = replay([
    { type: 'context', at: 0, context: page('a') },
    { type: 'idle', at: 12_000, idleState: 'idle' },
    { type: 'idle', at: 15_000, idleState: 'locked' },
    { type: 'idle', at: 20_000, idleState: 'active' },
    { type: 'heartbeat', at: 30_000 },
  ]);
  assert.equal(activeMs, 22_000);
  assert.equal(segments.find(segment => segment.status === 'idle').foregroundMs, 0);
  assert.equal(segments.find(segment => segment.status === 'idle').endedAt - BASE, 20_000);
});

test('pause excludes its full interval and resume can refresh the page', () => {
  const { activeMs, state } = replay([
    { type: 'context', at: 0, context: page('a') },
    { type: 'pause', at: 10_000 },
    { type: 'heartbeat', at: 40_000 },
    { type: 'resume', at: 55_000, context: page('b') },
    { type: 'heartbeat', at: 65_000 },
  ]);
  assert.equal(activeMs, 20_000);
  assert.equal(state.tracking, true);
  assert.equal(state.open.pageId, 'b');
});

test('an overnight gap is unknown, not hours of attention on the last page', () => {
  const { activeMs, segments } = replay([
    { type: 'context', at: 0, context: page('a') },
    { type: 'heartbeat', at: 30_000 },
    { type: 'heartbeat', at: 6 * 3_600_000 },
    { type: 'heartbeat', at: 6 * 3_600_000 + 30_000 },
  ]);
  assert.equal(activeMs, 60_000);
  const missing = segments.find(segment => segment.status === 'unknown');
  assert.equal(missing.startedAt, BASE + 30_000);
  assert.equal(missing.endedAt, BASE + 6 * 3_600_000);
  assert.equal(missing.foregroundMs, 0);
});

test('gap threshold is explicit and does not partially credit an unobserved gap', () => {
  assert.equal(replay([
    { type: 'context', at: 0, context: page('a') },
    { type: 'heartbeat', at: 90_000 },
  ]).activeMs, 90_000);
  assert.equal(replay([
    { type: 'context', at: 0, context: page('a') },
    { type: 'heartbeat', at: 90_001 },
  ]).activeMs, 0);
});

test('true browser restart preserves confirmed time and starts a new session', () => {
  const { state, segments, activeMs } = replay([
    { type: 'context', at: 0, context: page('a') },
    { type: 'heartbeat', at: 30_000 },
    { type: 'restart', at: 40_000, context: page('a'), sessionId: 'browser-2' },
    { type: 'heartbeat', at: 50_000 },
  ]);
  assert.equal(activeMs, 40_000);
  assert.equal(state.sessionId, 'browser-2');
  assert.equal(state.open.sessionId, 'browser-2');
  assert.equal(segments.find(segment => segment.status === 'unknown').endReason, 'restart-gap');
});

test('ordinary worker reload can resume a serialized state without a restart gap', () => {
  let state = reduceActivity(createActivityState({ now: BASE }), { type: 'context', at: BASE, context: page('a') }).state;
  state = reduceActivity(state, { type: 'heartbeat', at: BASE + 30_000 }).state;
  state = JSON.parse(JSON.stringify(state));
  const result = reduceActivity(state, { type: 'context', at: BASE + 50_000, context: page('a') });
  assert.equal(result.state.open.foregroundMs, 50_000);
  assert.equal(result.segments.some(segment => segment.status === 'unknown'), false);
});

test('a restart without a fresh observation never reopens the old focused page', () => {
  const { state } = replay([
    { type: 'context', at: 0, context: page('a') },
    { type: 'heartbeat', at: 30_000 },
    { type: 'restart', at: 40_000, sessionId: 'browser-2' },
  ]);
  assert.equal(state.open, null);
  assert.equal(state.context, null);
});

test('a preview does not alter persisted state, even when it detects a gap', () => {
  const { state } = replay([
    { type: 'context', at: 0, context: page('a') },
    { type: 'heartbeat', at: 30_000 },
  ]);
  const before = JSON.stringify(state);
  const records = previewActivity(state, BASE + 600_000);
  assert.equal(JSON.stringify(state), before);
  assert.ok(records.some(segment => segment.status === 'unknown'));
});

test('backward wall clock cannot produce negative duration or double count', () => {
  let state = createActivityState({ now: BASE, sessionId: 's' });
  const records = new Map();
  for (const event of [
    { type: 'context', at: 0, context: page('a') },
    { type: 'heartbeat', at: 60_000 },
    { type: 'context', at: 30_000, context: page('b') },
    { type: 'heartbeat', at: 40_000 },
    { type: 'heartbeat', at: 70_000 },
    { type: 'heartbeat', at: 80_000 },
  ]) {
    const result = reduceActivity(state, { ...event, at: BASE + event.at });
    state = result.state;
    if (event.at === 30_000) {
      assert.equal(state.warning, 'clock-regression');
      assert.equal(state.open, null);
    }
    for (const segment of result.segments) records.set(segment.id, segment);
  }
  assert.equal([...records.values()].reduce((sum, record) => sum + record.foregroundMs, 0), 70_000);
  assert.ok([...records.values()].every(record => record.endedAt >= record.startedAt));
  assert.equal(state.warning, null);
});

test('unsupported URLs, credentials and incognito contexts are excluded', () => {
  for (const context of [page('x', { url: 'chrome://settings' }), page('x', { incognito: true }), page('x', { url: 'https://user:secret@example.com/' })]) {
    const { activeMs, state } = replay([
      { type: 'context', at: 0, context },
      { type: 'heartbeat', at: 30_000 },
    ]);
    assert.equal(activeMs, 0);
    assert.equal(state.context, null);
  }
});

test('two windows still produce only one foreground segment at a time', () => {
  const { segments, activeMs } = replay([
    { type: 'context', at: 0, context: page('a', { windowId: 1 }) },
    { type: 'context', at: 10_000, context: page('b', { windowId: 2 }) },
    { type: 'context', at: 10_000, context: page('c', { windowId: 3 }) },
    { type: 'heartbeat', at: 30_000 },
  ]);
  assert.equal(activeMs, 30_000);
  const positive = segments.filter(segment => segment.foregroundMs > 0);
  assert.equal(positive.length, 2);
  assert.ok(positive[0].endedAt <= positive[1].startedAt);
});

test('input context and historic tag arrays are never shared mutably', () => {
  const context = page('a', { tags: ['原标签'] });
  const base = createActivityState({ now: BASE });
  const before = JSON.stringify(base);
  const result = reduceActivity(base, { type: 'context', at: BASE, context });
  context.tags[0] = '外部改写';
  result.segments[0].tags[0] = '输出改写';
  assert.deepEqual(result.state.open.tags, ['原标签']);
  assert.deepEqual(result.state.context.tags, ['原标签']);
  assert.equal(JSON.stringify(base), before);
});

test('invalid observations fail without mutating the previous ledger', () => {
  const state = createActivityState({ now: BASE });
  assert.throws(() => reduceActivity(state, { type: 'arbitrary', at: BASE }), TypeError);
  assert.throws(() => reduceActivity(state, { type: 'heartbeat', at: NaN }), TypeError);
  assert.throws(() => reduceActivity(state, { type: 'idle', at: BASE, idleState: 'thinking' }), TypeError);
  assert.equal(state.open, null);
});
