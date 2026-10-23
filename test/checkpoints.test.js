import test from 'node:test';
import assert from 'node:assert/strict';
import { checkpointPage, makeCheckpoint, observedDraft, checkpointEvidence } from '../src/checkpoints.js';

const page = checkpointPage({url:'https://example.test/design',title:'Design'});
const task = {id:'A',pages:[page]};
const visit = {id:'s',taskId:'A',...page,status:'active',foregroundMs:5000,startedAt:1000,endedAt:6000};

test('a confirmed checkpoint contains user text and verified page evidence', () => {
  const draft = observedDraft(null, [visit], 'A', 7000);
  const checkpoint = makeCheckpoint({progress:'比较了两个方案',nextStep:'核对错误状态',pageId:page.pageId,evidenceId:'s'}, {task,draft,now:7000});
  assert.equal(checkpoint.source,'confirmed'); assert.equal(checkpoint.nextStep,'核对错误状态');
  assert.equal(checkpoint.page.url,page.url); assert.equal(checkpointEvidence(checkpoint,[visit]).available,true);
  assert.equal(checkpointEvidence(checkpoint,[]).reason,'expired');
});

test('checkpoint cannot borrow another task or stale observation', () => {
  assert.throws(() => makeCheckpoint({nextStep:'继续',pageId:'foreign'}, {task}), {code:'STALE_CHECKPOINT'});
  assert.throws(() => makeCheckpoint({nextStep:'继续',pageId:page.pageId,evidenceId:'old'}, {task,draft:{...visit,segmentId:'s'}}), {code:'STALE_CHECKPOINT'});
  assert.throws(() => makeCheckpoint({nextStep:'继续',pageId:page.pageId}, {task,relations:[{taskId:'A',pageId:page.pageId,decision:'unrelated'}]}), {code:'STALE_CHECKPOINT'});
});

test('unknown, idle and too-short records do not create progress drafts', () => {
  for (const change of [{status:'unknown'},{status:'idle'},{foregroundMs:0},{taskId:'B'}]) assert.equal(observedDraft(null,[{...visit,...change}],'A',7000),null);
  const newer = {...observedDraft(null,[visit],'A',7000),at:8000};
  assert.equal(observedDraft(newer,[visit],'A',9000),newer);
  assert.equal(makeCheckpoint({nextStep:'手动留下一步'}, {task}).evidence,null);
});
