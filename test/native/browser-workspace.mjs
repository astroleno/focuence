import {setup,until,sleep} from './cdp.mjs';
import assert from 'node:assert/strict';import {writeFileSync} from 'node:fs';
const env=await setup({headed:process.argv.includes('--headed')}),report={environment:'Isolated Chrome for Testing; synthetic browser pages and real extension/IndexedDB.',checks:[],errors:[]};
const {control,rpc,base,browser,windowId,extensionId}=env;
const check=(name,detail={})=>{report.checks.push({name,status:'passed',detail});console.log(name);};
try{
 await rpc('CLEAR_ALL');await rpc('UPDATE_SETTINGS',{patch:{tracking:false,semantic:false}});
 const migration=await control.eval(async()=>{
  const name='focuence-migration-qa-'+Date.now();const open=indexedDB.open(name,2);open.onupgradeneeded=()=>{for(const key of ['meta','pages','tasks','segments','vectors','taskRelations'])open.result.createObjectStore(key,{keyPath:key==='meta'?'key':'id'});};
  const old=await new Promise((resolve,reject)=>{open.onsuccess=()=>resolve(open.result);open.onerror=()=>reject(open.error);});
  await new Promise((resolve,reject)=>{const tx=old.transaction('tasks','readwrite');tx.objectStore('tasks').put({id:'legacy',name:'旧任务',notes:'旧备注🙂\n'.repeat(1000),pages:[],createdAt:1,updatedAt:2});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});old.close();
  const {openStore}=await import(chrome.runtime.getURL('src/store.js'));const store=await openStore({name}),task=await store.getTask('legacy'),schema=(await store.exportData()).schemaVersion;store.close();
  await new Promise(resolve=>{indexedDB.deleteDatabase(name).onsuccess=resolve;});return{schema,status:task.status,notes:task.notes.length};
 });assert.equal(migration.schema,4);assert.equal(migration.status,'active');assert(migration.notes>5000);check('Real v2→v3 upgrade preserves legacy text and supplies active status',migration);
 const backup=await rpc('EXPORT_DATA');backup.tasks=[{id:'import-a',name:'导入目标',goal:'核对资料',notes:'🙂原文\n'.repeat(1000),pages:[],revision:0,createdAt:1,updatedAt:2}];
 let preview=await rpc('PREVIEW_IMPORT',{data:backup});await rpc('APPLY_IMPORT',{token:preview.token});
 let state=await rpc('GET_STATE');assert.equal(state.tasks.length,1);assert.equal(state.tasks[0].notes,backup.tasks[0].notes);
 preview=await rpc('PREVIEW_IMPORT',{data:await rpc('EXPORT_DATA')});await rpc('APPLY_IMPORT',{token:preview.token});assert.equal((await rpc('GET_STATE')).tasks.length,1);
 assert(await rpc('GET_RESTORE_POINT'));check('Actual backup preview and atomic import preserve text; repeated import is idempotent');
 const rollback=await control.eval(async()=>{
  const {openStore}=await import(chrome.runtime.getURL('src/store.js')),{planImport,backupStamp}=await import(chrome.runtime.getURL('src/backup.js'));const store=await openStore();const before=await store.exportData();
  const plan=planImport(before,before,{mode:'replace'});plan.data.tasks.push(null);let error='';try{await store.applyImport(plan);}catch(value){error=value.message;}
  const after=await store.exportData();store.close();return{error,unchanged:backupStamp(before,true)===backupStamp(after,true)};
 });assert(rollback.error);assert(rollback.unchanged);check('Actual IndexedDB transaction abort retains the whole original database',rollback);
 await rpc('CLEAR_HISTORY');assert.equal(await rpc('GET_RESTORE_POINT'),null);check('Clear history removes the internal pre-import snapshot');
 const windows=await control.eval(async base=>{
   const result=[];for(let group=0;group<3;group++){const window=await chrome.windows.create({url:base+'/fixture/window-'+group,focused:false});result.push(window.id);
     for(let index=0;index<(group===0?33:32);index++)await chrome.tabs.create({windowId:window.id,url:base+'/fixture/'+(group===0&&index<3?'duplicate':'page-'+group+'-'+index),active:false});}return result;
 },base);
 await until(async()=>(await rpc('LIST_WORKSPACE_TABS')).tabs.length===100,'100 fixture tabs');
 const catalog=await rpc('LIST_WORKSPACE_TABS');assert.equal(catalog.tabs.length,100);assert.equal(catalog.windows.filter(window=>window.tabs.length).length,3);assert(catalog.duplicateGroups.some(group=>group.length===3));check('Native catalog covers three windows and 100 tabs with exact duplicates',{windows:3,tabs:100});
 const duplicates=catalog.tabs.filter(tab=>tab.duplicates.length===3&&!tab.protection.length).slice(0,2);
 const plan=await rpc('PREVIEW_TAB_ACTION',{tabIds:duplicates.map(tab=>tab.id),kind:'duplicates',name:'重复资料',checkpoint:{nextStep:'核对原文',pageId:duplicates[0].pageId}});
 const closed=await rpc('EXECUTE_TAB_ACTION',{token:plan.token});assert.equal(closed.closed,2);assert.equal(closed.failed,0);
 const saved=(await rpc('GET_STATE')).tasks.find(task=>task.name==='重复资料');assert.equal(saved.pages.length,1);assert.equal(saved.checkpoint.nextStep,'核对原文');
 let restore=await rpc('PREVIEW_RESTORE_OPERATION',{id:closed.id,windowId});assert.equal(restore.willOpen,2);let result=await rpc('RESTORE_TAB_OPERATION',{token:restore.token});assert.equal(result.opened,2);
 restore=await rpc('PREVIEW_RESTORE_OPERATION',{id:closed.id,windowId});assert.equal(restore.willOpen,0);result=await rpc('RESTORE_TAB_OPERATION',{token:restore.token});assert.equal(result.reused,2);check('Real save/close/restore keeps duplicate multiplicity and repeated restores reuse successful pages',{closed:closed.closed,restored:2,reused:result.reused});
 const mutable=(await rpc('LIST_WORKSPACE_TABS')).tabs.find(tab=>!tab.protection.length&&!tab.duplicates.length);
 const stale=await rpc('PREVIEW_TAB_ACTION',{tabIds:[mutable.id],name:'旧预览'});await control.eval(async({id,base})=>chrome.tabs.update(id,{url:base+'/fixture/navigated'}),{id:mutable.id,base});
 await assert.rejects(rpc('EXECUTE_TAB_ACTION',{token:stale.token}),{code:'STALE_TAB_PLAN'});check('Native navigation invalidates a close preview before saving or closing');
 let task=(await rpc('GET_STATE')).tasks.find(task=>task.id===saved.id);let current=(await rpc('GET_STATE')).work.current;
 await rpc('SET_CURRENT_TASK',{id:task.id,contextRevision:current.revision});
 const second=windows[1];await rpc('SET_CURRENT_TASK',{id:task.id,windowId:second,contextRevision:0});
 task=(await rpc('GET_STATE')).tasks.find(task=>task.id===saved.id);await rpc('SET_TASK_STATUS',{id:task.id,revision:task.revision,status:'completed'});
 assert.equal((await rpc('GET_STATE')).work.current.taskId,null);assert.equal((await rpc('GET_STATE',{windowId:second})).work.current.taskId,null);
 await assert.rejects(rpc('SET_TASK_STATUS',{id:task.id,revision:task.revision,status:'active'}),{code:'STALE_TASK'});check('Task completion atomically releases two actual window bindings and rejects stale revisions');
 const inactive=(await rpc('GET_STATE')).tasks.find(task=>task.id===saved.id);await rpc('SET_TASK_STATUS',{id:inactive.id,revision:inactive.revision,status:'active'});
 const sessions=await rpc('LIST_RECENTLY_CLOSED');assert.equal(sessions.enabled,false);check('Recently closed is unavailable until its optional permission is granted');
 const uiPage=await browser.page('chrome-extension://'+extensionId+'/panel/index.html?windowId='+windows[0]+'#pages',360,760);
 await until(()=>uiPage.eval(()=>!!document.querySelector('[data-mode="workspace"]')),'workspace entry');await uiPage.click('[data-mode="workspace"]');
 await until(()=>uiPage.eval(()=>document.querySelectorAll('.w-row').length>0),'native workspace list');
 await uiPage.fill('#w-window-scope','all');await uiPage.fill('#w-tab-query','page-2-31');assert.equal(await uiPage.eval(()=>document.querySelectorAll('.w-row').length),1);
 await uiPage.screenshot(env.out+'/screenshots/panel-workspace.png');
 const metrics=await uiPage.eval(()=>({overflow:document.documentElement.scrollWidth>innerWidth,ids:[...document.querySelectorAll('[id]')].map(node=>node.id).filter((id,i,all)=>all.indexOf(id)!==i)}));assert.equal(metrics.overflow,false);assert.deepEqual(metrics.ids,[]);check('Real sidebar performs cross-window search with no overflow or duplicate IDs',metrics);await uiPage.close();
 await control.eval(()=>location.hash='settings');await until(()=>control.eval(()=>!!document.querySelector('#backup-file')),'backup UI');await control.screenshot(env.out+'/screenshots/workspace-backup.png');
 check('Native full workspace exposes the file import and conflict preview surface');
}catch(error){report.errors.push(error.stack);console.error(error.stack);process.exitCode=1;}
finally{writeFileSync(env.out+'/native.json',JSON.stringify(report,null,2));await env.close();}
