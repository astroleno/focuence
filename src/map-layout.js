// The two lanes represent visit roles, not semantic distance or importance.
export function mapTopology(entries, edges) {
  const byTag = new Map();
  for (const entry of entries) if (typeof entry.tag === 'string' && entry.tag) byTag.set(entry.tag, {...entry});
  const valid = edges.filter(edge => typeof edge.from === 'string' && edge.from && typeof edge.to === 'string' && edge.to && edge.from !== edge.to && Number.isFinite(Number(edge.count)) && Number(edge.count) > 0);
  const incoming = new Map(), outgoing = new Map();
  for (const edge of valid) {
    for (const tag of [edge.from, edge.to]) if (!byTag.has(tag)) byTag.set(tag, {tag, foregroundMs: 0, visits: 0});
    outgoing.set(edge.from, (outgoing.get(edge.from) || 0) + Number(edge.count));
    incoming.set(edge.to, (incoming.get(edge.to) || 0) + Number(edge.count));
  }
  const order = weights => [...byTag.values()].filter(node => weights.has(node.tag)).sort((a, b) => weights.get(b.tag) - weights.get(a.tag) || a.tag.localeCompare(b.tag, 'zh-CN'));
  return {
    nodes: [...byTag.values()], edges: valid,
    sources: order(outgoing), targets: order(incoming), incoming, outgoing,
    isolated: [...byTag.values()].filter(node => !incoming.has(node.tag) && !outgoing.has(node.tag)).sort((a, b) => a.tag.localeCompare(b.tag, 'zh-CN'))
  };
}
export function localNeighborhood(topology, tag, selectedEdge = '', limit = 2) {
  const sort = (a, b) => Number(b.count) - Number(a.count) || a.from.localeCompare(b.from, 'zh-CN') || a.to.localeCompare(b.to, 'zh-CN');
  const take = edges => {
    const ordered = edges.slice().sort(sort);
    const chosen = ordered.slice(0, limit);
    const selected = ordered.find(edge => edge.from + '\u0000' + edge.to === selectedEdge);
    if (selected && !chosen.includes(selected) && limit > 0) chosen.splice(Math.max(0, chosen.length - 1), 1, selected);
    return chosen;
  };
  const before = take(topology.edges.filter(edge => edge.to === tag));
  const after = take(topology.edges.filter(edge => edge.from === tag));
  const relatedCount = topology.edges.filter(edge => edge.from === tag || edge.to === tag).length;
  return {
    node: topology.nodes.find(node => node.tag === tag),
    before, after, relatedCount,
    hiddenCount: Math.max(0, relatedCount - before.length - after.length)
  };
}

export function resolveMapContext(entries, edges, tag = '', selectedEdge = '') {
  const selected = entries.find(entry => entry.tag === tag);
  const edge = edges.find(edge => edge.from + '\u0000' + edge.to === selectedEdge);
  const fallback = entries.find(entry => edges.some(edge => edge.from === entry.tag || edge.to === entry.tag)) || entries[0];
  const topic = selected?.tag || edge?.from || fallback?.tag || '';
  const relation = edge && (edge.from === topic || edge.to === topic) ? selectedEdge : '';
  return {topic, relation, invalidTopic: Boolean(tag && !selected), invalidRelation: Boolean(selectedEdge && !relation)};
}
