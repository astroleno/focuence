import test from 'node:test';
import assert from 'node:assert/strict';
import {mapTopology, localNeighborhood} from '../src/map-layout.js';

test('map retains cycles, all 20 themes and isolated themes without shortening labels', () => {
  const nodes = Array.from({length: 20}, (_, i) => ({tag: i === 0 ? 'Blender 材质、光照与渲染研究' : '主题 ' + i, foregroundMs: i * 1000}));
  const edges = nodes.slice(0, 18).map((node, i) => ({from: node.tag, to: nodes[(i + 1) % 18].tag, count: i + 1}));
  const model = mapTopology(nodes, edges);
  const represented = new Set([...model.sources, ...model.targets, ...model.isolated].map(node => node.tag));
  assert.deepEqual(represented, new Set(nodes.map(node => node.tag)));
  assert.equal(model.edges.length, 18);
  assert.equal(model.isolated.length, 2);
  assert.equal(model.sources[0].tag, nodes[17].tag);
  assert.equal(model.targets[0].tag, nodes[0].tag);
  assert.equal(model.sources.find(node => node.tag.startsWith('Blender')).tag, nodes[0].tag);
  assert.deepEqual(mapTopology(nodes.toReversed(), edges.toReversed()).sources, model.sources);
});

test('local map uses only direct observed relationships and retains a selected low-count edge', () => {
  const edges = [
    {from: 'A', to: 'B', count: 12}, {from: 'A', to: 'C', count: 8},
    {from: 'A', to: 'D', count: 1}, {from: 'E', to: 'A', count: 4},
    {from: 'C', to: 'D', count: 30}
  ];
  const model = mapTopology([], edges);
  const local = localNeighborhood(model, 'A', 'A\u0000D');
  assert.equal(local.relatedCount, 4);
  assert.deepEqual(local.before, [edges[3]]);
  assert.deepEqual(local.after, [edges[0], edges[2]]);
  assert.equal(local.node.foregroundMs, 0);
  assert.equal(local.before[0].to, local.node.tag);
  assert.equal(local.after[0].from, local.node.tag);
});

test('invalid and self relationships cannot create artificial paths', () => {
  const edges = [
    {from: 'A', to: 'A', count: 3}, {from: 'A', to: 'B', count: 0},
    {from: 'A', to: 'C', count: Infinity}, {from: '', to: 'A', count: 2},
    {from: 'A', to: 'D', count: 2}
  ];
  const model = mapTopology([{tag: 'A', foregroundMs: 6000}], edges);
  assert.deepEqual(model.edges, [edges[4]]);
  assert.deepEqual(model.nodes.map(node => node.tag), ['A', 'D']);
  assert.equal(model.outgoing.get('A'), 2);
  assert.equal(model.incoming.get('D'), 2);
  assert.deepEqual(localNeighborhood(model, 'D').after, []);
});
