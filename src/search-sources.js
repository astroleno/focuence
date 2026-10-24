import {normalizeUrl,pageIdForUrl,embeddingText} from './text.js';
import {failure} from './task-context.js';

export const SOURCE_LABELS=Object.freeze({window:'当前窗口','other-window':'其他窗口',saved:'已保存页面',confirmed:'关联记忆',history:'自记录访问',browser:'浏览器历史',task:'任务文字',library:'资料库'});
const scopes={all:Object.keys(SOURCE_LABELS),window:['window'],windows:['window','other-window'],tasks:['saved','confirmed','task'],history:['history'],browser:['browser'],library:['library']};
function dateInput(value,end=false){
  if(value==null||value==='')return null;if(typeof value==='number'){if(!Number.isFinite(value)||value<0)throw failure('INVALID_FILTER','日期无效。');return value;}
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw failure('INVALID_FILTER','请使用有效的年月日。');
  const date=new Date(value+'T00:00:00'),[year,month,day]=value.split('-').map(Number);
  if(date.getFullYear()!==year||date.getMonth()+1!==month||date.getDate()!==day)throw failure('INVALID_FILTER','日期不存在，请重新选择。');
  if(end)date.setDate(date.getDate()+1);return+date-(end?1:0);
}
export function interpretSearch(query,filters={},at=Date.now()){
  let terms=String(query||'').trim(),inferred=null,explanation='';const today=new Date(at);today.setHours(0,0,0,0);
  if(terms.includes('昨天')){const from=new Date(today);from.setDate(from.getDate()-1);inferred={from:+from,until:+today-1};terms=terms.replace('昨天','').trim();explanation='昨天';}
  else if(terms.includes('上周')){const monday=new Date(today);monday.setDate(monday.getDate()-(monday.getDay()+6)%7);const from=new Date(monday);from.setDate(from.getDate()-7);inferred={from:+from,until:+monday-1};terms=terms.replace('上周','').trim();explanation='上周一至周日';}
  else{const match=terms.match(/最近\s*([1-9]\d{0,3})\s*天/);if(match){const from=new Date(today);from.setDate(from.getDate()-Number(match[1])+1);inferred={from:+from,until:at};terms=terms.replace(match[0],'').trim();explanation=match[0];}}
  let domain=String(filters.domain||'').trim().toLowerCase().replace(/^\*\./,'');
  if(domain){try{domain=new URL(domain.includes('://')?domain:'https://'+domain).hostname;if(!domain||/\s/.test(domain))throw Error();}catch{throw failure('INVALID_FILTER','请填写有效的站点域名。');}}
  const manual=filters.from!==''&&filters.from!=null||filters.until!==''&&filters.until!=null;
  const from=manual?dateInput(filters.from):inferred?.from??null,until=manual?dateInput(filters.until,true):inferred?.until??null;
  if(from!=null&&until!=null&&from>until)throw failure('INVALID_FILTER','开始日期不能晚于结束日期。');
  const sources=Array.isArray(filters.sources)?filters.sources.filter(source=>Object.hasOwn(SOURCE_LABELS,source)):[];
  return{terms,filters:{from,until,domain,taskId:String(filters.taskId||''),taskMode:filters.taskMode==='observed'?'observed':'associated',sources},
    explanation:manual?'使用手动日期范围':explanation,hasFilter:!!(manual||inferred||domain||filters.taskId||sources.length)};
}

