import test from 'node:test';
import assert from 'node:assert/strict';
import {createPredictions,nextCandidates,localCompletions,completionChoices} from '../src/prediction.js';
import {pageIdForUrl} from '../src/text.js';

function fixture(){
  const url='https://docs.test/interface?search=private',pageId=pageIdForUrl(url);
  const state={tasks:[{id:'a',revision:0,name:'浏览器分组',goal:'核对接口',notes:'PRIVATE_NOTES',status:'active',pages:[{pageId,url,title:'接口文档',tags:['浏览器']}],checkpoint:{progress:'已确认调用方式',nextStep:'核对接口失败路径'}},
    {id:'b',revision:0,name:'分组接口测试',goal:'核对分组接口与撤销',status:'active',pages:[]}],work:{current:{taskId:'a',revision:0},relations:[]},suggestions:[]};
  let epoch=0,blocked=false,generated=null,output={suggestions:[{id:'page:'+pageId,reason:'核对下一步接口'}]},opened=[];
  const predictions=createPredictions({context:async()=>structuredClone(state),epoch:()=>epoch,allowed:()=>!blocked,openPage:async url=>{opened.push(url);return{opened:true};},ai:{generate:async(system,input)=>{
    generated={system,input};if(typeof output==='function')return output();if(output instanceof Error)throw output;return output;
  }}});
  return{state,predictions,get generated(){return generated;},opened,output:value=>{output=value;},invalidate:()=>epoch++,block:()=>{blocked=true;}};
}
const request={windowId:1,clientId:'fixture'};

test('AI may only rank existing local candidate IDs; source input excludes URLs, history and saved notes',async()=>{
  const f=fixture(),id=nextCandidates(f.state)[0].id;
  f.output({suggestions:[{id:'invented',url:'https://evil.test'}, {id,reason:'可能需要接口'}, {id,reason:'重复'}]});
  const result=await f.predictions.next(request);assert.equal(result.source,'api');assert.equal(result.candidates.length,1);
  const input=JSON.stringify(f.generated.input);assert(!input.includes('https://'));assert(!input.includes('PRIVATE_NOTES'));assert(!input.includes('private'));
  assert.equal(f.opened.length,0);await f.predictions.open({...request,token:result.token,id});assert.equal(f.opened.length,1);assert(f.opened[0].startsWith('https://docs.test/'));
  f.output({suggestions:[{id:'task:b',reason:'下一项相关任务'}]});const tasks=await f.predictions.next(request);
  assert.deepEqual(await f.predictions.open({...request,token:tasks.token,id:'task:b'}),{taskId:'b'});
  assert.equal(f.state.work.current.taskId,'a');assert.equal(f.opened.length,1);
});

test('API failure or invalid IDs preserve usable local pages and task suggestions',async()=>{
  const f=fixture();f.output(Object.assign(Error('AI 未启用，使用本机线索。'),{code:'AI_DISABLED'}));
  const result=await f.predictions.next(request);assert.equal(result.source,'local');assert(result.candidates.some(item=>item.kind==='page'));assert(result.candidates.some(item=>item.kind==='task'));
  assert.match(result.notice,/未启用/);f.output({suggestions:[{id:'invented'}]});assert.equal((await f.predictions.next(request)).source,'local');
});

test('excluded and explicitly unrelated resources are omitted from local and remote candidates',async()=>{
  const f=fixture();f.block();assert(nextCandidates(f.state,()=>false).every(item=>item.kind!=='page'));
  f.state.work.relations.push({taskId:'a',pageId:f.state.tasks[0].pages[0].pageId,decision:'unrelated'});
  const result=await f.predictions.next(request);assert(result.candidates.every(item=>item.kind!=='page'));assert(f.generated.input.candidates.every(item=>item.kind!=='page'));
});

test('completion preserves typed prefix, rejects fabricated URLs and never changes confirmed text',async()=>{
  const f=fixture(),before=structuredClone(f.state);f.output({completions:['改写原文','核对接口的返回值','核对https://evil.test','核对接口的返回值']});
  const result=await f.predictions.complete({...request,field:'nextStep',taskId:'a',revision:0,text:'核对'});
  assert.equal(result.source,'api');assert.deepEqual(result.candidates,['核对接口的返回值']);assert.deepEqual(f.state,before);assert.equal(f.opened.length,0);
});

