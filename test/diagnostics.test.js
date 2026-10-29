import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnosticEvent,diagnosticUsage,analyzeDiagnostics,DIAGNOSTIC_AGE} from '../src/diagnostics.js';
import {createDiagnostics} from '../src/diagnostics-service.js';
import {createAIService} from '../src/ai-provider.js';
import {createPredictions} from '../src/prediction.js';
import {pageIdForUrl} from '../src/text.js';

const NOW=1793289600000;
const row=(kind,extra={})=>({id:crypto.randomUUID(),at:NOW,kind,...extra});
function fixture({allowed=()=>true}={}){
  const state={enabled:true,revision:0,startedAt:NOW,capacityTrimmed:0},events=[];
  let fail=false,time=NOW,gate=null;
  const store={load:async()=>({...state}),append:async(event,revision)=>{if(gate)await gate;if(fail)throw Object.assign(Error('PRIVATE_PROVIDER_BODY'),{name:'QuotaExceededError'});
    if(!state.enabled||revision!==state.revision)return false;events.push(structuredClone(event));return true;},
    configure:async enabled=>{state.enabled=enabled;state.revision++;return{...state};},
    clear:async({reset=false}={})=>{events.length=0;state.revision++;state.startedAt=time;state.capacityTrimmed=0;if(reset)state.enabled=true;return{...state};},
    snapshot:async()=>({control:{...state},events:structuredClone(events)})};
  const diagnostics=createDiagnostics({open:async()=>store,now:()=>time,behaviorAllowed:allowed});
  return {diagnostics,events,state,fail:value=>{fail=value;},gate:value=>{gate=value;},time:value=>{time=value;}};
}

test('diagnostic whitelist strips content, raw identifiers, credentials, addresses and arbitrary errors',()=>{
  const event=diagnosticEvent(row('ai.request',{traceId:'task-name-is-private',provider:'https://private.test',model:'PRIVATE_MODEL',url:'https://private.test',
    input:'PRIVATE_DRAFT',title:'PRIVATE_TITLE',taskId:'PRIVATE_ID',error:'PRIVATE_BODY',message:'PRIVATE_MESSAGE',apiKey:'PRIVATE_KEY',stack:'PRIVATE_STACK',
    outcome:'error',errorCode:'PRIVATE_ERROR',inputTokens:0,outputTokens:12,elapsedMs:-1,usageReported:true,arbitrary:42}),NOW);
  assert.deepEqual(Object.keys(event).sort(),['id','at','kind','outcome','inputTokens','outputTokens','usageReported'].sort());
  assert(!JSON.stringify(event).includes('PRIVATE'));assert.equal(event.inputTokens,0);
  assert.equal(diagnosticEvent(row('PRIVATE_EVENT'),NOW),null);
  assert.equal(diagnosticEvent(row('ai.request',{at:NOW+1}),NOW),null);
  assert.equal(diagnosticEvent(row('ai.request',{usageReported:true}),NOW).usageReported,false);
});

test('usage normalizes Anthropic cache additions, OpenAI subsets and unknown values',()=>{
  assert.deepEqual(diagnosticUsage({usage:{input_tokens:10,cache_read_input_tokens:20,cache_creation_input_tokens:30,output_tokens:4}},'anthropic'),
    {usageReported:true,inputTokens:60,outputTokens:4,cachedInputTokens:20,cacheWriteTokens:30});
  assert.deepEqual(diagnosticUsage({usage:{prompt_tokens:60,prompt_tokens_details:{cached_tokens:20},completion_tokens:0}},'openai'),
    {usageReported:true,inputTokens:60,outputTokens:0,cachedInputTokens:20});
  assert.deepEqual(diagnosticUsage({},'openai'),{usageReported:false});
  assert.equal(diagnosticUsage({usage:{input_tokens:1e9,cache_read_input_tokens:1e9,output_tokens:1}},'anthropic').usageReported,false);
});

