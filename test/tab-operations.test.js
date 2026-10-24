import test from 'node:test';import assert from 'node:assert/strict';
import {createTabOperations} from '../src/tab-operations.js';
import {workspaceCatalog} from '../src/tab-workspace.js';
import {taskFrom} from '../src/store.js';
function fixture(){let tabs=Array.from({length:4},(_,index)=>({id:index+1,windowId:1,index,url:'https://example.test/'+(index<3?'a':'b'),title:'页面',active:index===3,pinned:false,groupId:-1,status:'complete'})),saved=null,logs=new Map(),removed=[],fail=false,removeFail=false;
 const copy=structuredClone;const deps={sessionId:'s',now:()=>12345,allowed:()=>true,tabs:async()=>copy(tabs),windows:async()=>[{id:1,type:'normal'}],group:async()=>null,
  store:{getTask:async()=>null,getRelations:async()=>[],getTabOperation:async id=>copy(logs.get(id)),listTabOperations:async()=>[...logs.values()].map(copy),putTabOperation:async log=>{logs.set(log.id,copy(log));}},
  save:async(task,log)=>{if(fail)throw Error('quota');saved=taskFrom(task);logs.set(log.id,copy(log));},
  remove:async id=>{if(removeFail&&id===2)throw Error('blocked');removed.push(id);const tab=tabs.find(tab=>tab.id===id);tabs=tabs.filter(tab=>tab.id!==id);for(const item of tabs)if(item.index>tab.index)item.index--;},
  getTab:async id=>{const tab=tabs.find(tab=>tab.id===id);if(!tab)throw Error('gone');return copy(tab);},
  create:async options=>{const tab={...options,id:100+tabs.length,index:tabs.length,groupId:-1,status:'complete'};tabs.push(tab);return copy(tab);},restoreGroup:async()=>{},invalidate:()=>{}};
 return{service:createTabOperations(deps),deps,get tabs(){return tabs;},get saved(){return saved;},removed,fail:v=>fail=v,removeFail:v=>removeFail=v};}
test('catalog keeps exact duplicates separate from cleaned identity and excludes private/navigation tabs',async()=>{
 const f=fixture();f.tabs[1].url+='?token=one';f.tabs[2].url+='?token=two';f.tabs.push({...f.tabs[0],id:9,incognito:true});f.tabs.push({...f.tabs[0],id:10,pendingUrl:'https://pending.test/'});
 const value=await workspaceCatalog([{id:1,type:'normal'}],f.tabs);assert.equal(value.tabs.length,4);assert.equal(value.duplicateGroups.length,0);
});
test('write failure closes nothing; navigation invalidates the reviewed member set',async()=>{
 const f=fixture(),plan=await f.service.preview({tabIds:[1,2],name:'任务'});f.fail(true);await assert.rejects(f.service.execute({token:plan.token}),/quota/);assert.equal(f.removed.length,0);
 f.fail(false);f.tabs[0].url='https://new.test/';await assert.rejects(f.service.execute({token:plan.token}),{code:'STALE_TAB_PLAN'});assert.equal(f.saved,null);
});
test('batch close accounts for its own index shifts and restore preserves duplicate multiplicity',async()=>{
 const f=fixture(),plan=await f.service.preview({tabIds:[1,2],name:'任务',kind:'duplicates'}),closed=await f.service.execute({token:plan.token});
 assert.equal(closed.closed,2);assert.equal(f.saved.pages.length,1);assert.deepEqual(f.removed,[1,2]);
 const restore=await f.service.previewRestore({id:closed.id,windowId:1});assert.equal(restore.willOpen,2);
 const result=await f.service.restore({token:restore.token});assert.equal(result.opened,2);
 const next=await f.service.previewRestore({id:closed.id,windowId:1});assert.equal(next.willOpen,0);assert.equal(next.reused,2);
 await f.service.restore({token:next.token});assert.equal(f.tabs.length,4);
});
test('protected members need explicit acknowledgement and duplicates must retain a survivor',async()=>{
 const f=fixture();await assert.rejects(f.service.preview({tabIds:[4],name:'任务'}),{code:'PROTECTED_TAB'});
 await assert.rejects(f.service.preview({tabIds:[1,2,3],name:'任务',kind:'duplicates'}),{code:'STALE_TAB_PLAN'});
 const plan=await f.service.preview({tabIds:[4],confirmedProtected:[4],name:'任务'});assert.equal(plan.rows.length,1);
});
test('partial browser failure persists per-page outcome and retry does not repeat successful restores',async()=>{
 const f=fixture();f.removeFail(true);const plan=await f.service.preview({tabIds:[1,2],name:'任务'}),result=await f.service.execute({token:plan.token});
 assert.equal(result.closed,1);assert.equal(result.failed,1);assert.equal(result.rows[1].error,'blocked');
 const restore=await f.service.previewRestore({id:result.id,windowId:1});assert.equal(restore.rows.length,1);
});
test('worker recycle drops close previews and never auto-continues durable requested rows',async()=>{
 const f=fixture(),plan=await f.service.preview({tabIds:[1,2],name:'任务'}),fresh=createTabOperations(f.deps);
 await assert.rejects(fresh.execute({token:plan.token}),{code:'STALE_TAB_PLAN'});assert.equal(f.removed.length,0);
});
test('immediate restore retries reuse recorded tabs while their requested URLs are still loading',async()=>{
 const f=fixture(),create=f.deps.create;f.deps.create=async options=>{const tab=await create(options),saved=f.tabs.find(row=>row.id===tab.id);saved.pendingUrl=options.url;saved.url='about:blank';saved.status='loading';return structuredClone(saved);};
 const plan=await f.service.preview({tabIds:[1,2],name:'加载中的恢复',kind:'duplicates'}),closed=await f.service.execute({token:plan.token}),restore=await f.service.previewRestore({id:closed.id,windowId:1});await f.service.restore({token:restore.token});
 const again=await f.service.previewRestore({id:closed.id,windowId:1});assert.equal(again.willOpen,0);assert.equal(again.reused,2);assert.equal((await f.service.restore({token:again.token})).reused,2);assert.equal(f.tabs.length,4);
 f.tabs.find(tab=>tab.pendingUrl).pendingUrl='https://new-destination.test/';assert.equal((await f.service.previewRestore({id:closed.id,windowId:1})).willOpen,1);
});
