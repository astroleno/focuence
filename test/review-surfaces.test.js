import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { calendarRange, computeReview } from '../src/analytics.js';
import { planTaskRestore, taskViews } from '../src/tasks.js';
import { projectIdentity } from '../src/text.js';
import { proposeGroups } from '../src/grouping.js';

const now = new Date(2026, 9, 22, 18).getTime();
const today = new Date(2026, 9, 22).getTime();
const visit = (id, start, duration, tags = ['A'], extra = {}) => ({
  id: String(id), pageId: String(id), url: `https://example.org/${id}`, tags,
  startedAt: start, endedAt: start + duration, foregroundMs: duration,
  status: 'active', endReason: 'tab-switch', ...extra,
});

test('calendar ranges use local midnight and seven calendar dates', () => {
  assert.equal(calendarRange('today', now).startedAt, today);
  assert.equal(calendarRange('yesterday', now).endedAt, today);
  assert.equal(new Date(calendarRange('week', now).startedAt).getDate(), 16);
  assert.equal(calendarRange('invalid', now).key, 'week');
});

test('yesterday remains one calendar day when daylight saving time changes', () => {
  const source = `import {calendarRange} from './src/analytics.js'; const x=calendarRange('yesterday',new Date(2026,2,9,12).getTime()); console.log(x.endedAt-x.startedAt);`;
  const duration = Number(execFileSync(process.execPath, ['--input-type=module', '-e', source], { cwd: new URL('..', import.meta.url), env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf8' }));
  assert.equal(duration, 23 * 3600000);
});

test('node totals and transitions include records beyond the 2000-row list limit', () => {
  const records = Array.from({ length: 2205 }, (_, index) => visit(index, today + index * 1000, 1000, [index % 2 ? 'B' : 'A']));
  const result = computeReview({ segments: records, range: 'today', now });
  assert.equal(result.segments.slice(-2000).length, 2000);
  assert.equal(result.summary.foregroundMs, 2205000);
  assert.equal(result.nodes.reduce((sum, node) => sum + node.foregroundMs, 0), 2205000);
  assert.equal(result.transitions.reduce((sum, edge) => sum + edge.count, 0), 2204);
});

test('range clipping and multi-tag allocation conserve time across midnight', () => {
  const result = computeReview({ segments: [visit('x', today - 60000, 120000, ['A', 'B'])], range: 'today', now });
  assert.equal(result.summary.foregroundMs, 60000);
  assert.deepEqual(result.nodes.map(node => node.foregroundMs), [30000, 30000]);
  assert.equal(result.segments[0].startedAt, today);
});

test('weekly review has explicit empty days and never treats idle as a path', () => {
  const records = [visit('a', today, 1000), visit('idle', today + 1000, 1000, [], { status: 'idle', foregroundMs: 0 }), visit('b', today + 2000, 1000, ['B'])];
  const result = computeReview({ segments: records, range: 'week', now });
  assert.equal(result.daily.length, 7);
  assert.equal(result.summary.activeDays, 1);
  assert.equal(result.summary.foregroundMs, 2000);
  assert.equal(result.summary.idleMs, 1000);
  assert.equal(result.transitions.length, 0);
});

test('a task restore deduplicates normalized URLs and excludes unsupported URLs', () => {
  const task = { pages: [{ pageId: 'a', url: 'https://example.org/a?utm_source=x' }, { pageId: 'a2', url: 'https://example.org/a' }, { pageId: 'b', url: 'https://example.org/b' }, { url: 'file:///private' }] };
  const plan = planTaskRestore(task, [{ id: 1, url: 'https://example.org/a' }]);
  assert.equal(plan.total, 2);
  assert.equal(plan.reused, 1);
  assert.equal(plan.willOpen, 1);
  assert.equal(plan.missing[0].pageId, 'b');
});

test('restore resumes a live task page, then the latest visit, then a remembered page', () => {
  const task = { pages: [{ pageId: 'a', url: 'https://example.org/a' }, { pageId: 'b', url: 'https://example.org/b' }], lastActivePageId: 'b' };
  const records = [visit('a', today, 1000), visit('b', today + 1000, 1000)];
  assert.equal(planTaskRestore(task, [{ url: 'https://example.org/a', active: true }], records).resumePage.pageId, 'a');
  assert.equal(planTaskRestore(task, [], records).resumePage.pageId, 'b');
  assert.equal(planTaskRestore(task).resumePage.pageId, 'b');
});

test('recent tasks are ranked by actual continuation as well as edits', () => {
  const tasks = [{ id: 'old', updatedAt: 1, lastRestoredAt: 100, pages: [] }, { id: 'new', updatedAt: 20, pages: [] }];
  assert.deepEqual(taskViews(tasks).map(task => task.id), ['old', 'new']);
});

test('an interrupted restore remains the most recent task until it is retried', () => {
  const tasks = [{ id: 'interrupted', updatedAt: 1, pages: [], lastRestoreResult: { at: 200, failedCount: 1 } }, { id: 'edited', updatedAt: 100, pages: [] }];
  assert.deepEqual(taskViews(tasks).map(task => task.id), ['interrupted', 'edited']);
});

test('GitLab nested project roots match their issue pages and separate repositories', () => {
  const root = 'https://gitlab.com/team/subgroup/project-a';
  assert.equal(projectIdentity(root).key, projectIdentity(root + '/-/issues').key);
  assert.notEqual(projectIdentity(root).key, projectIdentity('https://gitlab.com/team/subgroup/project-b').key);
  const tabs = [root, root + '/-/issues', 'https://gitlab.com/team/subgroup/project-b'].map((url, index) => ({ id: index + 1, url, title: 'ESP32 sensor', windowId: 1, groupId: -1, pinned: false }));
  assert.deepEqual(proposeGroups(tabs, { now }).map(group => group.tabIds), [[1, 2]]);
});
