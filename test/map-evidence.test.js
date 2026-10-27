import test from 'node:test';
import assert from 'node:assert/strict';
import {computeReview} from '../src/analytics.js';
import {resolveRelationEvidence} from '../src/map-evidence.js';

const morning = new Date(2026, 9, 28, 9).getTime();
const visit = (id, tag, offset) => ({id, url: 'https://example.org/' + tag, title: tag, pageId: tag,
  tags: [tag], startedAt: morning + offset * 60000, endedAt: morning + (offset + 1) * 60000,
  foregroundMs: 60000, status: 'active', endReason: 'tab-switch'});

test('repeated map relations retain the two exact segments for each occurrence', () => {
  const segments = [visit('a1', 'A', 0), visit('b1', 'B', 1), visit('a2', 'A', 2), visit('b2', 'B', 3)];
  const review = computeReview({segments, range: 'today', now: morning + 3600000});
  const edge = review.transitions.find(row => row.from === 'A' && row.to === 'B');
  assert.equal(edge.examples.length, 2);
  assert.deepEqual(edge.examples.map(row => [row.fromSegmentId, row.toSegmentId]), [['a2', 'b2'], ['a1', 'b1']]);
  assert.deepEqual(resolveRelationEvidence(review.segments, edge.examples[1]).segments.map(row => row.id), ['a1', 'b1']);
  assert.deepEqual(resolveRelationEvidence(review.segments, edge.examples[0]).segments.map(row => row.id), ['a2', 'b2']);
});

test('a missing or expired endpoint is reported without replacing it with a later visit', () => {
  const a = visit('a1', 'A', 0), b = visit('b1', 'B', 1), later = visit('a2', 'A', 2);
  const example = {fromSegmentId: a.id, toSegmentId: b.id, fromUrl: a.url, toUrl: b.url, at: b.startedAt};
  const result = resolveRelationEvidence([b, later], example);
  assert.equal(result.complete, false);
  assert.deepEqual(result.missing, ['from']);
  assert.deepEqual(result.segments.map(row => row.id), ['b1']);
  assert.deepEqual(resolveRelationEvidence([], example).missing, ['from', 'to']);
});

test('legacy examples resolve only with exact time evidence and never use idle rows', () => {
  const a = visit('a1', 'A', 0), b = visit('b1', 'B', 1);
  const example = {fromUrl: a.url, toUrl: b.url, at: b.startedAt, fromEndedAt: a.endedAt};
  assert.equal(resolveRelationEvidence([a, b], example).complete, true);
  assert.deepEqual(resolveRelationEvidence([{...a, status: 'idle'}, b], example).missing, ['from']);
  assert.deepEqual(resolveRelationEvidence([a, {...b, startedAt: b.startedAt + 1}], example).missing, ['to']);
  assert.deepEqual(resolveRelationEvidence([a, b], {...example, fromEndedAt: undefined}).missing, ['from']);
});
