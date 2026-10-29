/** Explicit opt-in, synthetic-only prediction check; never installs credentials in a browser. */
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {createAIService,AI_PRESETS} from '../src/ai-provider.js';
import {createPredictions} from '../src/prediction.js';
import {pageIdForUrl} from '../src/text.js';

const database=process.argv.find(value=>value.startsWith('--credentials-db='))?.slice(17);
if(!database)throw Error('Select the explicitly authorized CC Switch database with --credentials-db.');
const out=resolve(process.argv.find(value=>value.startsWith('--out='))?.slice(6)||'docs/reviews/v2.6.1');
const python='import sqlite3,json,sys; c=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True); print(c.execute("select settings_config from providers where app_type=? and name=?",("claude","DeepSeek")).fetchone()[0])';
const key=JSON.parse(execFileSync('python3',['-c',python,database],{encoding:'utf8'})).env.ANTHROPIC_AUTH_TOKEN;
const page=(path,title)=>({url:'https://fixture.test/'+path,title,pageId:pageIdForUrl('https://fixture.test/'+path)});
const capture=page('capture','ESP32 I2S 麦克风音频采集指南'),playback=page('playback','ESP32 I2S 扬声器音频播放与错误处理'),photo=page('photo','产品摄影自然光与构图参考');
const state={tasks:[{id:'audio',revision:1,status:'active',name:'验收 · ESP32 音频链路',goal:'验证 ESP32 I2S 麦克风音频采集和扬声器播放，检查失败返回值与音频缓冲。',pages:[capture],checkpoint:{progress:'已核对采样率与接线。',blocker:'尚未核对失败返回值和播放输出。',nextStep:'核对 I2S 麦克风采集失败路径和扬声器播放输出',page:capture}},
  {id:'browser',revision:0,status:'active',name:'验收 · 浏览器分组',goal:'核对 Chrome 标签页分组和键盘焦点管理 API。',pages:[]},
  {id:'photo',revision:0,status:'active',name:'验收 · 产品摄影',goal:'整理自然光和构图参考。',pages:[photo]}],tabs:[{...playback,id:2}],suggestions:[{...photo,method:'recent'}],
  work:{epoch:0,current:{taskId:'audio',revision:1},relations:[],association:{status:'done',taskId:'audio',taskRevision:1,contextRevision:1,sourceEpoch:0,candidates:[{...playback,tabId:2,page:playback,method:'semantic',related:false,score:.68,reason:'与已确认资料的文字相近'}]}}};
let transport=null;
const ai=createAIService({storage:{set:async()=>{},get:async()=>({}),remove:async()=>{}},permissions:{contains:async()=>true},fetchImpl:async(url,options)=>{
  const started=performance.now(),response=await fetch(url,options),json=await response.clone().json().catch(()=>({}));
  transport={httpMs:Math.round(performance.now()-started),maxOutputTokens:JSON.parse(options.body).max_tokens,inputTokens:json.usage?.input_tokens??null,outputTokens:json.usage?.output_tokens??null,status:response.status};return response;
}});
const predictions=createPredictions({context:async()=>structuredClone(state),ai,epoch:()=>0,allowed:()=>true,openPage:async()=>{throw Error('Live quality tests never open resources.');}});
const checks=[],request={windowId:1,clientId:'synthetic-live'};
async function run(name,message,completion=false){
  const before=structuredClone(state),started=performance.now();transport=null;
  const result=await (completion?predictions.complete({...request,...message}):predictions.next({...request,...message}));
  assert.equal(result.source,'api',result.notice);assert.deepEqual(state,before);
  if(completion){assert(result.candidates.length>0&&result.candidates.length<=2);assert(result.candidates.every(text=>text.startsWith(message.text)));}
  else assert(result.candidates.every(item=>item.kind==='page'&&['capture','playback'].some(path=>item.url==='https://fixture.test/'+path)));
  assert(transport&&Number.isInteger(transport.inputTokens)&&Number.isInteger(transport.outputTokens),'Provider must return actual token usage');
  checks.push({name,passed:true,elapsedMs:Math.round(performance.now()-started),...transport,candidates:completion?result.candidates:result.candidates.map(({title,reason,basis})=>({title,reason,basis}))});
}
try{
  await ai.save({...AI_PRESETS.deepseek,enabled:true,apiKey:key});
  await run('clear goal with unrelated pages and tasks',{});
  await run('next-step completion',{field:'nextStep',text:'核对',taskId:'audio',revision:1},true);
  await run('search completion',{field:'search',text:'I2S '},true);
  state.tasks[0]={...state.tasks[0],name:'验收任务',goal:'',checkpoint:{page:capture}};state.work.association={status:'ready',candidates:[]};
  await run('sparse goal: only an explicitly saved continuation page',{});
  await ai.clear();
  const local=await predictions.next(request);assert.equal(local.source,'local');assert.equal(local.candidates.length,1);assert.equal(local.candidates[0].url,capture.url);
  checks.push({name:'disabled API uses only the saved continuation, without unrelated padding',passed:true,source:local.source,candidates:local.candidates.map(({title})=>({title}))});
}catch(error){checks.push({name:'live acceptance',passed:false,code:error.code||'ASSERTION',message:!String(error.message).includes(key)?String(error.message).slice(0,400):'Redacted error'});process.exitCode=1;}
finally{await ai.clear();}
const live=checks.filter(item=>item.inputTokens!==undefined),report={scope:'Production prediction and provider modules, Node fetch, four synthetic requests to the authorized DeepSeek account. Not browser latency or host-permission evidence.',checks,
  totals:{calls:live.length,inputTokens:live.reduce((n,item)=>n+(item.inputTokens||0),0),outputTokens:live.reduce((n,item)=>n+(item.outputTokens||0),0)},
  sourceHashes:Object.fromEntries(['src/prediction.js','src/ai-provider.js'].map(path=>[path,createHash('sha256').update(readFileSync(new URL('../'+path,import.meta.url))).digest('hex')]))};
const json=JSON.stringify(report,null,2)+'\n';if(key&&json.includes(key))throw Error('Refusing to persist credentials.');
mkdirSync(out,{recursive:true});writeFileSync(out+'/prediction-live.json',json);console.log(json);
