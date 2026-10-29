import {setup,until,sleep} from './cdp.mjs';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';

const env=await setup({out:process.argv.find(value=>value.startsWith('--out='))?.slice(6)||'docs/reviews/v2.6.1'});
const {control,rpc,windowId,base,browser}=env;
const report={environment:'Isolated Chrome for Testing; real MV3, bundled BGE, native tabs/groups/IndexedDB. Foreground means the browser API state in this isolated test, not an Ego OS-focus acceptance.',checks:[],errors:[]};
const check=(name,detail={})=>{report.checks.push({name,status:'passed',detail});console.log(name);};
try{
  await rpc('CLEAR_ALL');await rpc('UPDATE_SETTINGS',{patch:{tracking:true,semantic:true}});
  const titles=['ESP32 I2S 麦克风音频采集指南','ESP32 I2S 扬声器音频播放与错误处理','Chrome extension 标签页分组与键盘焦点管理 API','产品摄影自然光与构图参考'];
  const ids=await control.eval(async({base,windowId,titles})=>{
    const result=[];for(const title of titles)result.push((await chrome.tabs.create({windowId,url:base+'/fixture/'+encodeURIComponent(title),active:false})).id);return result;
  },{base,windowId,titles});
  await until(async()=>{const tabs=(await rpc('GET_STATE')).tabs;return titles.every(title=>tabs.some(tab=>tab.title===title));},'fixture metadata loaded');
  let task=await rpc('SAVE_TASK',{name:'验收 · ESP32 音频链路',goal:'验证 ESP32 I2S 麦克风音频采集和扬声器播放，检查失败返回值与音频缓冲。',tabIds:[ids[0]]});
  await rpc('SAVE_TASK',{name:'验收 · 浏览器分组',goal:'核对 Chrome 标签页分组和键盘焦点管理 API。',tabIds:[ids[2]]});
  await rpc('SAVE_TASK',{name:'验收 · 产品摄影',goal:'整理自然光和构图参考。',tabIds:[ids[3]]});
  task=await rpc('SAVE_CHECKPOINT',{id:task.id,revision:task.revision,checkpoint:{progress:'已核对采样率与接线。',blocker:'尚未核对失败返回值和播放输出。',nextStep:'核对 I2S 麦克风采集失败路径和扬声器播放输出',pageId:task.pages[0].pageId}});
  await rpc('SET_CURRENT_TASK',{id:task.id,revision:task.revision,contextRevision:(await rpc('GET_STATE')).work.current.revision});
  let job=await rpc('SUGGEST_TASK_PAGES',{id:task.id,revision:task.revision,contextRevision:(await rpc('GET_STATE')).work.current.revision,clientId:'prediction-relevance'});
  while(['queued','running'].includes(job.status))job=await rpc('GET_SEARCH_STATUS',{jobId:job.id});
  assert.equal(job.status,'done',JSON.stringify(job));
  const inferred=job.candidates.find(item=>item.tabId===ids[1]);assert(inferred&&!inferred.related);assert.equal(inferred.method,'semantic');
  const before=await rpc('EXPORT_DATA'),started=Date.now(),prediction=await rpc('PREDICT_NEXT',{clientId:'native-relevance'});
  assert.equal(prediction.source,'local');assert.equal(prediction.candidates.length,2);
  assert.deepEqual(new Set(prediction.candidates.map(item=>item.title)),new Set(titles.slice(0,2)));
  assert.equal(prediction.candidates[0].method,'checkpoint');
  assert(prediction.candidates.some(item=>item.title===titles[1]&&item.method==='semantic'&&item.inferred));
  const after=await rpc('EXPORT_DATA');assert.deepEqual(after.tasks,before.tasks);assert.deepEqual(after.relations,before.relations);assert.deepEqual(after.segments,before.segments);
  check('Real BGE association reaches local next prediction before manual confirmation, with no unrelated padding or persistent edits',{elapsedMs:Date.now()-started,associationScore:inferred.score,candidates:prediction.candidates.map(({title,method,inferred})=>({title,method,inferred}))});
  await control.send('Page.bringToFront');await control.click('#nav-tasks');await control.click('#predict-next');
  await until(()=>control.eval(()=>document.querySelectorAll('.prediction-row').length===2),'two focused predictions');
  assert((await control.eval(()=>document.querySelector('#next-prediction').innerText)).includes('语义关联 · 尚未确认'));
  await control.eval(()=>document.querySelector('#next-prediction').scrollIntoView({block:'start'}));
  await control.screenshot(env.out+'/screenshots/native-relevant-next.png');
  check('Prediction UI distinguishes the confirmed continuation page from an inferred semantic relation');

  await control.eval(async id=>{await chrome.windows.update((await chrome.tabs.get(id)).windowId,{focused:true});await chrome.tabs.update(id,{active:true});},ids[0]);
  await rpc('FLUSH_ACTIVITY');await sleep(1600);await rpc('FLUSH_ACTIVITY');
  await control.eval(id=>chrome.tabs.update(id,{active:true}),ids[2]);await rpc('FLUSH_ACTIVITY');await sleep(1600);await rpc('FLUSH_ACTIVITY');
  const observed=await rpc('GET_STATE'),visits=observed.segments.filter(item=>ids.includes(item.tabId)&&item.status==='active'&&item.foregroundMs>=1000);
  const edge=observed.transitions.find(item=>item.from==='ESP32'&&item.to==='浏览器扩展');
  assert(visits.some(item=>item.tabId===ids[0]));assert(visits.some(item=>item.tabId===ids[2]));assert(edge&&edge.count>=1);
  check('Actual tab activation and elapsed time produce foreground visits and an observed topic transition',{visits:visits.map(({title,foregroundMs})=>({title,foregroundMs})),edge:{from:edge.from,to:edge.to,count:edge.count}});
  await control.send('Page.bringToFront');await control.click('#nav-map');
  await until(()=>control.eval(()=>!!document.querySelector('[data-action="select-edge"][data-from="ESP32"][data-to="浏览器扩展"]')),'observed map relation');
  await control.click('.graph-node[data-tag="ESP32"]');
  await control.click('.next-link[data-from="ESP32"][data-to="浏览器扩展"]');
  await until(()=>control.eval(()=>!!document.querySelector('.edge-example')),'map evidence');
  assert((await control.eval(()=>document.querySelector('.edge-examples').innerText)).includes(titles[0]));
  await control.screenshot(env.out+'/screenshots/native-observed-map.png');
  await control.click('[data-action="relation-timeline"]');
  await until(()=>control.eval(()=>!!document.querySelector('[data-action="return-map-relation"]')),'source path handoff');
  await control.click('[data-action="return-map-relation"]');
  await until(()=>control.eval(()=>!!document.querySelector('.selected-relation')),'return to map selection');
  await control.click('#nav-tasks');
  await until(()=>control.eval(()=>!!document.querySelector('#task-grouping')),'return to focus');
  assert.equal((await rpc('GET_STATE')).work.current.taskId,task.id);
  check('Map → real page/time evidence → path → selected map relation → current focus preserves intent');
  await control.eval(id=>chrome.tabs.update(id,{url:'chrome://newtab/'}),ids[1]);
  await until(()=>control.eval(async id=>(await chrome.tabs.get(id)).url==='chrome://newtab/',ids[1]),'semantic candidate navigated');
  const old=prediction.candidates.find(item=>item.title===titles[1]);
  await assert.rejects(rpc('OPEN_NEXT_SUGGESTION',{token:prediction.token,id:old.id}),{code:'STALE_PREDICTION'});
  check('Navigation after a semantic prediction blocks its old open action');
  const errors=browser.events.filter(item=>item.method==='Runtime.exceptionThrown'&&item.params?.exceptionDetails?.url?.startsWith('chrome-extension://'+env.extensionId));
  assert.deepEqual(errors,[]);check('No uncaught extension errors');
}catch(error){report.errors.push(error.stack);console.error(error.stack);process.exitCode=1;}
finally{writeFileSync(env.out+'/prediction-native.json',JSON.stringify(report,null,2)+'\n');await env.close();}