test('text fallback uses saved prefix completions and does not pretend to generate absent content',async()=>{
  const f=fixture();f.output(Object.assign(Error('响应超时'),{code:'AI_TIMEOUT'}));
  const result=await f.predictions.complete({...request,field:'search',text:'核对'});assert.equal(result.source,'local');assert(result.candidates.includes('核对接口'));
  assert.deepEqual(localCompletions('不存在的文字','nextStep',f.state,f.state.tasks[0]),[]);
  await assert.rejects(f.predictions.complete({...request,field:'unsupported',text:''}),{code:'INVALID_QUERY'});
});

test('late remote completion cannot survive data edits or task changes',async()=>{
  const f=fixture();let finish;f.output(()=>new Promise(resolve=>{finish=resolve;}));
  const pending=f.predictions.complete({...request,field:'search',text:'核对'});await new Promise(setImmediate);f.invalidate();finish({completions:['核对接口']});
  await assert.rejects(pending,{code:'STALE_PREDICTION'});
  const g=fixture();g.output(()=>new Promise(resolve=>{finish=resolve;}));const next=g.predictions.next(request);await new Promise(setImmediate);g.state.work.current={taskId:'b',revision:1};finish({suggestions:[]});
  await assert.rejects(next,{code:'STALE_PREDICTION'});
});

test('new requests replace old ones and stale/excluded candidate actions cannot open a page',async()=>{
  const f=fixture();let finish;f.output(()=>new Promise(resolve=>{finish=resolve;}));const first=f.predictions.next(request);await new Promise(setImmediate);
  f.output({suggestions:[{id:'invented'}]});const second=await f.predictions.next(request);finish({suggestions:[]});await assert.rejects(first,{code:'STALE_PREDICTION'});
  f.block();await assert.rejects(f.predictions.open({...request,token:second.token,id:second.candidates.find(item=>item.kind==='page').id}),{code:'STALE_PREDICTION'});assert.equal(f.opened.length,0);
  await assert.rejects(f.predictions.open({...request,windowId:2,token:second.token,id:second.candidates[0].id}),{code:'STALE_PREDICTION'});
});

test('local fallback stays on the current focus and never pads unrelated pages or tasks',async()=>{
  const f=fixture();
  f.state.tasks.push({id:'photo',revision:0,name:'产品摄影',goal:'规划自然光构图',status:'active',pages:[]});
  f.state.suggestions=[{url:'https://photo.test',title:'产品摄影自然光参考',method:'recent'},
    {url:'https://other.test',title:'旅行行程规划',method:'transition',support:8,sessions:4,reason:'观察到访问转向'}];
  f.output(Object.assign(Error('超时，使用本机线索。'),{code:'AI_TIMEOUT'}));
  const result=await f.predictions.next(request);
  assert.equal(result.source,'local');assert.equal(result.candidates.length,2);
  assert.equal(result.candidates[0].method,'saved');
  assert(!result.candidates.some(item=>item.id==='task:photo'||item.url?.includes('other.test')||item.url?.includes('photo.test')));
  f.output({suggestions:[]});const empty=await f.predictions.next(request);
  assert.equal(empty.source,'api');assert.deepEqual(empty.candidates,[]);
});

test('sparse goals and generic workflow words do not imply cross-task relevance; shared confirmed resources do',()=>{
  const f=fixture();f.state.tasks[0].name='验收任务';f.state.tasks[0].goal='整理资料';f.state.tasks[0].checkpoint={};
  f.state.tasks[1].name='测试任务';f.state.tasks[1].goal='整理摄影资料';
  assert(!nextCandidates(f.state).some(item=>item.kind==='task'));
  f.state.tasks[1].goal='整理资料';
  assert(!nextCandidates(f.state).some(item=>item.kind==='task'));
  f.state.tasks[1].pages=structuredClone(f.state.tasks[0].pages);
  assert.equal(nextCandidates(f.state).find(item=>item.kind==='task').method,'shared');
  f.state.work.current.taskId=null;
  assert.deepEqual(nextCandidates(f.state),[]);
  f.state.suggestions=[{url:'https://observed.test',title:'观察资料',method:'transition',support:3,sessions:3,reason:'来自三个独立时段'},
    {url:'https://weak.test',title:'弱线索',method:'transition',support:2,sessions:2}];
  assert.deepEqual(nextCandidates(f.state).map(item=>item.url),['https://observed.test/']);
});

