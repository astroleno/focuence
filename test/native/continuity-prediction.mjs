import {setup,until,sleep} from './cdp.mjs';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
const env=await setup({out:process.argv.find(value=>value.startsWith('--out='))?.slice(6)||'docs/reviews/v2.6'});
const {control,rpc,browser,windowId,base,extensionId}=env;
const report={environment:'Isolated Chrome for Testing, actual MV3 service worker, native tabs/groups/IndexedDB, synthetic pages only. No optional AI host permission is silently granted.',checks:[],errors:[]};
const check=(name,detail={})=>{report.checks.push({name,status:'passed',detail});console.log(name);};
try{
  await rpc('CLEAR_ALL');await rpc('UPDATE_SETTINGS',{patch:{tracking:false,semantic:false}});
  const ids=await control.eval(async({base,windowId})=>{
    const ids=[];for(let i=0;i<6;i++)ids.push((await chrome.tabs.create({windowId,url:base+'/fixture/ESP32-I2S-'+i,active:false})).id);return ids;
  },{base,windowId});
  await until(async()=>(await rpc('LIST_WORKSPACE_TABS')).tabs.length===6,'6 synthetic tabs');
  await until(async()=>(await rpc('GET_STATE')).tabs.every(tab=>tab.title.includes('ESP32')),'titles loaded');
  const task=await rpc('SAVE_TASK',{tabIds:ids.slice(0,2),name:'ESP32 接口核对',goal:'核对接口失败路径'});
  await control.eval(ids=>chrome.tabs.remove(ids),ids.slice(0,2));
  for(const tracking of [false,true]){
    await rpc('UPDATE_SETTINGS',{patch:{tracking}});
    const job=await rpc('SEARCH_MEMORY',{query:'',scope:'tasks',clientId:'continuity'});
    const pages=job.results.filter(item=>item.kind==='page');assert.equal(pages.length,2);
    await rpc('OPEN_MEMORY_RESULT',{jobId:job.id,entryId:pages[0].id});
    await sleep(100);await rpc('FLUSH_ACTIVITY');const state=await rpc('GET_STATE');
    assert.equal(state.work.epoch,job.sourceEpoch);
    const page=await rpc('GET_SEARCH_RESULTS',{jobId:job.id});assert.equal(page.resultTotal,job.resultTotal);
    const evidence=await rpc('GET_MEMORY_EVIDENCE',{jobId:job.id,entryId:pages[0].id});assert(evidence.items.length);
    await rpc('OPEN_MEMORY_RESULT',{jobId:job.id,entryId:pages[1].id});
    assert.equal((await rpc('GET_SEARCH_RESULTS',{jobId:job.id})).status,'done');
    check('Find → open → checkpoint/state → sources → open another result, tracking '+tracking,{total:page.resultTotal,sourceEpoch:job.sourceEpoch});
  }
  const job=await rpc('SEARCH_MEMORY',{query:'ESP32',scope:'windows',clientId:'pagination'});
  assert.equal(job.resultTotal,6);
  const extra=await control.eval(({base,windowId})=>chrome.tabs.create({windowId,url:base+'/fixture/ESP32-extra',active:false}),{base,windowId});
  await rpc('GET_STATE');const last=await rpc('GET_SEARCH_RESULTS',{jobId:job.id,offset:4,limit:2});assert.equal(last.resultTotal,6);assert.equal(last.results.length,2);
  check('Native unrelated tab creation and activity leave captured search scope and pagination intact',{total:last.resultTotal,lastPage:last.results.length});
  await control.eval(id=>chrome.tabs.remove(id),extra.id);
  await control.eval(id=>chrome.tabs.update(id,{url:'chrome://newtab/'}),ids[2]);
  await until(()=>control.eval(async id=>(await chrome.tabs.get(id)).url.startsWith('chrome://'),ids[2]),'original page navigated');
  await assert.rejects(rpc('GET_SEARCH_RESULTS',{jobId:job.id}),{code:'STALE_SUGGESTION'});
  check('A disappeared original window document rejects its old search result');
  let proposal=(await rpc('PROPOSE_GROUPS',{semantic:false})).groups.find(item=>item.tabIds.length>=2);assert(proposal,'synthetic ESP32 rules group');
  const applied=await rpc('APPLY_GROUP',{group:{...proposal,tabIds:proposal.tabIds.slice(0,2)}});assert.equal(applied.count,2);
  assert((await rpc('UNDO_GROUP')).restored);
  check('Native grouping supports member selection, apply and undo',{members:applied.count});
  proposal=(await rpc('PROPOSE_GROUPS',{semantic:false})).groups.find(item=>item.tabIds.length>=2);assert(proposal);
  await control.eval(id=>chrome.tabs.update(id,{pinned:true}),proposal.tabIds[0]);
  await assert.rejects(rpc('APPLY_GROUP',{group:proposal}),{code:'STALE_PROPOSAL'});
  check('Native grouping still rejects a member changed after preview');
  await control.eval(async()=>{const ids=(await chrome.tabs.query({})).filter(tab=>tab.url?.includes('/fixture/')).map(tab=>tab.id);if(ids.length)await chrome.tabs.remove(ids);});
  await rpc('SET_CURRENT_TASK',{id:task.id,revision:task.revision,contextRevision:(await rpc('GET_STATE')).work.current.revision});
  const prediction=await rpc('PREDICT_NEXT',{clientId:'native'});assert.equal(prediction.source,'local');assert(prediction.candidates.length);
  const before=await rpc('EXPORT_DATA');const completion=await rpc('COMPLETE_TEXT',{clientId:'native-text',field:'nextStep',taskId:task.id,revision:task.revision,text:'核对'});
  assert.equal(completion.source,'local');assert(completion.candidates.includes('核对接口失败路径'));
  assert.deepEqual((await rpc('EXPORT_DATA')).tasks,before.tasks);
  check('Unconfigured AI returns real local next resources and prefix completions without editing a task');
  await assert.rejects(rpc('SAVE_AI_SETTINGS',{config:{enabled:true,baseUrl:'https://ai-permission.fixture.test/v1',protocol:'openai',model:'test',apiKey:'synthetic-only-key'}}),{code:'AI_PERMISSION'});
  assert.equal((await rpc('GET_AI_SETTINGS')).hasKey,false);
  check('An actual missing optional host permission blocks enabling API requests');
  await control.send('Page.bringToFront');await control.eval(()=>location.hash='tasks');await control.send('Page.reload');await until(()=>control.eval(()=>!!document.querySelector('#predict-next')),'next UI');
  console.log('Native prediction UI ready');
  await control.click('#predict-next');await until(()=>control.eval(()=>!!document.querySelector('.prediction-row')),'local next candidates');
  await control.screenshot(env.out+'/screenshots/native-next.png');
  await control.click('[data-action="memory-checkpoint"][data-id="'+task.id+'"]');
  await control.fill('#checkpoint-nextStep','核对');await control.click('#complete-checkpoint-nextStep');
  await until(()=>control.eval(()=>!!document.querySelector('#complete-accept-checkpoint-nextStep-0')),'completion candidate');
  assert.equal(await control.eval(()=>document.querySelector('#checkpoint-nextStep').value),'核对');
  await control.click('#complete-accept-checkpoint-nextStep-0');assert.equal(await control.eval(()=>document.querySelector('#checkpoint-nextStep').value),'核对接口失败路径');
  assert.equal((await rpc('EXPORT_DATA')).tasks.find(item=>item.id===task.id).checkpoint,null);
  check('Native checkpoint completion waits for explicit acceptance and still requires explicit save');
  await control.screenshot(env.out+'/screenshots/native-completion.png');
  await control.eval(()=>{
    const original=chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage=async message=>{const result=await original(message);if(message.type==='COMPLETE_TEXT'&&globalThis.qaDelayCompletion)await new Promise(resolve=>globalThis.qaReleaseCompletion=resolve);return result;};
    globalThis.qaDelayCompletion=true;
  });
  await control.fill('#checkpoint-nextStep','核对');await control.click('#complete-checkpoint-nextStep');
  await until(()=>control.eval(()=>typeof globalThis.qaReleaseCompletion==='function'),'delayed completion');
  await control.fill('#checkpoint-nextStep','自己写的下一步');await control.eval(()=>{qaReleaseCompletion();globalThis.qaReleaseCompletion=null;});
  assert.equal(await control.eval(()=>document.querySelector('#checkpoint-nextStep').value),'自己写的下一步');
  assert.equal(await control.eval(()=>document.querySelectorAll('.completion-choice').length),0);
  check('A delayed completion does not replace newer typed text');
  await control.fill('#checkpoint-nextStep','');await control.click('#complete-checkpoint-nextStep');
  await until(()=>control.eval(()=>typeof globalThis.qaReleaseCompletion==='function'),'second delayed completion');
  await control.click('[data-action="memory-close"]');await until(()=>control.eval(()=>!document.querySelector('.memory-dialog')?.open),'editor closed');
  await control.click('[data-action="memory-checkpoint"][data-id="'+task.id+'"]');
  assert.equal(await control.eval(()=>document.querySelector('#complete-checkpoint-nextStep').disabled),false);
  await control.eval(()=>{qaReleaseCompletion();globalThis.qaReleaseCompletion=null;globalThis.qaDelayCompletion=false;});
  assert.equal(await control.eval(()=>document.querySelectorAll('.completion-choice').length),0);
  check('Closing and reopening a checkpoint drops the previous request and leaves completion usable');
  await control.click('[data-action="memory-close"]');
  await control.click('#nav-settings');await until(()=>control.eval(()=>!!document.querySelector('#ai-save')),'AI settings UI');
  await control.fill('#ai-base-url','https://ai-permission.fixture.test/v1');await control.fill('#ai-model','synthetic-model');await control.fill('#ai-key','synthetic-private-key');
  await control.click('#ai-save');await until(async()=>(await rpc('GET_AI_SETTINGS')).hasKey,'disabled provider saved without a host grant');
  await until(()=>control.eval(()=>document.querySelector('#ai-key')?.value===''),'password field cleared');
  const aiSettings=await rpc('GET_AI_SETTINGS'),stateWithAI=await rpc('GET_STATE'),backupWithAI=await rpc('EXPORT_DATA');
  for(const value of [aiSettings,stateWithAI,backupWithAI])assert(!JSON.stringify(value).includes('synthetic-private-key'));
  assert(!('ai'in backupWithAI));assert(!('apiKey'in aiSettings));
  await control.eval(()=>document.querySelector('.ai-settings').scrollIntoView({block:'start'}));
  await control.screenshot(env.out+'/screenshots/native-ai-settings.png');
  await rpc('CLEAR_HISTORY');assert((await rpc('GET_AI_SETTINGS')).hasKey);
  await rpc('CLEAR_AI_SETTINGS');assert.equal((await rpc('GET_AI_SETTINGS')).hasKey,false);
  check('Native AI settings save locally, clear the password field and exclude credentials from state/backups; clear history preserves configuration');
  for(const width of [320,360,1440]){
    const page=await browser.page('chrome-extension://'+extensionId+'/'+(width<400?'panel':'app')+'/index.html?windowId='+windowId+'#tasks',width,850);
    await page.send('Page.bringToFront');await until(()=>page.eval(()=>!!document.querySelector('#predict-next')),'responsive prediction');
    const audit=await page.eval(()=>{const ids=[...document.querySelectorAll('[id]')].map(node=>node.id);return{width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,duplicates:ids.filter((id,index)=>ids.indexOf(id)!==index),grouping:!!document.querySelector('#task-grouping')};});
    assert(!audit.overflow);assert.deepEqual(audit.duplicates,[]);assert(audit.grouping);check('Native UI '+width+'px keeps focus/grouping/prediction accessible',audit);
    await page.screenshot(env.out+'/screenshots/native-focus-'+width+'.png');
    if(width===320){
      await page.click('#task-grouping');
      try{await until(()=>page.eval(()=>document.activeElement?.id==='grouping-title'),'grouping handoff focus');}
      catch(error){console.log('GROUPING_DIAGNOSTIC',await page.eval(()=>({url:location.href,active:document.activeElement?.outerHTML,group:document.querySelector('#grouping-title')?.outerHTML,mode:document.querySelector('#pages-mode-groups')?.getAttribute('aria-pressed'),toast:document.querySelector('#toast-region')?.innerText})));throw error;}
      check('The focus page grouping shortcut opens the real grouping area with keyboard focus');
    }
    await page.close();
  }
  const errors=browser.events.filter(item=>item.method==='Runtime.exceptionThrown'&&item.params?.exceptionDetails?.url?.startsWith('chrome-extension://'+extensionId));
  assert.deepEqual(errors,[]);check('No uncaught extension errors');
}catch(error){report.errors.push(error.stack);console.error(error.stack);process.exitCode=1;}
finally{writeFileSync(env.out+'/native.json',JSON.stringify(report,null,2)+'\n');await env.close();}
