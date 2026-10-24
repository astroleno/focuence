import {normalizeUrl,stableHash} from './text.js';
import {failure} from './task-context.js';

export const LIBRARY_TEXT_LIMIT=20000;
function text(value,field,limit=LIBRARY_TEXT_LIMIT){
  if(value==null)return'';if(typeof value!=='string'||[...value].length>limit)throw failure('LIBRARY_TEXT_LIMIT',field+'最多 '+limit+' 个字符；草稿已保留，请调整后保存。');return value;
}
export function libraryFrom(value){
  if(!value||!value.id||!['link','excerpt'].includes(value.kind))throw failure('INVALID_LIBRARY','材料类型或标识无效。');
  const url=normalizeUrl(value.url),parentUrl=value.parentUrl?normalizeUrl(value.parentUrl):null;
  if(!url||value.parentUrl&&!parentUrl)throw failure('INVALID_LIBRARY_URL','请核对材料的 HTTP(S) 来源地址。');
  const quote=text(value.quote,'摘录原文'),note=text(value.note,'自己的笔记'),title=text(value.title,'材料标题',500);
  if(value.kind==='excerpt'&&!quote.trim())throw failure('INVALID_LIBRARY','请粘贴摘录原文，或改为保存链接。');
  if(value.kind==='link'&&quote)throw failure('INVALID_LIBRARY','链接材料不包含摘录，请切换为摘录后保存。');
  if(!Array.isArray(value.taskIds)||value.taskIds.some(id=>typeof id!=='string'||!id))throw failure('INVALID_LIBRARY','请重新选择关联任务。');
  for(const field of ['createdAt','updatedAt'])if(!Number.isFinite(value[field])||value[field]<0)throw failure('INVALID_LIBRARY','材料时间无效。');
  if(!Number.isSafeInteger(value.revision)||value.revision<0)throw failure('INVALID_LIBRARY','材料修订号无效。');
  return{id:String(value.id),kind:value.kind,url,parentUrl,title:title.trim()||new URL(url).hostname,quote,note,taskIds:[...new Set(value.taskIds)].sort(),
    createdAt:value.createdAt,updatedAt:value.updatedAt,revision:value.revision,source:value.source==='selection'?'selection':'manual',sourceVerified:value.sourceVerified===true};
}
export const libraryKey=item=>item.kind+':'+item.url+':'+(item.kind==='excerpt'?stableHash(item.quote):'');
export function capturedDraft(info,tab,{now=Date.now(),allowed=()=>true}={}){
  if(info.editable)throw failure('EDITABLE_SELECTION','输入区域的选文不会采集，请在资料库手动粘贴需要保留的内容。');
  if(tab?.incognito)throw failure('EXCLUDED_PAGE','无痕页面不会采集。');
  const source=info.frameUrl||info.pageUrl||'',url=normalizeUrl(source),parentUrl=info.frameUrl&&info.frameUrl!==info.pageUrl?normalizeUrl(info.pageUrl):null;
  if(url&&!allowed(url)||parentUrl&&!allowed(parentUrl))throw failure('EXCLUDED_PAGE','来源站点已排除，不能采集这段选文。');
  const quote=String(info.selectionText||'');if(!quote.trim())throw failure('EMPTY_SELECTION','没有收到选中文字，请在资料库手动粘贴。');
  return{id:crypto.randomUUID(),kind:'excerpt',quote,note:'',url:url||'',parentUrl,title:info.frameUrl&&info.frameUrl!==info.pageUrl?(url?new URL(url).hostname:'来源待核对'):String(tab?.title||''),
    source:'selection',sourceVerified:false,sourceUncertain:!url,taskIds:[],createdAt:now,expiresAt:now+15*60000};
}
export function validDraft(draft,at=Date.now()){
  if(!draft||!Number.isFinite(draft.expiresAt)||draft.expiresAt<=at)throw failure('LIBRARY_DRAFT_EXPIRED','选文草稿已过期（15 分钟），请重新选择或手动粘贴。');return draft;
}

/** Background-owned operations; persistence checks revisions and task references atomically. */
export function createLibrary({store,allowed=()=>true,invalidate=()=>{},now=Date.now}){
  async function save(message){
    const original=message.id?await store.getLibraryItem(message.id):null;
    if(message.id&&(!original||original.revision!==message.revision))throw failure('STALE_LIBRARY','材料已改变或删除，请保留草稿并重新读取。');
    const item=libraryFrom({...message,id:original?.id||'lib_'+crypto.randomUUID(),createdAt:original?.createdAt??now(),updatedAt:now(),revision:original?original.revision+1:0});
    if((!original||item.url!==original.url)&&!allowed(item.url)||item.parentUrl&&(!original||item.parentUrl!==original.parentUrl)&&!allowed(item.parentUrl))throw failure('EXCLUDED_PAGE','来源站点已排除，请核对来源或站点设置。');
    if(item.source==='selection'&&!item.sourceVerified)throw failure('SOURCE_CONFIRMATION_REQUIRED','保存前请确认选文和实际来源。');
    const existing=(await store.getLibraryItems()).find(row=>row.id!==item.id&&libraryKey(row)===libraryKey(item)&&row.quote===item.quote);
    if(existing){
      if(original)throw failure('DUPLICATE_LIBRARY','同来源同原文已存在，请保留草稿并查看已有材料。');
      if(message.reuseId!==existing.id)return{duplicate:{id:existing.id,revision:existing.revision,title:existing.title,note:existing.note,taskIds:existing.taskIds}};
      if(message.reuseRevision!==existing.revision)throw failure('STALE_LIBRARY','已有材料已更新，请重新核对复用。');
      if(item.note&&item.note!==existing.note&&!message.appendNote)throw failure('DUPLICATE_NOTE','草稿有新的笔记；请明确选择追加，已有笔记不会覆盖。');
      const note=item.note&&item.note!==existing.note?existing.note+(existing.note?'\n\n':'')+item.note:existing.note;
      const merged=libraryFrom({...existing,note,taskIds:[...new Set([...existing.taskIds,...item.taskIds])],revision:existing.revision+1,updatedAt:now()});
      await store.putLibraryItem(merged,{expectedRevision:existing.revision});invalidate();return{item:merged,reused:true};
    }
    await store.putLibraryItem(item,original?{expectedRevision:original.revision}:{create:true});invalidate();return{item,reused:false};
  }
  async function remove(message){await store.deleteLibraryItem(message.id,message.revision);invalidate();return{deleted:true};}
  async function list(message={}){
    const query=String(message.query||'').trim().toLocaleLowerCase(),offset=Math.max(0,Math.floor(Number(message.offset)||0)),limit=Math.max(1,Math.min(50,Math.floor(Number(message.limit)||25)));
    const rows=(await store.getLibraryItems()).filter(item=>(!message.taskId||item.taskIds.includes(message.taskId))&&(!message.kind||item.kind===message.kind)&&(!query||[item.title,item.url,item.quote,item.note].some(text=>text.toLocaleLowerCase().includes(query)))).sort((a,b)=>b.updatedAt-a.updatedAt||a.id.localeCompare(b.id));
    return{items:rows.slice(offset,offset+limit).map(({quote,note,...item})=>({...item,preview:[...quote].slice(0,180).join(''),notePreview:[...note].slice(0,100).join('')})),total:rows.length,offset,limit};
  }
  return{save,remove,list};
}
