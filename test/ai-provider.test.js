import test from 'node:test';
import assert from 'node:assert/strict';
import {createAIService,aiEndpoint,parseAIObject} from '../src/ai-provider.js';

function fixture(options={}){
  const data={},calls=[];let granted=true;
  const storage={get:async key=>({[key]:data[key]}),set:async value=>Object.assign(data,structuredClone(value)),remove:async key=>{delete data[key];},setAccessLevel:async value=>calls.push({access:value})};
  const ai=createAIService({storage,permissions:{contains:async()=>granted},fetchImpl:async(url,request)=>{
    calls.push({url,request});return new Response(JSON.stringify({choices:[{message:{content:'{"completions":["继续核对接口"]}'}}]}));
  },...options});
  return {ai,data,calls,grant:value=>{granted=value;},save:config=>ai.save({enabled:true,baseUrl:'https://ai.test/v1',model:'model',apiKey:'private-test-key',...config})};
}

test('provider configuration is local, redacted and changing an address cannot silently reuse a key',async()=>{
  const f=fixture();await f.ai.load();assert.deepEqual(f.calls[0].access,{accessLevel:'TRUSTED_CONTEXTS'});
  const value=await f.save();assert(value.hasKey);assert(!('apiKey'in value));assert(!JSON.stringify(value).includes('private-test-key'));
  await f.ai.save({...value,model:'new'});assert.equal(f.data.focuenceAI.apiKey,'private-test-key');
  await assert.rejects(f.ai.save({...value,baseUrl:'https://other.test/v1'}),{code:'AI_CONFIG'});
  await f.ai.clear();assert(!f.ai.view().hasKey);assert(!f.data.focuenceAI);
});

test('Chat Completions uses bounded input, bearer auth and rejects redirects',async()=>{
  const f=fixture();await f.save();const response=await f.ai.generate('只补全文字',{text:'继续'});assert.equal(response.completions[0],'继续核对接口');
  const {url,request}=f.calls.at(-1);assert.equal(url,'https://ai.test/v1/chat/completions');assert.equal(request.headers.Authorization,'Bearer private-test-key');
  assert.equal(request.redirect,'error');assert.equal(request.credentials,'omit');assert.equal(JSON.parse(request.body).messages.length,2);
});

test('generation can use a smaller output budget without exceeding the provider hard limit',async()=>{
  const f=fixture();await f.save();
  for(const [requested,expected]of [[400,400],[450,450],[2000,1000],[0,1],[NaN,1000]]){
    await f.ai.generate('system',{}, {maxTokens:requested});assert.equal(JSON.parse(f.calls.at(-1).request.body).max_tokens,expected);
  }
});

test('Anthropic uses Messages and supports bases with or without v1',async()=>{
  let actual;
  const f=fixture({fetchImpl:async(url,request)=>{actual={url,request};return new Response(JSON.stringify({content:[{type:'thinking',thinking:'hidden'},{type:'text',text:'{"suggestions":[]}'}]}));}});
  await f.save({baseUrl:'https://ai.test/anthropic',protocol:'anthropic'});assert.deepEqual(await f.ai.generate('system',{}),{suggestions:[]});
  assert.equal(actual.url,'https://ai.test/anthropic/v1/messages');assert.equal(actual.request.headers['x-api-key'],'private-test-key');
  assert.equal(JSON.parse(actual.request.body).system,'system');
  assert.equal(aiEndpoint('https://ai.test/v1','anthropic').url,'https://ai.test/v1/messages');
});

test('disabled, missing permission and malformed addresses never send a request',async()=>{
  const f=fixture();await assert.rejects(f.ai.generate('',{}),{code:'AI_DISABLED'});await f.save();f.grant(false);
  await assert.rejects(f.ai.generate('',{}),{code:'AI_PERMISSION'});assert.equal(f.calls.length,0);
  for(const value of ['http://remote.test/v1','https://key@ai.test','https://ai.test/?key=private','https://ai.test/v1/chat/completions'])assert.throws(()=>aiEndpoint(value),{code:'AI_CONFIG'});
});

test('timeouts and provider errors never echo secret provider response bodies',async()=>{
  const timeout=fixture({timeoutMs:5,fetchImpl:(_url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('abort'))))});
  await timeout.save();await assert.rejects(timeout.ai.generate('',{}),{code:'AI_TIMEOUT'});
  const auth=fixture({fetchImpl:async()=>new Response('secret provider diagnostics',{status:401})});await auth.save();
  await assert.rejects(auth.ai.generate('',{}),error=>error.code==='AI_HTTP'&&!error.message.includes('secret'));
});

test('oversized/malformed output falls back and late responses are cancelled after config changes',async()=>{
  const large=fixture({fetchImpl:async()=>new Response('x'.repeat(70000))});await large.save();await assert.rejects(large.ai.generate('',{}),{code:'AI_RESPONSE'});
  assert.throws(()=>parseAIObject('not json'),{code:'AI_RESPONSE'});
  let resolve;const f=fixture({fetchImpl:()=>new Promise(done=>{resolve=done;})});await f.save();const running=f.ai.generate('',{});
  await new Promise(setImmediate);await f.ai.clear();resolve(new Response(JSON.stringify({choices:[{message:{content:'{}'}}]})));
  await assert.rejects(running,{code:'AI_STALE'});
});