/** Filter source evidence before constructing text documents or model inputs. */
export function searchCorpus({tabs=[],tasks=[],relations=[],segments=[],browserVisits=[],library=[],currentWindowId,scope='all',filters={},allowed=()=>true}={}){
  const included=new Set(scopes[scope]||scopes.all),entries=new Map(),membership=new Map(),taskIds=new Set(tasks.map(task=>task.id));
  const related=(pageId,taskId,value)=>{if(!membership.has(pageId))membership.set(pageId,new Set());if(value)membership.get(pageId).add(taskId);else membership.get(pageId).delete(taskId);};
  for(const task of tasks)for(const page of task.pages||[])related(pageIdForUrl(page.url),task.id,true);
  for(const relation of relations)if(taskIds.has(relation.taskId))related(relation.pageId,relation.taskId,relation.decision==='related');
  for(const item of library)for(const taskId of item.taskIds)if(taskIds.has(taskId))related(pageIdForUrl(item.url),taskId,true);
  const accepts=evidence=>{
    if(!included.has(evidence.source)||filters.sources?.length&&!filters.sources.includes(evidence.source))return false;
    if(filters.domain){if(!evidence.url)return false;const host=new URL(evidence.url).hostname;if(host!==filters.domain&&!host.endsWith('.'+filters.domain))return false;}
    if(filters.from!=null&&(!evidence.at||(evidence.endAt||evidence.at)<filters.from))return false;
    if(filters.until!=null&&(!evidence.at||evidence.at>filters.until))return false;
    if(filters.taskId&&(filters.taskMode==='observed'?evidence.observedTaskId!==filters.taskId:!evidence.taskIds.includes(filters.taskId)))return false;
    return true;
  };
  const add=(entry,evidence,text)=>{
    if(!accepts(evidence))return;const old=entries.get(entry.id)||{...entry,sources:[],taskIds:[],evidence:[],searchTexts:[],visitedAt:0,timeType:'时间未知'};
    if(!old.sources.includes(evidence.source))old.sources.push(evidence.source);
    for(const id of evidence.taskIds||[])if(!old.taskIds.includes(id))old.taskIds.push(id);
    old.evidence.push(evidence);if(!old.searchTexts.includes(text))old.searchTexts.push(text);
    if(evidence.at>old.visitedAt){old.visitedAt=evidence.at;old.timeType=evidence.timeType;}
    entries.set(entry.id,old);
  };
  const page=(value,evidence)=>{
    const url=normalizeUrl(value?.url);if(!url||!allowed(url))return;const pageId=pageIdForUrl(url),taskMembership=[...(membership.get(pageId)||[])];
    add({id:'page:'+pageId,kind:'page',pageId,url,title:value.title||new URL(url).hostname},
      {...evidence,title:value.title||new URL(url).hostname,url,taskIds:taskMembership},embeddingText({...value,url}));
  };
  for(const tab of tabs)page(tab,{id:'tab:'+tab.id,source:tab.windowId===currentWindowId?'window':'other-window',tabId:tab.id,windowId:tab.windowId,
    at:Number.isFinite(tab.lastAccessed)?tab.lastAccessed:0,timeType:tab.lastAccessed?'浏览器最近访问':'时间未知'});
  for(const task of tasks){
    const point=task.checkpoint,fields=[task.name,task.goal,task.notes,point?.progress,point?.blocker,point?.nextStep].filter(Boolean),at=task.updatedAt||task.createdAt||0;
    add({id:'task:'+task.id,kind:'task',taskId:task.id,title:task.name,url:allowed(point?.page?.url)?point?.page?.url:null,status:task.status},
      {id:'task:'+task.id,source:'task',taskIds:[task.id],taskId:task.id,title:task.name,at,timeType:'任务修改时间',url:normalizeUrl(point?.page?.url)},fields.join('\n'));
    for(const saved of task.pages||[])page(saved,{id:'saved:'+task.id+':'+(saved.pageId||saved.id),source:'saved',taskId:task.id,at,timeType:'任务修改时间'});
  }
  for(const relation of relations)if(relation.decision==='related'&&taskIds.has(relation.taskId))page(relation.page,{id:relation.id,source:'confirmed',taskId:relation.taskId,at:relation.at,timeType:'确认关联时间'});
  for(const segment of segments)if(segment.status==='active')page(segment,{id:segment.id,segmentId:segment.id,source:'history',observedTaskId:segment.taskId,
    at:segment.startedAt,endAt:segment.endedAt,foregroundMs:segment.foregroundMs,timeType:'前台观察时段'});
  for(const visit of browserVisits)page(visit,{id:visit.id,nativeVisitId:visit.nativeVisitId,source:'browser',at:visit.visitedAt,timeType:'浏览器访问时间'});
  for(const item of library){
    const url=normalizeUrl(item.url);if(!url||!allowed(url))continue;
    const entry={id:'library:'+item.id,kind:'library',libraryId:item.id,pageId:pageIdForUrl(url),url,title:item.title},text=[item.title,url,item.kind==='excerpt'?'摘录原文：\n'+item.quote:'收藏链接',item.note?'自己的笔记：\n'+item.note:''].filter(Boolean).join('\n');
    const evidence={id:item.id,source:'library',libraryId:item.id,url,parentUrl:item.parentUrl,title:item.title,taskIds:item.taskIds.filter(id=>taskIds.has(id)),at:item.createdAt,timeType:'资料保存时间',updatedAt:item.updatedAt};
    add(entry,evidence,text);if(item.updatedAt!==item.createdAt)add(entry,{...evidence,id:item.id+':updated',at:item.updatedAt,timeType:'资料修改时间'},text);
    const saved=entries.get(entry.id);if(saved)saved.searchParts=[{field:'source',text:[item.title,url].join('\n')},{field:'quote',text:item.quote},{field:'note',text:item.note}].filter(part=>part.text);
  }
  return[...entries.values()].map(entry=>({...entry,text:entry.searchTexts.join('\n')})).sort((a,b)=>a.id.localeCompare(b.id));
}

export function compactMemoryResult(entry){
  const {text,searchTexts,searchParts,evidence,...safe}=entry;
  return{...safe,sourceEvidence:(evidence||[]).slice(0,5),evidenceCount:evidence?.length||0};
}
