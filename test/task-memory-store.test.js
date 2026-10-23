import test from 'node:test';
import assert from 'node:assert/strict';
import { taskFrom, relationFrom, DEFAULT_SETTINGS } from '../src/store.js';

test('legacy tasks retain notes and pages without invented progress', () => {
  const notes = '旧备注\n'.repeat(1000);
  const old = {id:'a',name:'旧任务',notes,pages:[{pageId:'p',url:'https://example.test/a',title:'页面'}],createdAt:123,updatedAt:456};
  const value = taskFrom(old);
  assert.equal(value.notes,notes); assert.equal(value.goal,''); assert.equal(value.checkpoint,null); assert.equal(value.revision,0);
  assert.equal(value.pages.length,1); assert.equal(value.updatedAt,456); assert.equal(DEFAULT_SETTINGS.focusSupport,false);
});

test('only confirmed checkpoint text persists and supplementary data cannot alter page identities', () => {
  const base = {id:'a',notes:'🙂'.repeat(15000),pages:[]};
  assert.equal(taskFrom({...base,checkpoint:{source:'observed',progress:'伪进度'}}).checkpoint,null);
  const result = taskFrom({...base,checkpoint:{source:'confirmed',at:12,confirmedAt:12,nextStep:'继续',page:{pageId:'forged',url:'https://example.test/a',title:'A'}}});
  assert.equal([...result.notes].length,15000); assert.notEqual(result.checkpoint.page.pageId,'forged');
  assert.throws(() => relationFrom({taskId:'a',decision:'related',page:{url:'javascript:alert(1)'},revision:'r'}), {code:'INVALID_RELATION'});
});
