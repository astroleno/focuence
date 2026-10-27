/** Resolve one observed transition without substituting another occurrence. */
export function resolveRelationEvidence(segments = [], example = {}) {
  const rows = Array.isArray(segments) ? segments : [];
  const active = row => row.status === 'active';
  const to = example.toSegmentId
    ? rows.find(row => active(row) && row.id === example.toSegmentId && row.url === example.toUrl && row.startedAt === example.at)
    : rows.find(row => active(row) && row.url === example.toUrl && row.startedAt === example.at);
  const from = example.fromSegmentId
    ? rows.find(row => active(row) && row.id === example.fromSegmentId && row.url === example.fromUrl)
    : rows.find(row => active(row) && row.url === example.fromUrl && row.endedAt === example.fromEndedAt);
  const matched = [from, to].filter(Boolean);
  return {segments: matched, missing: [...(!from ? ['from'] : []), ...(!to ? ['to'] : [])], complete: Boolean(from && to)};
}
