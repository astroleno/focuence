import {setup,until} from './cdp.mjs';import assert from 'node:assert/strict';import {writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const out=process.argv.find(value=>value.startsWith('--out='))?.slice(6)||'docs/reviews/v2.4',env=await setup({out}),{control,rpc}=env;
const report={environment:'Actual bundled q8 BGE and native IndexedDB; 1,000 synthetic saved resource URLs across 100 tasks. Single-run timings, not a benchmark guarantee.',checks:[],errors:[]};
function residentMemory(){const records=execFileSync('ps',['-Ao','pid=,ppid=,rss='],{encoding:'utf8'}).trim().split('\n').map(line=>line.trim().split(/\s+/).map(Number)),ids=new Set([env.browser.proc.pid]);let added=true;while(added){added=false;for(const [pid,ppid]of records)if(ids.has(ppid)&&!ids.has(pid)){ids.add(pid);added=true;}}return{processes:ids.size,rssKiB:records.filter(([pid])=>ids.has(pid)).reduce((total,row)=>total+row[2],0)};}
try{
 await rpc('CLEAR_ALL');await rpc('UPDATE_SETTINGS',{patch:{tracking:false,semantic:true}});
 const backup=await rpc('EXPORT_DATA');backup.tasks=Array.from({length:100},(_,i)=>({id:'perf-'+i,name:'研究资料 '+i,goal:'整理本机浏览器材料',createdAt:Date.now(),updatedAt:Date.now(),pages:Array.from({length:10},(_,j)=>({url:'https://perf.fixture.test/'+i+'/'+j,title:i===99&&j===9?'网页端本地模型与向量检索':'研究页面 '+i+' '+j}))}));
 const plan=await rpc('PREVIEW_IMPORT',{data:backup});await rpc('APPLY_IMPORT',{token:plan.token});
 async function run(clientId){const start=Date.now();let job=await rpc('SEARCH_MEMORY',{query:'网页端本地模型与向量检索',scope:'tasks',clientId}),initial=job.results.length;
  const docs=job.total;let steps=0;while(['queued','running'].includes(job.status)){job=await rpc('GET_SEARCH_STATUS',{jobId:job.id});steps++;}
  assert.equal(job.status,'done');assert.equal(job.completed,docs);assert(docs>=1100);assert(job.results.some(item=>item.title.includes('网页端本地模型')));
  return{ms:Date.now()-start,documents:docs,completed:job.completed,steps,initial,results:job.results.map(item=>({title:item.title,score:item.score,method:item.method}))};}
 report.memoryBefore=residentMemory();const first=await run('first');report.memoryAfterFirst=residentMemory();const cached=await run('cached');report.memoryAfterCached=residentMemory();report.checks.push({name:'Full 1,000-resource semantic coverage, cold and cached',status:'passed',first,cached});console.log('1000 resources: '+first.ms+'ms first / '+cached.ms+'ms cache');
 let cancelled=await rpc('SEARCH_MEMORY',{query:'停止测试的新查询',scope:'tasks',clientId:'cancel'});cancelled=await rpc('GET_SEARCH_STATUS',{jobId:cancelled.id});assert.equal(cancelled.completed,24);const start=Date.now();cancelled=await rpc('CANCEL_SEARCH',{jobId:cancelled.id});assert.equal(cancelled.status,'cancelled');const late=await rpc('GET_SEARCH_STATUS',{jobId:cancelled.id});assert.equal(late.completed,24);report.checks.push({name:'Cancellation after one short model batch leaves the remaining corpus unprocessed',status:'passed',ms:Date.now()-start,completed:late.completed,total:late.total});
 await control.send('Performance.enable');const memory=await control.send('Performance.getMetrics');report.controlPageMemory=memory.metrics.filter(item=>/Heap|Documents|Nodes/.test(item.name));
 await control.eval(()=>location.hash='search');await until(()=>control.eval(()=>!!document.querySelector('#memory-query')),'search form');await control.fill('#memory-query','昨天');await control.click('#memory-search-form button[type="submit"]');await until(()=>control.eval(()=>document.querySelector('.memory-search-status')?.textContent.includes('找到 0 条')),'date-only empty result');assert(await control.eval(()=>!!document.querySelector('#memory-filter-from').value));
 await control.fill('#memory-filter-from','2026-10-24');await control.fill('#memory-filter-until','2026-10-23');await control.click('#memory-search-form button[type="submit"]');await until(()=>control.eval(()=>document.querySelector('.memory-search-status')?.textContent.includes('开始日期不能晚于')),'invalid date explanation');assert.equal(await control.eval(()=>document.querySelector('#memory-filter-until').value),'2026-10-23');
 report.checks.push({name:'Actual UI interprets date-only search and preserves invalid filter drafts with an actionable error',status:'passed'});await control.screenshot(env.out+'/screenshots/search-filter-error.png');
 await control.click('[data-action="memory-clear-filters"]');
 await control.fill('#memory-scope','tasks');
 await control.fill('#memory-query','网页端本地模型与向量检索');
 await control.eval(()=>{
   const original=chrome.runtime.sendMessage.bind(chrome.runtime);
   const check=globalThis.searchAcceptance={steps:[],reads:0};
   chrome.runtime.sendMessage=async message=>{
     if(message.type==='GET_STATE')check.reads++;
     const result=await original(message);
     if(message.type==='GET_SEARCH_STATUS'&&result?.data&&check.steps.length<2){
       check.steps.push(result.data.completed);
       await new Promise(resolve=>{check.release=resolve;});
     }
     return result;
   };
 });
 await control.click('#memory-search-submit');
 await until(()=>control.eval(()=>searchAcceptance.steps[0]===24&&!!searchAcceptance.release),'real first batch waiting to paint');
 const keyword=await control.eval(()=>{
   const check=searchAcceptance;
   const input=check.input=document.querySelector('#memory-query');
   check.form=input.form;
   check.first=document.querySelector('.memory-results article');
   check.live=document.querySelector('.memory-search [role="status"]');
   check.announcement=check.live.textContent;
   window.scrollTo(0,Math.min(80,document.scrollingElement.scrollHeight-innerHeight));
   check.top=window.scrollY;
   input.focus({preventScroll:true});
   input.value='正在输入的中文草稿';
   input.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true,inputType:'insertCompositionText'}));
   input.setSelectionRange(2,6,'backward');
   input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
   check.release();
   check.release=null;
   return check.first?.innerText;
 });
 assert(keyword?.includes('关键词匹配'));
 await until(()=>control.eval(()=>searchAcceptance.steps[1]===48&&!!searchAcceptance.release),'real second batch waiting to paint');
 await until(()=>control.eval(()=>document.querySelector('.memory-search-status').textContent.includes('已分析 24 /')),'real progress painted');
 const retained=await control.eval(()=>{
   const check=searchAcceptance,input=document.querySelector('#memory-query');
   return {form:input.form===check.form,focused:input===check.input&&document.activeElement===input,row:check.first===document.querySelector('.memory-results article'),
     value:input.value,selection:[input.selectionStart,input.selectionEnd,input.selectionDirection],scroll:window.scrollY===check.top,
     announcement:check.live.textContent===check.announcement,stateReads:check.reads};
 });
 assert.deepEqual(retained,{form:true,focused:true,row:true,value:'正在输入的中文草稿',selection:[2,6,'backward'],scroll:true,announcement:true,stateReads:0});
 await control.eval(()=>document.querySelector('#memory-query').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));
 await control.click('.memory-results article:first-child [data-action="memory-result-evidence"]');
 await until(()=>control.eval(()=>!!document.querySelector('.memory-dialog[open]')),'initial keyword evidence remains available');
 await control.click('.memory-dialog[open] [data-action="memory-close"]');
 await control.click('[data-action="memory-cancel-search"]');
 await until(()=>control.eval(()=>document.querySelector('.memory-search-status').textContent.includes('已停止语义分析')),'cancelled status painted');
 await control.eval(()=>{searchAcceptance.release();searchAcceptance.release=null;});
 await control.eval(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert(await control.eval(()=>document.querySelector('.memory-search-status').textContent.includes('已停止语义分析')));
 assert(await control.eval(()=>searchAcceptance.first===document.querySelector('.memory-results article')));
 assert.equal(await control.eval(()=>document.querySelector('#memory-query').value),'正在输入的中文草稿');
 report.checks.push({name:'Actual 24/48 BGE batches preserve form identity, draft selection, scroll, existing evidence and quiet live feedback; a late response cannot undo cancellation',status:'passed',steps:[24,48],retained});
 await control.fill('#memory-query','研究');
 await control.eval(()=>{
   const original=chrome.runtime.sendMessage.bind(chrome.runtime);
   const qa=globalThis.completionAcceptance={
     calls:0,input:document.querySelector('#memory-query'),hold:true,
     configured:{enabled:true,baseUrl:'https://synthetic.invalid/v1',protocol:'openai',model:'test-only',hasKey:true},
   };
   chrome.runtime.sendMessage=async message=>{
     const result=await original(message);
     if(message.type==='COMPLETE_TEXT'){
       qa.calls++;
       if(qa.hold)await new Promise(resolve=>{qa.release=resolve;});
     }
     if(qa.active&&message.type==='GET_AI_SETTINGS')return {...result,data:qa.configured};
     if(qa.active&&message.type==='GET_STATE')return {...result,data:{...result.data,ai:qa.configured}};
     return result;
   };
 });
 await control.click('#complete-memory-query');
 await until(()=>control.eval(()=>!!completionAcceptance.release),'actual local completion response held');
 await control.eval(()=>{
   completionAcceptance.active=true;
   const summary=document.querySelector('.memory-filters > summary');
   summary.focus();
   document.querySelector('.topbar [data-action="refresh"]').click();
 });
 await until(()=>control.eval(()=>document.querySelector('#completion-memory-query').textContent.includes('点击后发送')),'same-view AI disclosure refreshed');
 assert(await control.eval(()=>document.activeElement===document.querySelector('.memory-filters > summary')));
 await control.eval(()=>{completionAcceptance.release();completionAcceptance.release=null;completionAcceptance.hold=false;});
 await control.eval(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert(await control.eval(()=>completionAcceptance.input===document.querySelector('#memory-query')&&!document.querySelector('.completion-choice')));
 await control.eval(()=>{completionAcceptance.active=false;document.querySelector('.topbar [data-action="refresh"]').click();});
 await until(()=>control.eval(()=>document.querySelector('#completion-memory-query').textContent.includes('本机已保存文字')),'same-view local disclosure restored');
 await control.eval(()=>{completionAcceptance.active=true;});
 await control.click('#complete-memory-query');
 await until(()=>control.eval(()=>document.querySelector('#completion-memory-query').textContent.includes('点击后发送')),'stale local disclosure blocks request and refreshes');
 assert.equal(await control.eval(()=>completionAcceptance.calls),1);
 report.checks.push({name:'Completion refresh invalidates a real pending local response, preserves search/summary focus, and blocks text submission when the AI disclosure is stale',status:'passed'});
}catch(error){report.errors.push(error.stack);console.error(error.stack);process.exitCode=1;}
finally{writeFileSync(env.out+'/performance.json',JSON.stringify(report,null,2));await env.close();}
