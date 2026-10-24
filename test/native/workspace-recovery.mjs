import {setup,until,sleep} from './cdp.mjs';import assert from 'node:assert/strict';import {writeFileSync} from 'node:fs';
const env=await setup({headed:true}),{control,rpc,browser,windowId,extensionId,base}=env,report={environment:'Headed isolated Chrome; synthetic files/tabs; real optional permission and IndexedDB.',checks:[],errors:[]};
const check=(name,detail={})=>{report.checks.push({name,status:'passed',detail});console.log(name);};
async function worker(){const info=(await browser.send('Target.getTargets')).targetInfos.find(item=>item.url==='chrome-extension://'+extensionId+'/background.js');return browser.attach(info.targetId);}
try{
 await rpc('CLEAR_ALL');await rpc('UPDATE_SETTINGS',{patch:{tracking:false,semantic:false}});
 const blocked=await control.eval(async()=>{
  const name='focuence-blocked-qa-'+Date.now(),opening=indexedDB.open(name,2);opening.onupgradeneeded=()=>opening.result.createObjectStore('meta',{keyPath:'key'});
  const old=await new Promise(resolve=>opening.onsuccess=()=>resolve(opening.result));const {openStore}=await import(chrome.runtime.getURL('src/store.js'));let error='';
  try{await openStore({name});}catch(value){error=value.message;}old.close();const store=await openStore({name});store.close();
  await new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase(name);request.onsuccess=resolve;request.onerror=()=>reject(request.error);setTimeout(()=>reject(Error('orphan connection')),3000);});return{error};
 });assert.match(blocked.error,/关闭其他/);check('Blocked v2 migration returns actionable retry and leaves no orphan connection',blocked);
 const task=await rpc('SAVE_TASK',{mode:'intent',name:'本机名称',goal:'原目标',notes:'本机备注'});
 const data=await rpc('EXPORT_DATA');data.tasks[0].name='备份名称';data.tasks[0].notes='备份原文🙂';
 const preview=await rpc('PREVIEW_IMPORT',{data});await rpc('UPDATE_TASK',{id:task.id,revision:task.revision,notes:'新编辑'});
 await assert.rejects(rpc('APPLY_IMPORT',{token:preview.token}),{code:'IMPORT_PREVIEW_STALE'});assert.equal((await rpc('GET_STATE')).tasks[0].notes,'新编辑');check('An actual concurrent edit rejects an old import preview and preserves the new text');
 const bad=env.browser.profile+'/bad.json',good=env.browser.profile+'/good.json';writeFileSync(bad,'{broken');writeFileSync(good,JSON.stringify(data));
 await control.eval(()=>location.hash='settings');await until(()=>control.eval(()=>!!document.querySelector('#backup-file')),'backup UI');
 async function chooseFile(path){const {root}=await control.send('DOM.getDocument',{});const {nodeId}=await control.send('DOM.querySelector',{nodeId:root.nodeId,selector:'#backup-file'});await control.send('DOM.setFileInputFiles',{nodeId,files:[path]});}
 await chooseFile(bad);await until(()=>control.eval(()=>document.body.innerText.includes('bad.json')),'bad file loaded');await control.click('[aria-label="备份导入与恢复"] button');
 await until(()=>control.eval(()=>document.querySelector('[aria-label="备份导入与恢复"] [role="alert"]')?.textContent.includes('JSON')),'invalid file visible');
 assert(await control.eval(()=>document.body.innerText.includes('bad.json')));check('Native import form retains the selected invalid file and shows the validation failure');
 await chooseFile(good);await until(()=>control.eval(()=>document.body.innerText.includes('good.json')),'good file loaded');await control.click('[aria-label="备份导入与恢复"] button');
 await until(()=>control.eval(()=>!!document.querySelector('.w-preview select')),'conflict preview');await control.fill('.w-preview select','backup');
 await until(()=>control.eval(()=>!document.querySelector('.w-preview button')?.disabled),'conflict decision applied');await control.screenshot(env.out+'/screenshots/workspace-conflict.png');
 await control.click('.w-preview button');await until(async()=>(await rpc('GET_STATE')).tasks[0].name==='备份名称','import chosen conflict');assert.equal((await rpc('GET_STATE')).tasks[0].notes,'备份原文🙂');check('Native file chooser, conflict selection and apply use the reviewed backup content');
 const quota=await control.eval(async()=>{
  const {openStore}=await import(chrome.runtime.getURL('src/store.js')),{planImport,backupStamp,canonical}=await import(chrome.runtime.getURL('src/backup.js'));const store=await openStore(),before=await store.exportData(),oldPoint=await store.getRestorePoint();
  const incoming=structuredClone(before);incoming.tasks.push({...incoming.tasks[0],id:'quota-write',notes:'配额失败'});const plan=planImport(incoming,before);let error='',code='';const original=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(value,...args){if(this.name==='tasks'&&value?.id==='quota-write')throw new DOMException('Injected quota failure','QuotaExceededError');return original.call(this,value,...args);};
  try{await store.applyImport(plan);}catch(value){error=value.message;code=value.code;}finally{IDBObjectStore.prototype.put=original;}
  const after=await store.exportData(),point=await store.getRestorePoint();store.close();return{error,code,unchanged:backupStamp(before,true)===backupStamp(after,true),snapshotUnchanged:canonical(oldPoint)===canonical(point)};
 });assert.equal(quota.code,'STORAGE_QUOTA');assert(quota.unchanged&&quota.snapshotUnchanged);check('QuotaExceededError injected at native IDB write rolls back the real transaction and snapshot',quota);
 const ids=await control.eval(async({base,windowId})=>{const result=[];for(let index=0;index<32;index++)result.push((await chrome.tabs.create({windowId,url:base+'/fixture/recovery-'+index,active:false})).id);return result;},{base,windowId});
 await until(async()=>(await rpc('LIST_WORKSPACE_TABS')).tabs.length===32,'32 ready tabs');
 await assert.rejects(rpc('PREVIEW_TAB_ACTION',{tabIds:ids.slice(0,31),name:'超过清单'}),{code:'TASK_PAGE_LIMIT'});assert.equal((await rpc('LIST_WORKSPACE_TABS')).tabs.length,32);check('31 distinct resources are rejected with every native tab still open');
 const groupId=await control.eval(async ids=>{const group=await chrome.tabs.group({tabIds:ids});await chrome.tabGroups.update(group,{title:'接口资料',color:'blue'});return group;},ids.slice(20,23));
 const groupedPlan=await rpc('PREVIEW_TAB_ACTION',{tabIds:ids.slice(20,22),confirmedProtected:ids.slice(20,22),name:'已有分组'}),groupedClose=await rpc('EXECUTE_TAB_ACTION',{token:groupedPlan.token});assert.equal(groupedClose.closed,2);
 await control.eval(async id=>chrome.tabGroups.update(id,{title:'用户改过的组名'}),groupId);const groupedRestore=await rpc('PREVIEW_RESTORE_OPERATION',{id:groupedClose.id,windowId});await rpc('RESTORE_TAB_OPERATION',{token:groupedRestore.token});
 const groupedResult=await control.eval(async id=>({tabs:(await chrome.tabs.query({groupId:id})).length,title:(await chrome.tabGroups.get(id)).title}),groupId);assert.equal(groupedResult.tabs,3);assert.equal(groupedResult.title,'用户改过的组名');check('Restoring protected grouped tabs reuses the actual surviving group and preserves newer group metadata',groupedResult);
 let target=await worker();await target.eval(id=>{globalThis.qaOriginalRemove=chrome.tabs.remove;chrome.tabs.remove=async value=>{if(value===id)throw Error('Injected browser failure');return qaOriginalRemove(value);};},ids[1]);
 const closing=await rpc('PREVIEW_TAB_ACTION',{tabIds:ids.slice(0,3),name:'部分关闭'}),partial=await rpc('EXECUTE_TAB_ACTION',{token:closing.token});await target.eval(()=>chrome.tabs.remove=qaOriginalRemove);
 assert.equal(partial.closed,2);assert.equal(partial.failed,1);assert.equal(partial.rows[1].error,'Injected browser failure');check('Native close failure retains per-page results and continues safe remaining members',{closed:partial.closed,failed:partial.failed});
 await target.eval(()=>{globalThis.qaOriginalRemove=chrome.tabs.remove;chrome.tabs.remove=async id=>{globalThis.qaWaitingId=id;return new Promise(()=>{});};});
 const interrupted=await rpc('PREVIEW_TAB_ACTION',{tabIds:[ids[3],ids[4]],name:'中断恢复'});
 await control.eval(token=>{globalThis.qaInterrupted=chrome.runtime.sendMessage({target:'background',type:'EXECUTE_TAB_ACTION',token}).catch(error=>({error:error.message}));},interrupted.token);
 await until(()=>target.eval(()=>Number.isInteger(globalThis.qaWaitingId)),'durable requested close');await browser.send('Target.closeTarget',{targetId:target.targetId});
 await rpc('GET_STATE');const operations=await rpc('GET_TAB_OPERATIONS'),operation=operations.find(item=>item.taskName==='中断恢复');assert.equal(operation.pending,2);
 assert((await rpc('LIST_WORKSPACE_TABS')).tabs.some(tab=>tab.id===ids[3]));await sleep(250);assert((await rpc('LIST_WORKSPACE_TABS')).tabs.some(tab=>tab.id===ids[4]));
 const recovery=await rpc('PREVIEW_RESTORE_OPERATION',{id:operation.id,windowId});assert.equal(recovery.rows.length,0);check('Actual worker termination keeps the durable requested log and never continues closing');
 await control.eval(()=>location.hash='pages');await until(()=>control.eval(()=>!!document.querySelector('[data-mode="workspace"]')),'workspace entry');await control.click('[data-mode="workspace"]');
 await until(()=>control.eval(()=>!!document.querySelector('[data-w-action="enable-sessions"]')),'optional session button');await control.click('[data-w-action="enable-sessions"]');console.log('SESSION_PERMISSION_REQUESTED');
 try{await until(async()=>(await rpc('LIST_RECENTLY_CLOSED')).enabled,'session permission granted',60000);}catch(error){console.error('PERMISSION_UI',await control.eval(()=>document.querySelector('.w-error')?.textContent||document.body.innerText.slice(-800)));throw error;}
 const sessions=await rpc('LIST_RECENTLY_CLOSED');assert(sessions.items.length>0);const restoreItem=sessions.items.find(item=>item.complete);assert(restoreItem);
 await rpc('RESTORE_RECENTLY_CLOSED',{id:restoreItem.id});check('User-triggered native optional session grant and actual recently closed restoration',{items:sessions.items.length});
 await control.screenshot(env.out+'/screenshots/workspace-recent.png');
}catch(error){report.errors.push(error.stack);console.error(error.stack);console.error('CURRENT_UI',await control.eval(()=>({text:document.body.innerText.slice(-2500),errors:[...document.querySelectorAll('[role=alert]')].map(node=>node.textContent)})).catch(()=>null));await control.screenshot(env.out+'/screenshots/recovery-failure.png').catch(()=>{});process.exitCode=1;}
finally{writeFileSync(env.out+'/recovery.json',JSON.stringify(report,null,2));await env.close();}
