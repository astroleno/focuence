/** Optional text generation. Credentials never enter ordinary state or backups. */
export const AI_PRESETS = Object.freeze({
  opencode: {baseUrl:'https://opencode.ai/zen/go/v1', protocol:'openai', model:'deepseek-v4.1-flash'},
  deepseek: {baseUrl:'https://api.deepseek.com/anthropic', protocol:'anthropic', model:'deepseek-flash'},
});
const EMPTY = Object.freeze({enabled:false, baseUrl:'', protocol:'openai', model:'', apiKey:''});
const error = (code, message) => Object.assign(new Error(message), {code});

export function aiEndpoint(value, protocol = 'openai') {
  let url;
  try { url = new URL(String(value).trim()); } catch { throw error('AI_CONFIG', '请填写完整的 AI 服务地址。'); }
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname))) || url.username || url.password || url.search || url.hash)
    throw error('AI_CONFIG', '服务地址需使用 HTTPS；本机服务可用 HTTP。请移除地址中的密钥、参数和片段。');
  if (!['openai','anthropic'].includes(protocol)) throw error('AI_CONFIG', '请选择支持的接口类型。');
  const path = url.pathname.replace(/\/+$/, '');
  if (/\/(chat\/completions|messages|responses)$/.test(path)) throw error('AI_CONFIG', '请填写 Base URL，不要包含 messages 或 chat/completions。');
  const baseUrl = url.origin + path;
  return {baseUrl, url:baseUrl + (protocol === 'anthropic' ? (path.endsWith('/v1')?'/messages':'/v1/messages') : '/chat/completions'), origin:url.origin + '/*'};
}

function normalize(value, previous = EMPTY) {
  const protocol = value.protocol ?? previous.protocol;
  const raw = String(value.baseUrl ?? previous.baseUrl).trim();
  const endpoint = raw ? aiEndpoint(raw, protocol) : null;
  const baseUrl = endpoint?.baseUrl || '';
  const model = String(value.model ?? previous.model).trim();
  const apiKey = value.apiKey === undefined ? (baseUrl === previous.baseUrl ? previous.apiKey : '') : String(value.apiKey).trim();
  if (model.length > 150 || /[\r\n]/.test(model) || apiKey.length > 8192 || /\s/.test(apiKey)) throw error('AI_CONFIG', '模型名或密钥格式不正确。');
  const enabled = value.enabled === true;
  if (enabled && (!baseUrl || !model || !apiKey)) throw error('AI_CONFIG', '启用前请填写服务地址、模型和密钥。');
  return {enabled, baseUrl, protocol, model, apiKey};
}

export function aiOrigin(baseUrl, protocol) { return aiEndpoint(baseUrl, protocol).origin; }

export function parseAIObject(text) {
  const clean = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { const value=JSON.parse(clean); if (value && !Array.isArray(value) && typeof value === 'object') return value; } catch { /* Fall back locally. */ }
  throw error('AI_RESPONSE', '服务返回的候选格式无法使用，已改用本机线索。');
}

async function boundedJSON(response) {
  const reader = response.body?.getReader();
  if (!reader) throw error('AI_RESPONSE', '服务没有返回可用内容，已改用本机线索。');
  const chunks=[]; let size=0;
  try {
    while (true) {
      const {done,value}=await reader.read(); if(done)break;
      size+=value.byteLength; if(size>65536)throw error('AI_RESPONSE','服务返回内容过长，已改用本机线索。');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(()=>{}); }
  const bytes=new Uint8Array(size); let offset=0; for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw error('AI_RESPONSE','服务没有返回有效内容，已改用本机线索。');}
}

export function createAIService({storage, permissions, fetchImpl=globalThis.fetch, timeoutMs=20000}) {
  let config={...EMPTY}, version=0;
  const sessionId=crypto.randomUUID();
  const requests=new Set();
  const cancel=()=>{version++;for(const controller of requests)controller.abort();};
  const view=()=>{const {apiKey,...safe}=config;return {...safe,hasKey:Boolean(apiKey)};};
  return {
    async load() {
      await storage.setAccessLevel?.({accessLevel:'TRUSTED_CONTEXTS'});
      const saved=(await storage.get('focuenceAI')).focuenceAI;
      try{config=normalize(saved||EMPTY);}catch{config={...EMPTY};}
      return view();
    },
    view,
    version:()=>version,
    async save(value) {
      const next=normalize(value,config);
      if(next.enabled&&!await permissions.contains({origins:[aiOrigin(next.baseUrl,next.protocol)]}))throw error('AI_PERMISSION','请先允许访问这个 AI 服务。');
      await storage.set({focuenceAI:next});cancel();config=next;return view();
    },
    async clear() {await storage.remove('focuenceAI');cancel();config={...EMPTY};return view();},
    cancel,
    async generate(system, input, {isCurrent=()=>true}={}) {
      const selected={...config}, expected=version;
      const current=()=>version===expected&&isCurrent();
      if(!selected.enabled)throw error('AI_DISABLED','AI 服务未启用，使用本机线索。');
      const endpoint=aiEndpoint(selected.baseUrl,selected.protocol);
      if(!await permissions.contains({origins:[endpoint.origin]}))throw error('AI_PERMISSION','AI 服务未获站点授权，使用本机线索。');
      if(!current())throw error('AI_STALE','内容已改变，请重新获取候选。');
      const controller=new AbortController();requests.add(controller);
      let timedOut=false;
      const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
      try {
        const anthropic=selected.protocol==='anthropic';
        const body={model:selected.model,max_tokens:1000,messages:[...(anthropic?[]:[{role:'system',content:system}]),{role:'user',content:JSON.stringify(input)}],stream:false};
        if(anthropic)body.system=system;
        const response=await fetchImpl(endpoint.url,{method:'POST',redirect:'error',credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal,
          headers:{'Content-Type':'application/json',...(new URL(selected.baseUrl).hostname==='opencode.ai'?{'x-opencode-session':sessionId}:{}),
            ...(anthropic?{'x-api-key':selected.apiKey,'anthropic-version':'2023-06-01'}:{Authorization:'Bearer '+selected.apiKey})},body:JSON.stringify(body)});
        if(!response.ok)throw error('AI_HTTP',response.status===401||response.status===403?'AI 服务未通过鉴权，使用本机线索。':response.status===429?'AI 服务繁忙或额度受限，使用本机线索。':'AI 服务暂时不可用，使用本机线索。');
        const result=await boundedJSON(response);
        if(!current())throw error('AI_STALE','内容已改变，请重新获取候选。');
        const text=anthropic?(result.content||[]).filter(item=>item.type==='text').map(item=>item.text).join('\n'):result.choices?.[0]?.message?.content;
        return parseAIObject(text);
      } catch(caught) {
        if(!current())throw error('AI_STALE','内容已改变，请重新获取候选。');
        if(caught.code?.startsWith('AI_'))throw caught;
        throw error(timedOut?'AI_TIMEOUT':'AI_NETWORK',timedOut?'AI 服务响应超时，使用本机线索。':'AI 服务连接失败，使用本机线索。');
      } finally {clearTimeout(timer);requests.delete(controller);}
    },
  };
}
