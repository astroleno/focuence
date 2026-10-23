import test from 'node:test';
import assert from 'node:assert/strict';
import {taskPatterns} from '../src/task-patterns.js';
const tasks = [{id: 'a'}, {id: 'b'}], base = 1700000000000;
function episode(offset, session = 'one') {
  return ['a', 'b', 'a'].map((taskId, index) => ({id: session + ':' + offset + ':' + index, sessionId: session, taskId, pageId: taskId,
    url: 'https://example.com/' + taskId, title: taskId, status: 'active', foregroundMs: 60000,
    startedAt: base + offset + index * 60000, endedAt: base + offset + (index + 1) * 60000, endReason: 'tab-switch'}));
}
test('same task page changes are separate from cross-task transitions', () => {
  const a = episode(0)[0];
  const result = taskPatterns([a, {...a, id: 'next', pageId: 'a2', startedAt: a.endedAt, endedAt: a.endedAt + 60000}], tasks, [], base + 300000);
  assert.equal(result.sameTaskSwitches, 1); assert.equal(result.taskSwitches, 0); assert.equal(result.repeatedReturns.length, 0);
});
test('a pattern requires three independent episodes and exposes real evidence', () => {
  const rows = [...episode(0), ...episode(2000000), ...episode(4000000)];
  const result = taskPatterns(rows, tasks, [], base + 5000000);
  assert.equal(result.repeatedReturns.length, 1);
  assert.equal(result.repeatedReturns[0].sessions, 3);
  assert.equal(result.repeatedReturns[0].evidenceTotal, 3);
  assert.equal(result.repeatedReturns[0].meanIntervalMs, 60000);
  assert.equal(taskPatterns(rows.slice(0, 6), tasks, [], base + 5000000).repeatedReturns.length, 0);
});
test('unknown and browser restart boundaries never create a synthetic return', () => {
  const rows = episode(0); rows[1].taskId = null;
  assert.equal(taskPatterns(rows, tasks, [], base + 5000000).observedReturns, 0);
  const restart = episode(0); restart[2].sessionId = 'new-browser';
  assert.equal(taskPatterns(restart, tasks, [], base + 5000000).observedReturns, 0);
});
test('repeated retrieval requires separate days and empty history has no patterns', () => {
  const events = [0, 1, 2].map(index => ({kind: 'search-open', id: '' + index, pageId: 'p', title: 'Reference', at: base + index * 86400000}));
  assert.equal(taskPatterns([], tasks, events, base + 3 * 86400000).repeatedFinds[0].count, 3);
  assert.equal(taskPatterns([], tasks, events.map(event => ({...event, at: base})), base + 1000).repeatedFinds.length, 0);
  assert.equal(taskPatterns([], tasks, [], base).repeatedReturns.length, 0);
});
