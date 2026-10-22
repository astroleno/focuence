import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAnalytics, localDayStart } from '../src/analytics.js';

const BASE = 1_700_000_000_000;
const visit = (id, tag, start, end, extra = {}) => ({
  id,
  pageId: `p-${tag}`,
  url: `https://example.com/${tag}`,
  title: `Page ${tag}`,
  tags: [tag],
  sessionId: 'browser-1',
  taskId: null,
  startedAt: BASE + start,
  endedAt: BASE + end,
  foregroundMs: end - start,
  status: 'active',
  endReason: 'tab-switch',
  ...extra,
});
const summarize = (segments, extra = {}) => computeAnalytics({ segments, now: BASE + 60_000, dayStart: BASE, ...extra });

test('empty state has no generated observations or recommendations', () => {
  const result = summarize([]);
  assert.equal(result.stats.todayForegroundMs, 0);
  assert.equal(result.stats.todayPages, 0);
  assert.equal(result.stats.todaySwitches, 0);
  assert.deepEqual(result.transitions, []);
  assert.deepEqual(result.suggestions, []);
});

test('preview and persisted copies of a visit are counted once', () => {
  const result = summarize([visit('same', 'A', 0, 10_000), visit('same', 'A', 0, 20_000)]);
  assert.equal(result.stats.todayForegroundMs, 20_000);
  assert.equal(result.stats.todayPages, 1);
  assert.equal(result.stats.tags[0].visits, 1);
});

test('idle and unknown observations break the transition chain', () => {
  for (const status of ['idle', 'unknown']) {
    const result = summarize([
      visit('a', 'A', 0, 10_000),
      visit('gap', 'A', 10_000, 20_000, { status, foregroundMs: 0 }),
      visit('b', 'B', 20_000, 30_000),
    ]);
    assert.equal(result.stats.todayForegroundMs, 20_000);
    assert.deepEqual(result.transitions, []);
    assert.equal(result.stats.todaySwitches, 0);
  }
});

test('leaving the browser is a barrier even without an idle segment', () => {
  const result = summarize([
    visit('a', 'A', 0, 10_000, { endReason: 'focus-lost' }),
    visit('b', 'B', 20_000, 30_000),
  ]);
  assert.deepEqual(result.transitions, []);
});

test('same-topic page changes count as page switches but not tag transitions', () => {
  const result = summarize([
    visit('a', 'A', 0, 10_000),
    visit('b', 'A', 10_000, 20_000, { pageId: 'another-a', url: 'https://example.com/another-a' }),
  ]);
  assert.equal(result.stats.todaySwitches, 1);
  assert.deepEqual(result.transitions, []);
});

test('same-topic page changes remain in the probability denominator', () => {
  const result = summarize([
    visit('a', 'A', 0, 10_000),
    visit('a2', 'A', 10_000, 20_000, { pageId: 'a-2', url: 'https://example.com/a-2' }),
    visit('b', 'B', 20_000, 30_000),
  ]);
  assert.equal(result.transitions[0].count, 1);
  assert.equal(result.transitions[0].sourceTotal, 2);
  assert.equal(result.transitions[0].probability, 0.5);
});

test('today clips a cross-midnight visit and splits multi-tag time without inflating totals', () => {
  const result = summarize([
    visit('a', 'A', 0, 15_000, { tags: ['A', 'B'] }),
  ], { dayStart: BASE + 10_000 });
  assert.equal(result.stats.todayForegroundMs, 5_000);
  assert.equal(result.stats.tags.reduce((sum, item) => sum + item.foregroundMs, 0), 5_000);
  assert.equal(result.stats.tags[0].foregroundMs, 2_500);
});

test('defensive active-time union cannot inflate corrupt overlapping visits', () => {
  const result = summarize([
    visit('a', 'A', 0, 20_000),
    visit('b', 'B', 10_000, 30_000),
  ]);
  assert.equal(result.stats.todayForegroundMs, 30_000);
  assert.deepEqual(result.transitions, []);
});

test('repetition in one session never masquerades as independent prediction support', () => {
  const segments = [
    visit('a1', 'A', 0, 5_000), visit('b1', 'B', 5_000, 10_000),
    visit('a2', 'A', 10_000, 15_000), visit('b2', 'B', 15_000, 20_000),
    visit('a3', 'A', 20_000, 25_000), visit('b3', 'B', 25_000, 30_000),
    visit('current', 'A', 30_000, 40_000, { endReason: 'checkpoint' }),
  ];
  const result = summarize(segments, { now: BASE + 40_000 });
  const edge = result.transitions.find(item => item.from === 'A' && item.to === 'B');
  assert.equal(edge.count, 3);
  assert.equal(edge.sessions, 1);
  assert.ok(result.suggestions.every(item => item.method !== 'transition'));
  assert.equal(result.suggestions[0].method, 'recent');
  assert.equal(result.suggestions[0].confidence, null);
});

test('three separated work sessions can support an explainable next-topic suggestion', () => {
  const segments = [];
  for (let session = 0; session < 3; session += 1) {
    const offset = session * 1_000_000;
    segments.push(visit(`a${session}`, 'A', offset, offset + 10_000));
    segments.push(visit(`b${session}`, 'B', offset + 10_000, offset + 20_000));
  }
  segments.push(visit('current', 'A', 2_030_000, 2_040_000, { endReason: 'checkpoint' }));
  const result = summarize(segments, { now: BASE + 2_040_000 });
  const edge = result.transitions.find(item => item.from === 'A' && item.to === 'B');
  assert.equal(edge.sessions, 3);
  assert.equal(result.suggestions[0].method, 'transition');
  assert.equal(result.suggestions[0].support, 3);
  assert.equal(result.suggestions[0].sessions, 3);
  assert.ok(result.suggestions[0].confidence < 1);
  assert.match(result.suggestions[0].reason, /独立工作时段/);
});

test('explicitly absent current context disables predictive wording', () => {
  const segments = [];
  for (let session = 0; session < 3; session += 1) {
    const offset = session * 1_000_000;
    segments.push(visit(`a${session}`, 'A', offset, offset + 10_000));
    segments.push(visit(`b${session}`, 'B', offset + 10_000, offset + 20_000));
  }
  const result = summarize(segments, { now: BASE + 2_020_000, currentContext: null });
  assert.ok(result.suggestions.every(item => item.method !== 'transition'));
});

test('a tab metadata scan is not evidence that a page was visited', () => {
  const result = summarize([], {
    pages: [{ id: 'p-a', url: 'https://example.com/a', title: 'Open but unread', tags: ['A'], lastSeen: BASE + 60_000 }],
  });
  assert.equal(result.stats.todayPages, 0);
  assert.deepEqual(result.suggestions, []);
});

test('saved task resources remain useful before there is enough browsing history', () => {
  const result = summarize([], {
    tasks: [{ id: 'task-1', name: '音频调研', pages: [{ pageId: 'p-a', url: 'https://example.com/a', title: 'Audio', tags: ['音频'] }] }],
  });
  assert.equal(result.stats.totalTasks, 1);
  assert.equal(result.suggestions[0].method, 'task');
  assert.equal(result.suggestions[0].confidence, null);
  assert.match(result.suggestions[0].reason, /音频调研/);
});

test('localDayStart follows the local calendar rather than UTC slicing', () => {
  const date = new Date(2026, 9, 22, 15, 45, 0);
  const start = new Date(localDayStart(date.getTime()));
  assert.equal(start.getDate(), 22);
  assert.equal(start.getHours(), 0);
  assert.equal(start.getMinutes(), 0);
});