test('analysis uses observed display denominators, distinct requests and separate completion purposes',()=>{
  const a=crypto.randomUUID(),b=crypto.randomUUID(),orphan=crypto.randomUUID();
  const events=[row('prediction.shown',{traceId:a,elapsedMs:200}),row('prediction.opened',{traceId:a}),row('prediction.opened',{traceId:a}),
    row('prediction.opened',{traceId:orphan}),row('prediction.shown',{traceId:b,elapsedMs:100}),
    row('completion.shown',{traceId:a,field:'nextStep'}),row('completion.adopted',{traceId:a,field:'nextStep'}),row('completion.saved',{traceId:a,field:'nextStep'}),
    row('completion.shown',{traceId:b,field:'search'}),row('completion.adopted',{traceId:b,field:'search'}),
    row('completion.saved',{traceId:orphan,field:'nextStep'}),row('prediction.shown',{traceId:orphan,at:NOW-86400001})];
  const result=analyzeDiagnostics(events,{now:NOW});
  assert.equal(result.prediction.shown,2);assert.equal(result.prediction.acted,1);assert.equal(result.prediction.actionRate,.5);assert.equal(result.prediction.unmatched,1);
  assert.equal(result.prediction.renderLatency.p50,150);assert.equal(result.prediction.renderLatency.p95,200);
  assert.equal(result.nextStep.saved,1);assert.equal(result.nextStep.saveRate,1);assert.equal(result.nextStep.unmatched,1);
  assert.equal(result.search.shown,1);assert.equal(result.search.saveRate,null);
});

test('disabled AI is local mode, unknown token usage is not zero and cancellation is separate',()=>{
  const events=[row('prediction.result',{source:'local',aiEnabled:false,errorCode:'AI_DISABLED',outcome:'success'}),
    row('prediction.result',{source:'local',aiEnabled:true,errorCode:'AI_HTTP',outcome:'success'}),row('completion.result',{source:'api',aiEnabled:true,outcome:'success'}),
    row('prediction.result',{source:'local',aiEnabled:true,errorCode:'AI_STALE',outcome:'cancelled'}),
    row('ai.request',{outcome:'success',usageReported:false,elapsedMs:100}),row('ai.request',{outcome:'error',usageReported:false,elapsedMs:300})];
  let result=analyzeDiagnostics(events,{now:NOW});
  assert.equal(result.generation.localMode,1);assert.equal(result.generation.apiMode,2);assert.equal(result.generation.fallbackRate,.5);assert.equal(result.generation.cancelled,1);
  assert.equal(result.api.inputTokens,null);assert.equal(result.api.usageSamples,0);
  assert.equal(result.api.latency.p50,200);assert.equal(result.api.latency.p95,300);
  events.push(row('ai.request',{outcome:'success',inputTokens:20,outputTokens:5,usageReported:true}));
  result=analyzeDiagnostics(events,{now:NOW});assert.equal(result.api.inputTokens,20);assert.equal(result.api.outputTokens,5);assert.equal(result.api.usageSamples,1);assert.equal(result.api.calls,3);
});

test('clear removes queued events and old request scopes cannot refill data after clear or disable/re-enable',async()=>{
  const f=fixture();await f.diagnostics.load();const old=f.diagnostics.scope();let release;
  f.gate(new Promise(resolve=>{release=resolve;}));const pending=old('ai.request',{outcome:'success'});await new Promise(setImmediate);
  const cleared=f.diagnostics.clear();release();await pending;await cleared;assert.equal(f.events.length,0);
  assert.equal(await old('ai.request',{outcome:'success'}),false);
  const beforeToggle=f.diagnostics.scope();await f.diagnostics.setEnabled(false);assert.equal(await f.diagnostics.record('runtime.error',{outcome:'error'}),false);
  await f.diagnostics.setEnabled(true);assert.equal(await beforeToggle('ai.request',{}),false);
  await f.diagnostics.record('ai.request',{});assert.equal(f.events.length,1);
});

