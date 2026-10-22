import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeGroups, cosineSimilarity } from '../src/grouping.js';
import { normalizeUrl, pageIdForUrl, pageFromTab, cleanTitle, embeddingText } from '../src/text.js';

const tab = (id, title, url, patch = {}) => ({ id, title, url, windowId: 1, groupId: -1, pinned: false, ...patch });
const vectorsFor = (tabs, vectors) => new Map(tabs.map((item, index) => [pageIdForUrl(item.url), vectors[index]]));

test('page identity ignores marketing/auth credentials and parameter ordering but retains search intent', () => {
  const first = 'https://alice:secret@example.org/search?q=espresso&lang=zh&utm_source=mail&access_token=private#ingredients';
  const clean = 'https://example.org/search?lang=zh&q=espresso';
  assert.equal(normalizeUrl(first), clean);
  assert.equal(pageIdForUrl(first), pageIdForUrl(clean));
  assert.notEqual(pageIdForUrl(clean), pageIdForUrl('https://example.org/search?lang=zh&q=tea'));
  assert.equal(normalizeUrl('javascript:alert(1)'), null);
  assert.equal(normalizeUrl('chrome://history/'), null);
  assert.equal(normalizeUrl('file:///private/notes'), null);
});

test('SPA hash route identifies distinct pages without persisting auth parameters', () => {
  assert.equal(normalizeUrl('https://app.example/#/tasks/3?token=secret&utm_medium=email&view=list'), 'https://app.example/#/tasks/3?view=list');
  assert.notEqual(pageIdForUrl('https://app.example/#/tasks/3'), pageIdForUrl('https://app.example/#/tasks/4'));
  assert.equal(pageIdForUrl('https://docs.example/a#section1'), pageIdForUrl('https://docs.example/a#section2'));
});

test('content helpers clean titles and do not create incognito pages', () => {
  const page = pageFromTab(tab(1, '(12) 传感器\u0000   电路设计 - GitHub', 'https://github.com/user/sensor?token=hidden'), 1234);
  assert.equal(page.title, '传感器 电路设计');
  assert.equal(page.lastSeen, 1234);
  assert.ok(page.tags.includes('硬件'));
  assert.ok(!embeddingText(page).includes('hidden'));
  assert.equal(pageFromTab(tab(2, 'private', 'https://example.org', { incognito: true })), null);
  assert.equal(cleanTitle('', 'https://example.org'), 'example.org');
});

test('pinned tabs and pre-existing browser groups are protected even with identical text/vectors', () => {
  const tabs = [
    tab(1, 'ESP32 温度传感器', 'https://docs.example/esp32'),
    tab(2, 'ESP32 实现', 'https://blog.example/esp32'),
    tab(3, 'ESP32 电路', 'https://example.net/a', { pinned: true }),
    tab(4, 'ESP32 电源', 'https://example.net/b', { groupId: 9 }),
  ];
  const result = proposeGroups(tabs, { semantic: true, embeddings: vectorsFor(tabs, tabs.map(() => [1, 0, 0])), now: 0 });
  assert.deepEqual(result.map(group => group.tabIds), [[1, 2]]);
});

test('same-domain pages do not become an automatic megagroup and unrelated singletons stay out', () => {
  const tabs = [
    tab(1, '夏日植物观察', 'https://example.com/plants'),
    tab(2, '锂电池保护板', 'https://example.com/battery'),
    tab(3, '博物馆藏品目录', 'https://example.com/museum'),
  ];
  assert.deepEqual(proposeGroups(tabs, { now: 0 }), []);
});

test('two repositories retain project boundaries even when their topic and vectors are identical', () => {
  const tabs = [
    tab(1, 'ESP32 project docs', 'https://github.com/team/project-a'),
    tab(2, 'ESP32 project issues', 'https://github.com/team/project-a/issues'),
    tab(3, 'ESP32 project docs', 'https://github.com/team/project-b'),
    tab(4, 'ESP32 project issues', 'https://github.com/team/project-b/issues'),
  ];
  const result = proposeGroups(tabs, { semantic: true, embeddings: vectorsFor(tabs, tabs.map(() => [1, 0])), now: 0 });
  assert.equal(result.length, 2);
  assert.deepEqual(result.map(group => group.tabIds).sort((a, b) => a[0] - b[0]), [[1, 2], [3, 4]]);
});

test('semantic mode uses real supplied vectors across domains and reports missing vectors as rules', () => {
  const tabs = [
    tab(1, '茶叶香气的变化', 'https://one.example/a'),
    tab(2, '品饮实验笔记', 'https://two.example/b'),
    tab(3, '无线电设备', 'https://three.example/c'),
  ];
  assert.deepEqual(proposeGroups(tabs, { semantic: true, now: 0 }), []);
  const result = proposeGroups(tabs, { semantic: true, embeddings: vectorsFor(tabs, [[1, 0], [.99, .05], [0, 1]]), now: 0 });
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].tabIds, [1, 2]);
  assert.equal(result[0].method, 'semantic');
});

test('semantic bridging cannot join dissimilar endpoints through a third page', () => {
  const tabs = [tab(1, '早晨观察', 'https://a.example'), tab(2, '午间记录', 'https://b.example'), tab(3, '晚间发现', 'https://c.example')];
  const result = proposeGroups(tabs, { semantic: true, threshold: .7, embeddings: vectorsFor(tabs, [[1, 0], [Math.SQRT1_2, Math.SQRT1_2], [0, 1]]), now: 0 });
  assert.ok(result.every(group => group.tabIds.length <= 2));
});

test('results are independent of input order and never combine browser windows', () => {
  const tabs = [tab(1, 'Blender 材质', 'https://a.example/1'), tab(2, 'Blender 灯光', 'https://a.example/2'), tab(3, 'Blender 光影', 'https://a.example/3', { windowId: 2 })];
  const a = proposeGroups(tabs, { now: 42 });
  const b = proposeGroups([...tabs].reverse(), { now: 42 });
  assert.deepEqual(a, b);
  assert.deepEqual(a.map(group => group.tabIds), [[1, 2]]);
});

test('incremental proposals preserve an existing group id/name when a matching page is added', () => {
  const initial = [tab(1, 'ESP32 传感器', 'https://a.example/1'), tab(2, 'ESP32 接线', 'https://b.example/2')];
  const previous = proposeGroups(initial, { now: 0 });
  previous[0].name = '硬件原型资料';
  const next = proposeGroups([...initial, tab(3, 'ESP32 串口', 'https://c.example/3')], { previousGroups: previous, now: 0 });
  assert.equal(next[0].id, previous[0].id);
  assert.equal(next[0].name, '硬件原型资料');
  assert.deepEqual(next[0].tabIds, [1, 2, 3]);
});

test('invalid and zero vectors are not classified as semantic evidence', () => {
  assert.equal(cosineSimilarity([0, 0], [1, 2]), null);
  assert.equal(cosineSimilarity([NaN, 1], [1, 2]), null);
  assert.equal(cosineSimilarity([1], [1, 2]), null);
  assert.equal(cosineSimilarity([1, 0], [-1, 0]), -1);
});
