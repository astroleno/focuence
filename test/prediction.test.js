import test from 'node:test';
import assert from 'node:assert/strict';
import {createPredictions,nextCandidates,localCompletions} from '../src/prediction.js';
import {pageIdForUrl} from '../src/text.js';

function fixture(){
  const url='https://docs.test/interface?search=private',pageId=pageIdForUrl(url);
  const state={tasks:[{id:'a',revision:0,name:'浏览器分组',goal:'核对接口',notes:'PRIVATE_NOTES',status:'active',pages:[{pageId,url,title:'接口文档',tags:['浏览器']}],checkpoint:{progress:'已确认调用方式',nextStep:'核对接口失败路径'}},
    {id:'b',revision:0,name:'分组测试',goal:'测试撤销',status:'active',pages:[]}],work:{current:{taskId:'a',revision:0},relations:[]},suggestions:[]};
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
  f.output({suggestions:[]});const second=await f.predictions.next(request);finish({suggestions:[]});await assert.rejects(first,{code:'STALE_PREDICTION'});
  f.block();await assert.rejects(f.predictions.open({...request,token:second.token,id:second.candidates.find(item=>item.kind==='page').id}),{code:'STALE_PREDICTION'});assert.equal(f.opened.length,0);
  await assert.rejects(f.predictions.open({...request,windowId:2,token:second.token,id:second.candidates[0].id}),{code:'STALE_PREDICTION'});
});
