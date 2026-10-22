import test from 'node:test';
import assert from 'node:assert/strict';
import {uniqueTaskPages} from '../src/tasks.js';
import {notePreview} from '../src/task-notes.js';
import {mapTopology, localNeighborhood, resolveMapContext} from '../src/map-layout.js';
import {workspaceURL, openWorkspace} from '../src/navigation.js';

test('save candidates count page identities without collapsing queries or SPA routes', () => {
  const pages = [
    {id: 1, url: 'https://example.org/a?utm_source=x'},
    {id: 2, url: 'https://example.org/a#heading'},
    {id: 3, url: 'https://example.org/search?q=a'},
    {id: 4, url: 'https://example.org/search?q=b'},
    {id: 5, url: 'https://example.org/app#/one'},
    {id: 6, url: 'https://example.org/app#/two'},
    {id: 7, url: 'chrome://newtab'},
  ];
  const candidates = uniqueTaskPages(pages);
  assert.deepEqual(candidates.map(page => page.id), [1, 3, 4, 5, 6]);
  assert.equal(candidates[0].url, 'https://example.org/a');
  assert.equal(pages[0].url, 'https://example.org/a?utm_source=x');
});

test('long note display keeps the full source and respects multiline summaries', () => {
  const full = '第一步：确认接线\n第二步：检查时序\n第三步：记录结果\n第四步：整理资料';
  const note = notePreview(full);
  assert.equal(note.text, full);
  assert.equal(note.summary, '第一步：确认接线\n第二步：检查时序\n第三步：记录结果…');
  assert.equal(note.hasMore, true);
  assert.equal(notePreview('下一步\n继续接线').hasMore, false);
  assert.equal(notePreview('下一步\r\n继续接线').hasMore, false);
  assert.equal(notePreview(' ').text, '');
  assert.equal(notePreview('研'.repeat(3000)).summary, '研'.repeat(60) + '…');
});

test('note summaries do not split a family emoji or combining character', () => {
  const emoji = '👨‍👩‍👧‍👦', combined = 'e\u0301';
  assert.equal(notePreview(emoji.repeat(61)).summary, emoji.repeat(60) + '…');
  assert.equal(notePreview(combined.repeat(61)).summary, combined.repeat(60) + '…');
});

test('light map reports hidden relationships per direction including a selected low-count edge', () => {
  for (const [incoming, outgoing] of [[3, 0], [0, 3], [3, 1], [2, 2], [3, 3]]) {
    const edges = [
      ...Array.from({length: incoming}, (_, index) => ({from: '入' + index, to: 'A', count: index + 1})),
      ...Array.from({length: outgoing}, (_, index) => ({from: 'A', to: '出' + index, count: index + 1})),
    ];
    const topology = mapTopology([{tag: 'A'}], edges);
    const local = localNeighborhood(topology, 'A', outgoing ? 'A\u0000出0' : '入0\u0000A');
    assert.equal(local.hiddenCount, Math.max(0, incoming - 2) + Math.max(0, outgoing - 2));
    assert.equal(local.before.length + local.after.length + local.hiddenCount, edges.length);
    assert([...local.before, ...local.after].some(edge => edge.count === 1));
  }
});

test('map handoff retains a selected incoming relation and explains expired objects', () => {
  const entries = [{tag: '默认'}, {tag: '视觉创作'}, {tag: '本地模型'}, {tag: '孤立'}];
  const edges = [{from: '本地模型', to: '视觉创作', count: 1}];
  assert.deepEqual(resolveMapContext(entries, edges, '视觉创作', '本地模型\u0000视觉创作'), {topic: '视觉创作', relation: '本地模型\u0000视觉创作', invalidTopic: false, invalidRelation: false});
  assert.equal(resolveMapContext(entries, edges, '孤立').topic, '孤立');
  assert.equal(resolveMapContext(entries, edges, '过期主题').invalidTopic, true);
  assert.equal(resolveMapContext(entries, edges, '视觉创作', '本地模型\u0000过期主题').invalidRelation, true);
  assert.equal(resolveMapContext([], [], '过期主题').topic, '');
});

test('workspace URL encodes the exact theme, relation, window and range together', () => {
  const target = workspaceURL('chrome-extension://fixture/app/index.html', {view: 'map', windowId: 7, range: 'yesterday', topic: '视觉 / 光 & 色', from: '本地+模型', to: '视觉 / 光 & 色'});
  const url = new URL(target);
  assert.equal(url.searchParams.get('topic'), '视觉 / 光 & 色');
  assert.equal(url.searchParams.get('from'), '本地+模型');
  assert.equal(url.searchParams.get('to'), '视觉 / 光 & 色');
  assert.equal(url.searchParams.get('range'), 'yesterday');
  assert.equal(url.searchParams.get('windowId'), '7');
  assert.equal(url.hash, '#map');
});

test('native handoff reuses an existing workspace tab with its new map context', async () => {
  const previous = globalThis.chrome, updates = [], created = [];
  globalThis.chrome = {
    runtime: {getURL: path => 'chrome-extension://fixture/' + path},
    tabs: {
      query: async query => { assert.deepEqual(query, {windowId: 7}); return [{id: 20, windowId: 7, url: 'chrome-extension://fixture/app/index.html#review'}]; },
      update: async (id, value) => updates.push({id, ...value}),
      create: async value => created.push(value),
    },
    windows: {update: async (id, value) => { assert.equal(id, 7); assert.equal(value.focused, true); }},
  };
  try {
    await openWorkspace({view: 'map', windowId: 7, range: 'week', topic: 'A', from: 'B', to: 'A'});
    assert.equal(updates.length, 1);
    assert.equal(updates[0].id, 20);
    assert.equal(new URL(updates[0].url).searchParams.get('to'), 'A');
    assert.equal(created.length, 0);
  } finally { if (previous === undefined) delete globalThis.chrome; else globalThis.chrome = previous; }
});
