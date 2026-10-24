import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserHistory,historyRange,historyRecords} from '../src/browser-history.js';

const copy=value=>structuredClone(value);
function fixture(count=1200){
  const at=Date.now(),range=historyRange(7,at);let settings={historyEnabled:false,historyDays:7},job=null,epoch='',rows=new Map(),permission=true,block=null,fail=false;
  const items=Array.from({length:count},(_,index)=>({id:String(index),url:'https://fixture.test/'+index+'?utm_source=x',title:'资料 '+index,lastVisitTime:at-count+index-1}));
  let visits=new Map(items.map(item=>[item.url,[{visitId:item.id+'a',visitTime:item.lastVisitTime,isLocal:true},{visitId:item.id+'r',visitTime:item.lastVisitTime,isLocal:false},{visitId:item.id+'old',visitTime:range.from-1,isLocal:true}]]));
  const store={getHistoryImport:async()=>copy(job),countBrowserHistory:async()=>rows.size,getMeta:async()=>null,
    beginHistoryImport:async value=>{job=copy(value);epoch=job.generation;return settings={...settings,historyEnabled:true,historyDays:job.range.days};},
    async writeHistoryStep(value,records){if(!settings.historyEnabled||value.generation!==epoch||value.generation!==job.generation||value.revision!==job.revision||!['queued','running'].includes(job.status))throw Object.assign(Error('stale'),{code:'STALE_HISTORY_IMPORT'});
      for(const row of records)rows.set(row.id,copy(row));job={...copy(value),revision:value.revision+1};if(job.status==='done')for(const [id,row]of rows)if(row.runId!==job.runId)rows.delete(id);return copy(job);},
    cancelHistoryImport:async()=>{epoch=crypto.randomUUID();if(job)job={...job,generation:epoch,revision:job.revision+1,status:'cancelled'};},
    disconnectBrowserHistory:async()=>{epoch=crypto.randomUUID();rows.clear();job=null;return settings={...settings,historyEnabled:false};},
    removeBrowserHistory:async({all,sourceKeys})=>{const removed=[...rows.values()].filter(row=>all||sourceKeys.includes(row.sourceKey));for(const row of removed)rows.delete(row.id);epoch=crypto.randomUUID();if(job)job={...job,generation:epoch,revision:job.revision+1,status:'stale'};return{generation:epoch,removed};},
    reconcileHistorySources:async(generation,records)=>{if(epoch!==generation||!settings.historyEnabled)return false;for(const row of records)rows.set(row.id,row);return true;}};
  const api={permissions:{contains:async()=>permission},history:{search:async query=>items.filter(item=>item.lastVisitTime>=query.startTime&&item.lastVisitTime<=query.endTime).slice(0,query.maxResults),getVisits:async({url})=>{if(block)await block;if(fail)throw Error('offline');return visits.get(url)||[];}}};
  const deps={store,api,now:()=>at,settings:()=>settings,onSettings:async value=>{settings=value;},allowed:url=>!url.includes('/excluded'),invalidate:()=>{}};
  return{deps,items,visits,rows,at,range,service:createBrowserHistory(deps),revoke:()=>{permission=false;},block:value=>{block=value;},fail:value=>{fail=value;},get job(){return job;}};
}
async function complete(service,max=300){for(let i=0;i<max;i++){const state=await service.step();if(state.job?.status==='done')return state;if(state.job?.status==='failed')throw Error(state.job.error);}throw Error('Import did not finish');}

test('history ranges use local calendar days and visits must have local provenance and actual in-range time',()=>{
  const at=+new Date('2026-10-24T15:12:00'),range=historyRange(7,at);assert.equal(new Date(range.from).getDate(),18);
  assert.throws(()=>historyRange(10,at),{code:'INVALID_HISTORY_RANGE'});
  const records=historyRecords({url:'https://example.test/?token=secret',title:'当前标题'},[{visitId:'a',visitTime:range.from,isLocal:true},{visitId:'b',visitTime:range.to,isLocal:true},{visitId:'r',visitTime:at,isLocal:false},{visitId:'?',visitTime:at},{visitId:'old',visitTime:range.from-1,isLocal:true}],{range,runId:'r'});
  assert.equal(records.length,2);assert.equal(records[0].url,'https://example.test/');assert(!Object.hasOwn(records[0],'foregroundMs'));
});
test('saturated time windows enumerate beyond default 100 and idempotently preserve all visits',async()=>{
  const f=fixture(1200);await f.service.start({days:7});const result=await complete(f.service);assert.equal(result.count,1200);assert.equal(result.job.processed,1200);assert.equal(result.job.checkedVisits,1200);
  assert(f.job.scannedWindows>1);assert(!JSON.stringify(f.job).includes('fixture.test'));assert(!JSON.stringify([...f.rows.values()]).includes('utm_source'));
  await f.service.start({days:7});await complete(f.service);assert.equal(f.rows.size,1200);
});
test('same-millisecond density increases boundary limit rather than silently truncating',async()=>{
  const f=fixture(600);for(const item of f.items)item.lastVisitTime=f.at-1;
  await f.service.start({days:7});await complete(f.service);assert.equal(f.rows.size,600);assert(f.job.scannedWindows>1);
});
test('cancel rejects late API batches and a recreated worker resumes from durable completed keys',async()=>{
  const f=fixture(120);await f.service.start({days:7});await f.service.step();assert.equal(f.rows.size,48);
  let finish;f.block(new Promise(resolve=>{finish=resolve;}));const work=f.service.step();await new Promise(resolve=>setTimeout(resolve,0));await f.service.cancel();finish();await work;assert.equal(f.rows.size,48);
  f.block(null);const next=createBrowserHistory(f.deps);await next.start({resume:true});await complete(next);assert.equal(f.rows.size,120);
});
test('API failure keeps incomplete state and retry restarts safely without duplicates',async()=>{
  const f=fixture(90);await f.service.start({days:7});f.fail(true);const failed=await f.service.step();assert.equal(failed.job.status,'failed');assert.equal(failed.count,0);
  f.fail(false);await f.service.start({resume:true});await complete(f.service);assert.equal(f.rows.size,90);
});
test('revocation during an in-flight step clears the source and cannot resurrect it',async()=>{
  const f=fixture(90);await f.service.start({days:7});await f.service.step();let finish;f.block(new Promise(resolve=>{finish=resolve;}));const work=f.service.step();await new Promise(resolve=>setTimeout(resolve,0));f.revoke();await f.service.status();finish();await work;
  assert.equal(f.rows.size,0);assert.equal((await f.service.status()).enabled,false);
});
test('browser removals invalidate pending work and reconcile actual remaining local visits',async()=>{
  const f=fixture(90);await f.service.start({days:7});await complete(f.service);const item=f.items[0];f.visits.set(item.url,[]);await f.service.remove({urls:[item.url]});assert.equal(f.rows.size,89);assert.equal(f.job.status,'stale');
  await f.service.remove({allHistory:true,urls:[]});assert.equal(f.rows.size,0);
});
