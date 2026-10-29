import {setup,until,sleep} from './cdp.mjs';
import assert from 'node:assert/strict';
import {writeFileSync,readFileSync,readdirSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const env=await setup({out:process.argv.find(value=>value.startsWith('--out='))?.slice(6)||'docs/reviews/v2.7'});
const {control,rpc,browser,windowId,base}=env,downloads=mkdtempSync(join(tmpdir(),'focuence-diagnostics-download-'));
const report={environment:'Isolated Chrome for Testing, actual MV3, native IndexedDB and UI. Synthetic metadata only. No API permission or credentials installed.',checks:[],errors:[]};
const check=(name,detail={})=>{report.checks.push({name,status:'passed',detail});console.log(name);};
const diag=()=>rpc('GET_DIAGNOSTICS');
const taskFrom=async id=>(await rpc('GET_STATE')).tasks.find(task=>task.id===id);
try{
  // Physical device idle time is shared with headless Chrome. Use the supported
  // one-hour threshold so this foreground fixture is independent of short breaks.
  await rpc('CLEAR_ALL');await rpc('UPDATE_SETTINGS',{patch:{tracking:true,semantic:false,idleSeconds:3600}});
  const ids=await control.eval(async({base,windowId})=>{const ids=[];for(const name of ['ESP32-I2S-microphone','ESP32-I2S-playback'])ids.push((await chrome.tabs.create({windowId,url:base+'/fixture/'+name,active:false})).id);return ids;},{base,windowId});
  await until(async()=>{const tabs=(await rpc('GET_STATE')).tabs;return tabs.length===2&&tabs.every(tab=>['ESP32-I2S-microphone','ESP32-I2S-playback'].includes(tab.title));},'fixture titles');
  let task=await rpc('SAVE_TASK',{name:'合成接口验收',goal:'核对接口返回值',notes:'CANARY_PRIVATE_NOTES',tabIds:ids});
  await rpc('SET_CURRENT_TASK',{id:task.id,revision:task.revision,contextRevision:(await rpc('GET_STATE')).work.current.revision});
  await control.eval(async id=>{await chrome.windows.update((await chrome.tabs.get(id)).windowId,{focused:true});await chrome.tabs.update(id,{active:true});},ids[0]);
  await rpc('FLUSH_ACTIVITY');
  await until(async()=>(await diag()).summary.capture.latest?.status==='active','active capture sample');
  const captures=(await diag()).summary.capture.samples;
  for(let i=0;i<10;i++)await rpc('GET_STATE');
  assert.equal((await diag()).summary.capture.samples,captures);
  await rpc('UPDATE_SETTINGS',{patch:{excludedDomains:['127.0.0.1']}});assert((await diag()).recent.some(row=>row.kind==='capture.state'&&row.reason==='excluded'));
  await rpc('UPDATE_SETTINGS',{patch:{excludedDomains:[],tracking:false}});
  const paused=(await diag()).retained;
  const local=await rpc('PREDICT_NEXT',{clientId:'paused-log'});await rpc('PREDICTION_FEEDBACK',{token:local.token,action:'shown',elapsedMs:1});
  await rpc('PROPOSE_GROUPS',{semantic:false});
  const whenPaused=await diag();assert.equal(whenPaused.summary.prediction.shown,0);assert.equal(whenPaused.summary.grouping.previews,0);
  assert(whenPaused.retained>=paused);
  check('Capture reasons distinguish foreground, exclusion and pause; repeated state reads are sampled; paused browsing suppresses behavior logs');

  await rpc('UPDATE_SETTINGS',{patch:{tracking:true}});await control.send('Page.bringToFront');await control.send('Page.reload');
  await until(()=>control.eval(()=>!!document.querySelector('#predict-next')),'focus UI');await rpc('CLEAR_DIAGNOSTICS');
  await control.click('#predict-next');await until(()=>control.eval(()=>document.querySelectorAll('.prediction-row').length===2),'local predictions');
  await until(async()=>(await diag()).summary.prediction.shown===1,'actual display acknowledgement');
  await control.click('.prediction-row button');await until(async()=>(await diag()).summary.prediction.acted===1,'successful open logged');
  await rpc('FLUSH_ACTIVITY');const snapshot=await diag();for(let i=0;i<5;i++)await diag();assert.equal((await diag()).retained,snapshot.retained);
  check('Actual prediction display and successful open are distinct, and reading diagnostics does not create visits or log events');

  await control.send('Page.bringToFront');
  async function editor(){await control.click('[data-action="memory-checkpoint"][data-id="'+task.id+'"]');await until(()=>control.eval(()=>!!document.querySelector('#checkpoint-nextStep')),'checkpoint editor');}
  async function complete(){await control.fill('#checkpoint-nextStep','核对');await control.click('#complete-checkpoint-nextStep');await until(()=>control.eval(()=>document.querySelectorAll('.completion-choice').length>0),'completion candidates');}
  async function save(){await control.click('.memory-form button[type="submit"]');await until(()=>control.eval(()=>!document.querySelector('.memory-dialog')?.open),'checkpoint saved');}
  await editor();await complete();await control.click('#complete-accept-checkpoint-nextStep-0');
  assert.equal((await taskFrom(task.id)).checkpoint,null);assert.equal((await diag()).summary.nextStep.saved,0);
  await save();await until(async()=>(await diag()).summary.nextStep.saved===1,'accepted candidate saved');
  task=await taskFrom(task.id);assert.equal(task.checkpoint.nextStep,'核对接口返回值');
  await editor();await complete();await control.click('#complete-accept-checkpoint-nextStep-0');
  await control.fill('#checkpoint-nextStep','核对接口返回值并记录合成测试结果');await save();
  assert.equal((await diag()).summary.nextStep.saved,1);task=await taskFrom(task.id);
  await editor();await complete();await control.click('#complete-accept-checkpoint-nextStep-1');
  await control.click('[data-action="memory-close"]');await until(()=>control.eval(()=>!!document.querySelector('#checkpoint-discard')&&!document.querySelector('.memory-unsaved')?.hidden),'explicit discard prompt');
  await control.click('#checkpoint-discard');assert.equal((await diag()).summary.nextStep.saved,1);
  check('Completion adoption is separate from save; edited text and discarded drafts are not counted as candidate saves',{nextStep:(await diag()).summary.nextStep});

  const proposal=(await rpc('PROPOSE_GROUPS',{semantic:false})).groups.find(group=>group.tabIds.length>=2);assert(proposal);
  await rpc('APPLY_GROUP',{group:{...proposal,tabIds:proposal.tabIds.slice(0,2)}});assert((await rpc('UNDO_GROUP')).restored);assert.equal((await rpc('UNDO_GROUP')).restored,false);
  const groups=(await diag()).summary.grouping;assert.equal(groups.previews,1);assert.equal(groups.applied,1);assert.equal(groups.undone,1);
  check('Grouping preview, actual apply and actual undo are logged; an empty undo is not counted as an action',groups);
  task=await taskFrom(task.id);
  await rpc('PAUSE_TASK',{id:task.id,revision:task.revision,contextRevision:(await rpc('GET_STATE')).work.current.revision});
  await rpc('SET_CURRENT_TASK',{id:task.id,revision:task.revision,contextRevision:(await rpc('GET_STATE')).work.current.revision});
  await rpc('RESTORE_TASK',{id:task.id,revision:task.revision,contextRevision:(await rpc('GET_STATE')).work.current.revision,mode:'page'});
  const focus=(await diag()).summary.focus;assert.equal(focus.paused,1);assert.equal(focus.selected,1);assert.equal(focus.continued,1);
  check('Focus selection, pause and real continuation are logged after successful actions',focus);
  await control.send('Page.bringToFront');

  const exported=await rpc('EXPORT_DIAGNOSTICS'),backup=await rpc('EXPORT_DATA');
  const raw=JSON.stringify(exported);for(const canary of ['CANARY_PRIVATE_NOTES','ESP32','核对接口','127.0.0.1','/fixture/'])assert(!raw.includes(canary),canary);
  assert(!JSON.stringify(backup).includes(exported.events.find(row=>row.traceId)?.traceId||'not-in-backup'));
  assert(!('diagnostics'in backup));assert.equal(exported.summary.api.calls,0);assert.equal(exported.summary.api.inputTokens,null);
  const persisted=await control.eval(async()=>{const {openDiagnosticsStore}=await import(chrome.runtime.getURL('src/diagnostics-store.js'));const store=await openDiagnosticsStore();try{return(await store.snapshot()).events.length;}finally{store.close();}});
  assert(persisted>=exported.events.length);
  check('Logs persist independently, exclude content and credentials, stay out of task backups, and keep unknown API usage unknown',{retained:exported.events.length});

  const persistence=await control.eval(async()=>{
    const {openDiagnosticsStore}=await import(chrome.runtime.getURL('src/diagnostics-store.js'));
    const name='focuence-diagnostics-acceptance-only',now=Date.now();let store=await openDiagnosticsStore({name});const initial=await store.load(now);
    const db=await new Promise((resolve,reject)=>{const req=indexedDB.open(name);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
    await new Promise((resolve,reject)=>{const tx=db.transaction('events','readwrite'),events=tx.objectStore('events');
      for(let i=0;i<20;i++)events.put({id:crypto.randomUUID(),at:now-7*86400000-1-i,kind:'ai.request'});
      for(let i=0;i<5010;i++)events.put({id:crypto.randomUUID(),at:now-500000+i,kind:'ai.request',outcome:'success',elapsedMs:i%500});
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
    await store.load(now);const bounded=await store.snapshot(now);if(bounded.events.length!==5000||bounded.control.capacityTrimmed!==10)throw Error('Retention/capacity pruning failed');
    const timings=[];for(let i=0;i<20;i++){const started=performance.now();await store.append({id:crypto.randomUUID(),at:now,kind:'ai.request',outcome:'success'},initial.revision,now);timings.push(performance.now()-started);}
    const readAt=performance.now();const full=await store.snapshot(now);const readMs=performance.now()-readAt;
    await store.configure(false,now);store.close();store=await openDiagnosticsStore({name});
    const disabled=await store.load(now);if(disabled.enabled||await store.append({id:crypto.randomUUID(),at:now,kind:'ai.request'},initial.revision,now))throw Error('Disabled state did not persist');
    await store.clear({now});if((await store.snapshot(now)).events.length)throw Error('Clear failed');
    await store.clear({reset:true,now});if(!(await store.load(now)).enabled)throw Error('Reset failed');store.close();
    await new Promise((resolve,reject)=>{const req=indexedDB.deleteDatabase(name);req.onsuccess=resolve;req.onerror=()=>reject(req.error);});
    timings.sort((a,b)=>a-b);return{retained:full.events.length,appendSamples:timings.length,appendP50Ms:(timings[9]+timings[10])/2,appendP95Ms:timings[18],read5000Ms:readMs};
  });
  check('Native log database enforces seven-day expiry, 5,000 rows, durable disable and safe clear/reset',persistence);

  await control.click('#nav-settings');await until(()=>control.eval(()=>!!document.querySelector('#diagnostics-status')&&document.querySelector('#diagnostics-status').textContent.includes('已开启')),'diagnostics settings');
  await browser.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads,eventsEnabled:true});
  await control.click('#diagnostics-export');
  const download=await until(()=>readdirSync(downloads).find(name=>name.endsWith('.json')),'diagnostics download');
  const downloaded=JSON.parse(readFileSync(join(downloads,download),'utf8'));assert(Array.isArray(downloaded.events));assert(!JSON.stringify(downloaded).includes('CANARY_PRIVATE_NOTES'));
  check('Settings export downloads a real content-free JSON artifact');
  await until(()=>control.eval(()=>!document.getElementById('toast-region').textContent.trim()),'transient notification settled',8000);
  for(const width of [320,360,1440]){
    await control.size(width,1100);await control.eval(()=>document.getElementById('diagnostics-section').scrollIntoView({block:'start'}));
    const audit=await control.eval(()=>{const heading=document.querySelector('#diagnostics-section h2'),r=heading.getBoundingClientRect();return{overflow:document.documentElement.scrollWidth>innerWidth,headingVisible:heading.contains(document.elementFromPoint(r.x+5,r.y+5)),duplicateIds:[...document.querySelectorAll('[id]')].map(node=>node.id).filter((id,i,all)=>all.indexOf(id)!==i),width:innerWidth};});
    assert(!audit.overflow,JSON.stringify(audit));assert.deepEqual(audit.duplicateIds,[]);
    assert(audit.headingVisible,'diagnostics heading is not covered by sticky settings');
    if(width!==360){const clip=await control.eval(()=>{const r=document.getElementById('diagnostics-section').getBoundingClientRect();return{x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1};});
      const image=await control.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip});writeFileSync(env.out+'/screenshots/diagnostics-'+width+'.png',Buffer.from(image.data,'base64'));}
    check('Diagnostics UI '+width+'px remains readable and has no overflow or duplicate IDs',audit);
  }
  await control.click('#diagnostics-enabled');await until(async()=>!(await diag()).enabled,'logging disabled');
  await until(()=>control.eval(()=>!document.getElementById('diagnostics-enabled').disabled&&document.activeElement?.id==='diagnostics-enabled'),'toggle keyboard focus restored');
  const off=(await diag()).retained;await rpc('PREDICT_NEXT',{clientId:'disabled-log'});await rpc('FLUSH_ACTIVITY');assert.equal((await diag()).retained,off);
  await control.click('#diagnostics-enabled');await until(async()=>(await diag()).enabled,'logging enabled');
  const tasksBefore=(await rpc('EXPORT_DATA')).tasks;
  await control.click('#diagnostics-clear');await control.click('#diagnostics-clear-confirm');await until(async()=>(await diag()).retained===0,'logs cleared');
  assert.deepEqual((await rpc('EXPORT_DATA')).tasks,tasksBefore);
  assert.equal((await rpc('GET_AI_SETTINGS')).hasKey,false);
  check('Settings toggle stops new writes; explicit log clear preserves tasks and AI configuration');
  await rpc('CLEAR_HISTORY');assert.equal((await diag()).retained,0);
  await rpc('SET_DIAGNOSTICS',{enabled:false});await rpc('CLEAR_ALL');assert.equal((await diag()).enabled,true);assert.equal((await diag()).retained,0);
  check('Clear history clears diagnostics; clear all restores the log default without resurrecting old events');
  await control.send('Page.reload');await until(()=>control.eval(()=>!!document.querySelector('#nav-tasks')),'empty workspace loaded');await control.click('#nav-tasks');
  await rpc('CLEAR_DIAGNOSTICS');await control.click('#predict-next');await until(async()=>(await diag()).summary.generation.requests===1,'empty result generated');
  assert.equal((await diag()).summary.prediction.shown,0);assert.equal(await control.eval(()=>document.querySelectorAll('.prediction-row').length),0);
  check('An empty result is visible as an empty state, without a false candidate impression');
  const errors=browser.events.filter(item=>item.method==='Runtime.exceptionThrown'&&item.params?.exceptionDetails?.url?.startsWith('chrome-extension://'+env.extensionId));assert.deepEqual(errors,[]);
  check('No uncaught extension errors');
}catch(error){report.errors.push(error.stack);console.error(error.stack);process.exitCode=1;}
finally{writeFileSync(env.out+'/diagnostics-native.json',JSON.stringify(report,null,2)+'\n');await env.close();rmSync(downloads,{recursive:true,force:true});}