test('capture sampling avoids refresh spam and paused tracking suppresses behavior events',async()=>{
  let allowed=false;const f=fixture({allowed:()=>allowed});await f.diagnostics.load();
  for(let i=0;i<100;i++)f.diagnostics.capture('same',{status:'paused',reason:'tracking-paused'});
  await f.diagnostics.flush();assert.equal(f.events.length,1);
  await f.diagnostics.record('prediction.shown',{traceId:crypto.randomUUID()});assert.equal(f.events.length,1);
  f.time(NOW+300000);f.diagnostics.capture('same',{status:'paused',reason:'tracking-paused'});await f.diagnostics.flush();assert.equal(f.events.length,2);
  allowed=true;await f.diagnostics.record('group.apply',{outcome:'success'});assert.equal(f.events.length,3);
});

test('the pending write queue is bounded and exposes overload instead of growing without limit',async()=>{
  const f=fixture();await f.diagnostics.load();let release;f.gate(new Promise(resolve=>{release=resolve;}));
  const attempts=Array.from({length:240},()=>f.diagnostics.record('ai.request',{outcome:'success'}));
  release();await Promise.all(attempts);const view=await f.diagnostics.view();
  assert.equal(f.events.length,100);assert.equal(view.health.dropped,140);assert.equal(view.health.pending,0);
});

test('failed diagnostic persistence is visible and never rejects a caller or leaks a storage error message',async()=>{
  const f=fixture();await f.diagnostics.load();f.fail(true);
  assert.equal(await f.diagnostics.record('ai.request',{}),false);
  const view=await f.diagnostics.view();assert.equal(view.health.dropped,1);assert(!JSON.stringify(view).includes('PRIVATE_PROVIDER_BODY'));
  const unavailable=createDiagnostics({open:async()=>{throw Error('PRIVATE_STORAGE_FAILURE');}});
  await unavailable.load();await unavailable.record('runtime.error',{});
  const absent=await unavailable.view();assert.equal(absent.health.available,false);assert.equal(absent.health.dropped,1);assert(!JSON.stringify(absent).includes('PRIVATE_STORAGE_FAILURE'));
});

test('actual adapter metrics retain usage without sending any content to diagnostics',async()=>{
  const f=fixture();await f.diagnostics.load();const traceId=crypto.randomUUID();
  const ai=createAIService({telemetry:f.diagnostics,storage:{set:async()=>{},get:async()=>({}),remove:async()=>{}},permissions:{contains:async()=>true},fetchImpl:async()=>new Response(JSON.stringify({usage:{prompt_tokens:20,completion_tokens:5},choices:[{message:{content:'{"completions":["PRIVATE_DRAFT suffix"]}'}}]}))});
  await ai.save({enabled:true,baseUrl:'https://private-service.test/v1',protocol:'openai',model:'PRIVATE_MODEL',apiKey:'PRIVATE_KEY'});
  assert.deepEqual(await ai.generate('PRIVATE_SYSTEM',{text:'PRIVATE_DRAFT'},{traceId,field:'nextStep'}),{completions:['PRIVATE_DRAFT suffix']});
  await f.diagnostics.flush();assert.equal(f.events.length,1);assert.equal(f.events[0].inputTokens,20);assert.equal(f.events[0].traceId,traceId);
  assert.equal(f.events[0].provider,'custom');assert(!JSON.stringify(f.events).includes('PRIVATE'));assert(!JSON.stringify(f.events).includes('private-service'));
});

test('a hung or throwing diagnostics backend cannot hold an AI result hostage',async()=>{
  for(const scope of [()=>()=>new Promise(()=>{}),()=>{throw Error('PRIVATE_LOGGER_FAILURE');}]){
    const ai=createAIService({telemetry:{scope},storage:{set:async()=>{},get:async()=>({}),remove:async()=>{}},permissions:{contains:async()=>true},fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:'{"ok":true}'}}]}))});
    await ai.save({enabled:true,baseUrl:'https://service.test/v1',model:'test',apiKey:'key'});
    const result=await Promise.race([ai.generate('',{}),new Promise((_,reject)=>setTimeout(()=>reject(Error('Logger delayed generation')),100))]);
    assert.deepEqual(result,{ok:true});
  }
});

