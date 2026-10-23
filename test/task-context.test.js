import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTaskContext, normalizeWorkContext, windowContext, changeWindowContext, assertRevision, taskText } from '../src/task-context.js';
import { createActivityState, reduceActivity } from '../src/activity.js';

const tasks = [{ id: 'A', revision: 2, pages: [{pageId: 'p'}] }, { id: 'B', revision: 1, pages: [{pageId: 'p'}, {pageId: 'q'}] }];

test('shared pages need explicit current intent, never array order', () => {
  assert.equal(resolveTaskContext('p', null, tasks).taskId, null);
  assert.equal(resolveTaskContext('p', null, [...tasks].reverse()).taskId, null);
  assert.equal(resolveTaskContext('p', 'B', tasks).taskId, 'B');
  assert.equal(resolveTaskContext('p', 'A', tasks).taskId, 'A');
});

test('actual task and intended task remain distinct and exclusions override membership', () => {
  assert.deepEqual(resolveTaskContext('q', 'A', tasks), {taskId: 'B', intendedTaskId: 'A', assignmentSource: 'saved', excludedFromIntent: false});
  const relations = [{taskId: 'A', pageId: 'p', decision: 'unrelated'}];
  const value = resolveTaskContext('p', 'A', tasks, relations);
  assert.equal(value.taskId, 'B'); assert.equal(value.excludedFromIntent, true);
  assert.equal(resolveTaskContext('unknown', 'A', tasks).taskId, null);
  assert.equal(resolveTaskContext('p', 'gone', tasks).intendedTaskId, null);
});

test('window intent is isolated and true restart discards bindings', () => {
  const empty = normalizeWorkContext(null, 'session');
  const first = changeWindowContext(empty, 1, 'A', 0, 10);
  const second = changeWindowContext(first, 2, 'B', 0, 20);
  assert.equal(windowContext(second, 1).taskId, 'A');
  assert.equal(windowContext(second, 2).taskId, 'B');
  assert.equal(windowContext(normalizeWorkContext(second, 'session'), 1).taskId, 'A');
  assert.equal(windowContext(normalizeWorkContext(second, 'new-session'), 1).taskId, null);
  assert.throws(() => changeWindowContext(second, 1, 'B', 0, 30), {code:'STALE_CONTEXT'});
  assert.equal(windowContext(empty, 1).revision, 0);
});

test('task revision and text limits reject stale or oversized input', () => {
  assert.throws(() => assertRevision(tasks[0], 1), {code:'STALE_TASK'});
  assert.throws(() => assertRevision(tasks[0], undefined), {code:'STALE_TASK'});
  assert.throws(() => taskText(' ', 'name', {required:true}), {code:'INVALID_TASK'});
  assert.throws(() => taskText('中'.repeat(1001), 'goal'), {code:'INVALID_TASK'});
  assert.equal(taskText('🙂'.repeat(80), 'name').length, 160);
});

test('changing intent on the same page closes its old observation without rewriting it', () => {
  const base = 1700000000000;
  const page = {pageId:'p', url:'https://example.test/p', title:'Shared', taskId:'A', intendedTaskId:'A', assignmentSource:'saved', windowId:1, tabId:2};
  const first = reduceActivity(createActivityState({now:base,sessionId:'s'}), {type:'context',at:base,context:page});
  const next = reduceActivity(first.state, {type:'context',at:base+10000,context:{...page,taskId:'B',intendedTaskId:'B'}});
  assert.equal(next.segments[0].taskId, 'A'); assert.equal(next.segments[0].foregroundMs, 10000);
  assert.equal(next.state.open.taskId, 'B'); assert.equal(next.state.open.intendedTaskId, 'B');
  assert.equal(next.segments[0].endReason, 'task-change');
});
