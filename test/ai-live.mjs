/** Explicit opt-in live check. Reads only the two user-designated CC Switch providers. */
import {execFileSync} from 'node:child_process';
import {writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {AI_PRESETS,createAIService} from '../src/ai-provider.js';
const database=process.argv.find(value=>value.startsWith('--credentials-db='))?.slice(17);
if(!database)throw Error('Pass --credentials-db to explicitly select the authorized CC Switch database.');
const out=resolve(process.argv.find(value=>value.startsWith('--out='))?.slice(6)||'docs/reviews/v2.6');mkdirSync(out,{recursive:true});
const python='import sqlite3,json,sys; c=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True); print(json.dumps(c.execute("select name,settings_config from providers where app_type=? and name in (?,?)",("claude","DeepSeek","OpenCode Go")).fetchall()))';
const rows=JSON.parse(execFileSync('python3',['-c',python,database],{encoding:'utf8'})),checks=[];
const provider=process.argv.find(value=>value.startsWith('--provider='))?.slice(11);
for(const [name,raw]of rows){
  if(provider&&name!==provider)continue;
  const env=JSON.parse(raw).env,preset=name==='OpenCode Go'?AI_PRESETS.opencode:AI_PRESETS.deepseek;
  const ai=createAIService({storage:{get:async()=>({}),set:async()=>{},remove:async()=>{}},permissions:{contains:async()=>true}});
  await ai.save({...preset,apiKey:env.ANTHROPIC_AUTH_TOKEN,enabled:true});
  const started=Date.now();
  try{
    const result=await ai.generate('Return only JSON {"completions":["核对接口返回值"]}.',{text:'核对'});
    const passed=Array.isArray(result.completions)&&result.completions.some(value=>typeof value==='string'&&value.startsWith('核对'));
    checks.push({provider:name,model:preset.model,protocol:preset.protocol,passed,elapsedMs:Date.now()-started});
  }catch(error){checks.push({provider:name,model:preset.model,protocol:preset.protocol,passed:false,code:error.code||'AI_UNAVAILABLE',elapsedMs:Date.now()-started});}
  finally{await ai.clear();}
}
const report={scope:'Real provider requests with synthetic text using production adapter; not a browser permission-grant test.',checks};
const json=JSON.stringify(report,null,2)+'\n';
for(const [,raw]of rows){const key=JSON.parse(raw).env.ANTHROPIC_AUTH_TOKEN;if(key&&json.includes(key))throw Error('Refusing to write credentials.');}
writeFileSync(out+'/ai-live.json',json);console.log(json);
if(!checks.some(check=>check.passed))process.exitCode=1;
