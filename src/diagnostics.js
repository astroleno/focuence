/** Content-free diagnostic schema and analysis. Never accepts arbitrary text. */
export const DIAGNOSTIC_LIMIT=5000;
export const DIAGNOSTIC_DAYS=7;
export const DIAGNOSTIC_AGE=DIAGNOSTIC_DAYS*86400000;
export const DIAGNOSTIC_KINDS=Object.freeze(['capture.state','semantic.run','ai.request','prediction.result','prediction.shown','prediction.opened',
  'completion.result','completion.shown','completion.adopted','completion.saved','checkpoint.saved','focus.continued','focus.selected','focus.paused','group.preview','group.apply','group.undo','runtime.error']);
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const CODES=new Set(['AI_DISABLED','AI_PERMISSION','AI_CONFIG','AI_INPUT','AI_HTTP','AI_TIMEOUT','AI_NETWORK','AI_RESPONSE','AI_STALE',
  'STALE_PREDICTION','STALE_TASK','STALE_CONTEXT','STALE_PROPOSAL','STALE_SUGGESTION','CANCELLED','STORAGE_QUOTA','MODEL_ERROR','INVALID_QUERY','INTERNAL']);
const ENUMS={outcome:['success','error','cancelled','empty'],source:['api','local'],field:['nextStep','search'],protocol:['openai','anthropic'],
  provider:['deepseek','opencode','custom'],purpose:['association','search','grouping','warmup'],candidateKind:['page','task'],
  status:['active','unfocused','paused','idle','locked','excluded','unsupported','incognito','no-tab'],
  reason:['foreground','no-focused-window','multiple-focused-windows','tracking-paused','idle','locked','excluded','unsupported','incognito','no-tab','activity','initialization','model']};
