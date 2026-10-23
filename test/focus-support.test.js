import test from 'node:test';
import assert from 'node:assert/strict';
import {returnPrompt, recordPromptShown, dismissPrompt, SUPPORT_LIMITS} from '../src/focus-support.js';

const now = new Date(2026, 9, 23, 12).getTime();
const current = {taskId: 'goal', revision: 1, startedAt: now - 600000};
const context = {windowId: 1, intendedTaskId: 'goal', pageId: 'b', url: 'https://example.com/b', title: 'B'};
const segment = (id, start, end, extra = {}) => ({id, sessionId: 'session', windowId: 1, pageId: id, url: 'https://example.com/' + id, title: id,
  intendedTaskId: 'goal', taskId: 'other', startedAt: now + start, endedAt: now + end, foregroundMs: end - start,
  status: 'active', endReason: 'tab-switch', ...extra});
const segments = [segment('a', -360000, -180000), segment('b', -180000, 0)];
const base = {segments, current, context, enabled: true, tracking: true, support: {}, now};

test('return support is opt-in and requires two known pages for five minutes', () => {
  assert.equal(returnPrompt({...base, enabled: false}), null);
  assert.equal(returnPrompt({...base, segments: [segment('b', -360000, 0)]}), null);
  assert.equal(returnPrompt({...base, segments: [segment('a', -361000, -360000), segment('b', -360000, 0)]}), null);
  assert.equal(returnPrompt({...base, segments: [segment('a', -180000, -90000), segment('b', -90000, 0)]}), null);
  const result = returnPrompt(base);
  assert.equal(result.durationMs, 360000); assert.equal(result.pages, 2);
});
test('unknown, idle, paused, missing foreground and wrong window block prompts', () => {
  for (const patch of [{taskId: null}, {status: 'idle'}, {endReason: 'clock-gap'}, {endReason: 'focus-lost'}, {endReason: 'paused'}, {foregroundMs: 0}, {windowId: 2}]) {
    assert.equal(returnPrompt({...base, segments: [segments[0], {...segments[1], ...patch}]}), null, JSON.stringify(patch));
  }
  assert.equal(returnPrompt({...base, tracking: false}), null);
  assert.equal(returnPrompt({...base, current: {...current, startedAt: now - 100000}}), null);
});
test('explicit unrelated judgement counts while an unclassified page does not', () => {
  const known = segments.map(item => ({...item, taskId: null, excludedFromIntent: true}));
  assert(returnPrompt({...base, segments: known}));
  assert.equal(returnPrompt({...base, segments: known.map(item => ({...item, excludedFromIntent: false}))}), null);
});
test('display acknowledgement is idempotent; cooldown and daily maximum survive refresh', () => {
  const prompt = returnPrompt(base);
  const support = recordPromptShown({}, prompt, now);
  assert.equal(recordPromptShown(support, prompt, now + 1000).shown.length, 1);
  assert.equal(returnPrompt({...base, support}).id, prompt.id);
  assert.equal(returnPrompt({...base, support: dismissPrompt(support, prompt, 'dismiss')}), null);
  const capped = {shown: [1, 2, 3].map(index => ({id: '' + index, at: now - index * SUPPORT_LIMITS.cooldownMs - 1, dismissed: true}))};
  assert.equal(returnPrompt({...base, support: capped}), null);
});
test('snooze belongs to the current intent, not a later browser session reusing its revision', () => {
  const prompt = returnPrompt(base), support = dismissPrompt(recordPromptShown({}, prompt, now), prompt, 'snooze');
  assert.equal(returnPrompt({...base, support}), null);
  const clean = {...support, shown: []};
  assert(returnPrompt({...base, support: clean, current: {...current, startedAt: current.startedAt + 1}}));
});
test('a later prompt starts a new cooldown and is counted once after the first is dismissed', () => {
  const first = returnPrompt(base), support = dismissPrompt(recordPromptShown({}, first, now), first, 'dismiss');
  const later = now + SUPPORT_LIMITS.cooldownMs + 1000;
  const continuing = [segments[0], {...segments[1], endedAt: later, foregroundMs: later - segments[1].startedAt}];
  const second = returnPrompt({...base, now: later, segments: continuing, support});
  assert(second); assert.notEqual(second.id, first.id);
  const shown = recordPromptShown(support, second, later); assert.equal(shown.shown.length, 2);
  assert.equal(returnPrompt({...base, now: later, segments: continuing, support: dismissPrompt(shown, second, 'dismiss')}), null);
});