test('prediction feedback validates token, index and epoch; generation alone is not a display',async()=>{
  const f=fixture();await f.diagnostics.load();let epoch=0;
  const url='https://fixture.test/interface',page={url,pageId:pageIdForUrl(url),title:'接口参考'};
  const task={id:'a',revision:0,name:'接口',goal:'核对接口返回值',status:'active',pages:[page]},state={tasks:[task],work:{current:{taskId:'a',revision:0},relations:[]},suggestions:[]};
  const predictions=createPredictions({context:async()=>structuredClone(state),epoch:()=>epoch,allowed:()=>true,openPage:async()=>({opened:true}),telemetry:f.diagnostics,
    ai:{view:()=>({enabled:false}),generate:async()=>{throw Object.assign(Error('disabled'),{code:'AI_DISABLED'});}}});
  const message={windowId:1,clientId:'diagnostics'};
  const result=await predictions.next(message);await f.diagnostics.flush();assert.equal(f.events.length,1);assert.equal(f.events[0].kind,'prediction.result');
  assert.equal((await predictions.feedback({...message,token:result.token,action:'shown',elapsedMs:10})).accepted,true);
  assert.equal((await predictions.feedback({...message,token:result.token,action:'shown',elapsedMs:20})).accepted,false);
  assert.equal((await predictions.feedback({...message,token:result.token,action:'opened',choice:99})).accepted,false);
  await predictions.open({...message,token:result.token,id:result.candidates[0].id});
  const text=await predictions.complete({...message,field:'nextStep',taskId:'a',revision:0,text:'核对'});
  await predictions.feedback({...message,token:text.token,action:'shown'});await predictions.feedback({...message,token:text.token,action:'adopted',choice:0});
  assert.equal(predictions.prepareSave({...message,id:'a',revision:0,completionRef:{token:text.token,choice:0},checkpoint:{nextStep:'我修改过的文字'}}),null);
  const saved=predictions.prepareSave({...message,id:'a',revision:0,completionRef:{token:text.token,choice:0},checkpoint:{nextStep:text.candidates[0]}});assert(saved);
  predictions.clear();epoch++;await saved();await f.diagnostics.flush();
  assert.equal(f.events.filter(row=>row.kind==='completion.saved').length,1);
  assert.equal((await predictions.feedback({...message,token:text.token,action:'shown'})).accepted,false);
  const summary=analyzeDiagnostics(f.events,{now:NOW});assert.equal(summary.prediction.shown,1);assert.equal(summary.prediction.acted,1);assert.equal(summary.nextStep.saved,1);
  assert(!JSON.stringify(f.events).includes('接口'));assert(!JSON.stringify(f.events).includes('fixture.test'));
});

test('analysis removes expired rows even when storage has not performed its periodic prune',()=>{
  const result=analyzeDiagnostics([row('ai.request',{at:NOW-DIAGNOSTIC_AGE-1}),row('ai.request',{at:NOW+1}),row('ai.request')],{now:NOW,range:'7d'});
  assert.equal(result.api.calls,1);
});

test('an empty generated result never becomes a candidate impression',async()=>{
  const f=fixture();await f.diagnostics.load();
  const predictions=createPredictions({context:async()=>({tasks:[],suggestions:[],work:{current:{taskId:null,revision:0},relations:[]}}),epoch:()=>0,allowed:()=>true,openPage:async()=>{},telemetry:f.diagnostics,
    ai:{view:()=>({enabled:false}),generate:async()=>{throw Error('Not called without candidates');}}});
  const result=await predictions.next({windowId:1});assert.deepEqual(result.candidates,[]);
  assert.equal((await predictions.feedback({windowId:1,token:result.token,action:'shown'})).accepted,false);
  await f.diagnostics.flush();assert.equal(f.events.length,1);assert.equal(f.events[0].outcome,'empty');
});
