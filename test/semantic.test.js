import test from 'node:test';
import assert from 'node:assert/strict';
import { embedItems, semanticItem, textChunks } from '../src/semantic.js';

const vector = Array.from({length:512},(_,i)=>i===0?1:0);
const harness = () => { const records=new Map();let calls=0;return {records,get calls(){return calls;},store:{getVectors:async ids=>ids.map(id=>records.get(id)).filter(Boolean),putVectors:async values=>values.forEach(value=>records.set(value.id,value))},infer:async items=>{calls++;return {vectors:items.map(item=>({id:item.id,vector}))};}}; };

test('shared embeddings cache by purpose and full input identity', async () => {
  const h=harness(), a=semanticItem('p','登录错误提示','page');
  assert.equal((await embedItems([a],h)).computed,1);
  assert.equal((await embedItems([a],h)).cached,1);
  await embedItems([semanticItem('p','修改后的标题','page')],h);
  await embedItems([semanticItem('p','修改后的标题','goal')],h);
  assert.equal(h.calls,3); assert.equal(h.records.size,2);
});

test('cancelled inference never persists late vectors', async () => {
  const h=harness();let valid=true;
  const options={...h,isCurrent:()=>valid,infer:async items=>{valid=false;return h.infer(items);}};
  await assert.rejects(embedItems([semanticItem('p','测试','page')],options),{code:'CANCELLED'});
  assert.equal(h.records.size,0);
});

test('invalid or incomplete model outputs fail without cache poisoning', async () => {
  const h=harness();
  await assert.rejects(embedItems([semanticItem('p','测试')],{...h,infer:async()=>({vectors:[]})}));
  assert.equal(h.records.size,0);
  await embedItems([semanticItem('q','查询')],{...h,cache:false}); assert.equal(h.records.size,0);
});

test('chunking covers long user text including supplementary Unicode', () => {
  const value='🙂'.repeat(100)+'最后的线索';
  const chunks=textChunks(value,40,10);
  assert(chunks.at(-1).endsWith('最后的线索')); assert(chunks.every(chunk=>[...chunk].length<=40));
});