test('semantic association can suggest unconfirmed material without changing relationships; stale or navigating snapshots are omitted',async()=>{
  const f=fixture(),url='https://semantic.test/playback',pageId=pageIdForUrl(url);
  f.state.tabs=[{id:7,url,title:'音频播放与错误处理'}];
  const association={status:'done',taskId:'a',taskRevision:0,contextRevision:0,sourceEpoch:2,candidates:[{
    tabId:7,url,pageId,title:'音频播放与错误处理',page:{url,pageId,title:'音频播放与错误处理'},score:.68,method:'semantic',related:false,reason:'与已确认资料的文字相近',
  }]};
  f.state.work.epoch=2;f.state.work.association=association;
  const before=structuredClone(f.state);f.output(Object.assign(Error('未启用'),{code:'AI_DISABLED'}));
  const result=await f.predictions.next(request),candidate=result.candidates.find(item=>item.id==='page:'+pageId);
  assert(candidate.inferred);assert.equal(candidate.method,'semantic');assert.match(candidate.reason,/尚未确认/);assert.deepEqual(f.state,before);
  await f.predictions.open({...request,token:result.token,id:candidate.id});assert.equal(f.opened.at(-1),url);
  f.state.tabs[0].pendingUrl='https://different.test';
  assert(!nextCandidates(f.state).some(item=>item.id===candidate.id));
  await assert.rejects(f.predictions.open({...request,token:result.token,id:candidate.id}),{code:'STALE_PREDICTION'});
  delete f.state.tabs[0].pendingUrl;
  for(const key of ['taskRevision','contextRevision','sourceEpoch']){
    association[key]++;assert(!nextCandidates(f.state).some(item=>item.id===candidate.id));association[key]--;
  }
  f.state.work.relations.push({taskId:'a',pageId,decision:'unrelated'});
  assert(!nextCandidates(f.state).some(item=>item.id===candidate.id));
  f.state.work.relations=[];
  assert(!nextCandidates(f.state,other=>other!==url).some(item=>item.id===candidate.id));
});

test('an association gaining new evidence while AI runs invalidates its old prediction',async()=>{
  const f=fixture();f.state.tabs=[{id:9,url:'https://docs.test/undo',title:'分组接口撤销'}];
  const page={...f.state.tabs[0],tabId:9,page:f.state.tabs[0],related:false,method:'keywords',score:.4,reason:'关键词相近'};
  f.state.work.association={status:'ready',candidates:[page]};
  let finish;f.output(()=>new Promise(resolve=>{finish=resolve;}));const running=f.predictions.next(request);await new Promise(setImmediate);
  page.method='semantic';page.score=.8;page.reason='与目标文字相近';finish({suggestions:[]});
  await assert.rejects(running,{code:'STALE_PREDICTION'});
});

test('completion keeps a short, distinct set without rewriting the prefix or truncating a long answer',()=>{
  const values=['核对接口返回值。','核对接口返回值！','核对播放输出。','核对第三项。','核对'+ '长'.repeat(121)];
  assert.deepEqual(completionChoices(values,'核对','nextStep'),['核对接口返回值。','核对播放输出。']);
  assert.deepEqual(completionChoices(['核对'+ '长'.repeat(121),'核对https://bad.test','改写前缀'],'核对','nextStep'),[]);
  const prefix='继续 '.repeat(100);
  assert.deepEqual(completionChoices([prefix+'检查返回值'],prefix,'nextStep'),[prefix+'检查返回值']);
  assert.deepEqual(completionChoices(['查找 '+ 'a'.repeat(81)],'查找 ','search'),[]);
});