const NUMBERS=['elapsedMs','queueMs','count','cached','computed','candidateCount','inputTokens','outputTokens','cachedInputTokens','cacheWriteTokens','httpStatus','focusedWindows','choice','opened','reused','failed'];
export function diagnosticCode(error) {
  return error?.name==='QuotaExceededError'?'STORAGE_QUOTA':CODES.has(error?.code)?error.code:'INTERNAL';
}
export function diagnosticScope(telemetry){try{return telemetry?.scope?.()||(()=>{});}catch{return()=>{};}}
export function emitDiagnostic(log,kind,fields){try{Promise.resolve(log(kind,fields)).catch(()=>{});}catch{/* Logging cannot block a product action. */}}
export function diagnosticEvent(value,now=Date.now()) {
  if(!value||!DIAGNOSTIC_KINDS.includes(value.kind)||!Number.isFinite(value.at)||value.at<0||value.at>now||!UUID.test(value.id||''))return null;
  const event={id:value.id,at:value.at,kind:value.kind};
  if(UUID.test(value.traceId||''))event.traceId=value.traceId;
  for(const [key,values]of Object.entries(ENUMS))if(values.includes(value[key]))event[key]=value[key];
  for(const key of NUMBERS)if(Number.isFinite(value[key])&&value[key]>=0&&value[key]<=1e9)event[key]=Math.round(value[key]);
  for(const key of ['aiEnabled','usageReported'])if(typeof value[key]==='boolean')event[key]=value[key];
  if(event.usageReported&&(!Number.isInteger(event.inputTokens)||!Number.isInteger(event.outputTokens)))event.usageReported=false;
  if(CODES.has(value.errorCode))event.errorCode=value.errorCode;
  return event;
}
const token=value=>Number.isInteger(value)&&value>=0&&value<=1e9?value:null;
export function diagnosticUsage(result,protocol) {
  const usage=result?.usage||{};
  let input=token(protocol==='anthropic'?usage.input_tokens:usage.prompt_tokens),output=token(protocol==='anthropic'?usage.output_tokens:usage.completion_tokens);
  const cached=token(protocol==='anthropic'?usage.cache_read_input_tokens:usage.prompt_tokens_details?.cached_tokens);
  const written=protocol==='anthropic'?token(usage.cache_creation_input_tokens):null;
  // Anthropic reports cache reads/writes separately; OpenAI prompt_tokens already includes its cached subset.
  if(protocol==='anthropic'&&input!==null)input+=(cached||0)+(written||0);
  if(input!==null&&input>1e9)input=null;
  return {usageReported:input!==null&&output!==null,...(input!==null?{inputTokens:input}:{}),...(output!==null?{outputTokens:output}:{}),
    ...(cached!==null?{cachedInputTokens:cached}:{}),...(written!==null?{cacheWriteTokens:written}:{})};
}
function latency(rows,key='elapsedMs') {
  const values=rows.map(row=>row[key]).filter(Number.isFinite).sort((a,b)=>a-b);
  const percentile=p=>values.length?values[Math.max(0,Math.ceil(values.length*p)-1)]:null;
  const middle=Math.floor(values.length/2),median=values.length?(values.length%2?values[middle]:(values[middle-1]+values[middle])/2):null;
  return {samples:values.length,p50:median,p95:percentile(.95)};
}
function funnel(rows,prefix,field) {
  const matching=rows.filter(row=>(!field||row.field===field)&&row.traceId);
  const shown=new Set(matching.filter(row=>row.kind===prefix+'.shown').map(row=>row.traceId));
  const action=prefix==='prediction'?'opened':'adopted';
  const actions=new Set(matching.filter(row=>row.kind===prefix+'.'+action).map(row=>row.traceId));
  const saved=new Set(matching.filter(row=>row.kind===prefix+'.saved').map(row=>row.traceId));
  const selected=[...actions].filter(id=>shown.has(id)),confirmed=[...saved].filter(id=>shown.has(id)&&actions.has(id));
  return {shown:shown.size,acted:selected.length,saved:confirmed.length,actionRate:shown.size?selected.length/shown.size:null,
    saveRate:field==='nextStep'&&selected.length?confirmed.length/selected.length:null,
    unmatched:[...new Set([...actions,...saved])].filter(id=>!shown.has(id)||saved.has(id)&&!actions.has(id)).length,
    renderLatency:latency(matching.filter(row=>row.kind===prefix+'.shown'))};
}
export function analyzeDiagnostics(rows,{now=Date.now(),range='24h'}={}) {
  const since=now-(range==='7d'?DIAGNOSTIC_AGE:86400000),events=rows.filter(row=>row.at>=since&&row.at<=now);
  const of=kind=>events.filter(row=>row.kind===kind),api=of('ai.request'),usage=api.filter(row=>row.usageReported);
  const predictions=events.filter(row=>['prediction.result','completion.result'].includes(row.kind));
  const valid=predictions.filter(row=>['success','empty'].includes(row.outcome));
  const configured=valid.filter(row=>row.aiEnabled),fallback=configured.filter(row=>row.source==='local'&&row.errorCode?.startsWith('AI_')&&!['AI_DISABLED','AI_INPUT'].includes(row.errorCode));
  const semantic=of('semantic.run'),count=(kind,outcome)=>of(kind).filter(row=>!outcome||row.outcome===outcome).length;
  return {range,since,until:now,events:events.length,api:{calls:api.length,success:api.filter(row=>row.outcome==='success').length,
    errors:api.filter(row=>row.outcome==='error').length,cancelled:api.filter(row=>row.outcome==='cancelled').length,latency:latency(api),
    usageSamples:usage.length,inputTokens:usage.length?usage.reduce((n,row)=>n+(row.inputTokens||0),0):null,
    outputTokens:usage.length?usage.reduce((n,row)=>n+(row.outputTokens||0),0):null,
    cachedInputTokens:usage.length?usage.reduce((n,row)=>n+(row.cachedInputTokens||0),0):null},
    generation:{requests:predictions.length,localMode:valid.filter(row=>row.aiEnabled===false).length,apiMode:configured.length,fallback:fallback.length,
      fallbackRate:configured.length?fallback.length/configured.length:null,cancelled:predictions.filter(row=>row.outcome==='cancelled').length},
    prediction:funnel(events,'prediction'),nextStep:funnel(events,'completion','nextStep'),search:funnel(events,'completion','search'),
    semantic:{runs:semantic.length,latency:latency(semantic),queueLatency:latency(semantic,'queueMs'),cached:semantic.reduce((n,row)=>n+(row.cached||0),0),computed:semantic.reduce((n,row)=>n+(row.computed||0),0)},
    capture:{samples:of('capture.state').length,latest:of('capture.state').sort((a,b)=>b.at-a.at)[0]||null,
      reasons:Object.fromEntries([...new Set(of('capture.state').map(row=>row.reason))].filter(Boolean).map(reason=>[reason,of('capture.state').filter(row=>row.reason===reason).length]))},
    grouping:{previews:count('group.preview','success'),applied:count('group.apply','success'),undone:count('group.undo','success'),
      errors:['group.preview','group.apply','group.undo'].reduce((n,kind)=>n+count(kind,'error'),0)},
    focus:{checkpoints:count('checkpoint.saved','success'),continued:count('focus.continued','success'),selected:count('focus.selected','success'),paused:count('focus.paused','success')},
    errors:events.filter(row=>row.outcome==='error').reduce((out,row)=>{const code=row.errorCode||'INTERNAL';out[code]=(out[code]||0)+1;return out;},{})};
}
