import {setup,until} from './cdp.mjs';import assert from 'node:assert/strict';import {writeFileSync} from 'node:fs';
const out=process.argv.find(value=>value.startsWith('--out='))?.slice(6)||'docs/reviews/v2.3';
const env=await setup({out}),{control,rpc,base,windowId}=env,report={environment:'Actual bundled q8 BGE in native MV3 worker; eight synthetic metadata pages; no mocked vectors.',checks:[],errors:[]};
try{
 await rpc('CLEAR_ALL');await rpc('UPDATE_SETTINGS',{patch:{tracking:false,semantic:true}});
 const paths=['硬件/I2S数字麦克风拾音','硬件/I2S功放扬声器','电源/ESP32电池供电管理','离线/网页端本地模型与向量检索','开发/浏览器扩展接口','烘焙/酵母面包发酵','旅行/京都行程','三维/Blender灯光'];
 await control.eval(async({paths,base,windowId})=>{for(const path of paths)await chrome.tabs.create({windowId,url:base+'/fixture/'+path,active:false});},{paths,base,windowId});
 await until(async()=>{const tabs=(await rpc('LIST_WORKSPACE_TABS')).tabs;return tabs.length===8&&paths.every(path=>tabs.some(tab=>tab.title===path));},'loaded metadata pages');
 await rpc('GET_STATE');
 for(const [query,target]of [['如何把人声变成数字信号','I2S数字麦克风'],['离线运行人工智能的浏览器资料','网页端本地模型'],['烘焙时面团要等多久','酵母面包']]){
  const started=Date.now();let job=await rpc('SEARCH_MEMORY',{query,scope:'window',clientId:'model-regression'});const initial=job.results.map(item=>item.title);
  while(!['done','failed','cancelled','stale'].includes(job.status))job=await rpc('GET_SEARCH_STATUS',{jobId:job.id});
  assert.equal(job.status,'done',JSON.stringify(job));assert(job.results[0].title.includes(target),JSON.stringify(job.results));
  report.checks.push({name:query,status:'passed',target,rank:1,initialKeywords:initial,results:job.results.map(item=>({title:item.title,method:item.method,score:item.score})),milliseconds:Date.now()-started});console.log(query+' -> '+job.results[0].title);
 }
 let none=await rpc('SEARCH_MEMORY',{query:'qxjv-9472-zztp',scope:'window',clientId:'model-regression'});while(none.status==='queued'||none.status==='running')none=await rpc('GET_SEARCH_STATUS',{jobId:none.id});assert.equal(none.results.length,0);report.checks.push({name:'Unrelated gibberish returns no result',status:'passed'});
}catch(error){report.errors.push(error.stack);console.error(error.stack);process.exitCode=1;}
finally{writeFileSync(env.out+'/model.json',JSON.stringify(report,null,2));await env.close();}
