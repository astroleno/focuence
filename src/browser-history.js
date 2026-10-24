import {normalizeUrl,pageIdForUrl,stableHash,cleanTitle} from './text.js';
import {failure} from './task-context.js';

export async function recentSessions(api,allowed){
  if(!await api.permissions.contains({permissions:['sessions']}))return{enabled:false,items:[]};
  const recent=await api.sessions.getRecentlyClosed({maxResults:25});
  const items=recent.flatMap(item=>{
    const tabs=item.tab?[item.tab]:item.window?.tabs||[],safe=tabs.filter(tab=>!tab.incognito&&normalizeUrl(tab.url)&&allowed(tab.url));
    if(!safe.length)return[];
    return[{id:item.tab?.sessionId||item.window?.sessionId,kind:item.window?'window':'tab',at:item.lastModified*1000,
      complete:safe.length===tabs.length,omitted:tabs.length-safe.length,
      pages:safe.map(tab=>({title:tab.title||new URL(tab.url).hostname,url:normalizeUrl(tab.url)}))}];
  });
  return{enabled:true,limit:25,items};
}
export async function restoreRecentSession(api,id,allowed){
  const list=await recentSessions(api,allowed);
  if(!list.enabled)throw failure('PERMISSION_REQUIRED','请先启用最近关闭功能。');
  const item=list.items.find(item=>item.id===id);
  if(!item)throw failure('STALE_SESSION','这条最近关闭记录已失效，请刷新列表。');
  if(!item.complete)throw failure('FILTERED_SESSION','窗口包含未列出的页面，请逐项打开已显示的网址。');
  await api.sessions.restore(id);return{restored:true};
}

export function historyRange(days,at=Date.now()){
  if(![7,30,90].includes(days))throw failure('INVALID_HISTORY_RANGE','请选择最近 7、30 或 90 天。');
  const from=new Date(at);from.setHours(0,0,0,0);from.setDate(from.getDate()-days+1);return{days,from:+from,to:at};
}
export function historyRecords(item,visits,run,allowed=()=>true){
  const url=normalizeUrl(item.url);if(!url||!allowed(item.url))return[];const sourceKey=stableHash(item.url);
  return visits.filter(visit=>visit.isLocal===true&&visit.visitId&&Number.isFinite(visit.visitTime)&&visit.visitTime>=run.range.from&&visit.visitTime<=run.range.to).map(visit=>({
    id:'bh:'+sourceKey+':'+visit.visitId,sourceKey,nativeVisitId:String(visit.visitId),historyId:String(item.id||''),pageId:pageIdForUrl(url),url,
    title:cleanTitle(item.title,url),visitedAt:visit.visitTime,transition:visit.transition||'',isLocal:true,runId:run.runId,importedAt:run.now||Date.now()}));
}

/** Time-window enumeration never persists raw history URLs; raw URLs are reacquired on each short step. */
export function createBrowserHistory(deps){
  const {store,api}=deps,now=deps.now||Date.now;let running=false;
  const permitted=()=>api.permissions.contains({permissions:['history']});
  async function disconnect(){const settings=await store.disconnectBrowserHistory();await deps.onSettings(settings);deps.invalidate();return status(false);}
  async function status(checkPermission=true){
    const enabled=deps.settings().historyEnabled;
    if(checkPermission&&enabled&&!await permitted())return disconnect();
    const [job,count,coverage]=await Promise.all([store.getHistoryImport(),store.countBrowserHistory(),store.getMeta('historyCoverage')]);
    const publicJob=job&&{id:job.runId,status:job.status,range:job.range,at:job.at,updatedAt:job.updatedAt,error:job.error||'',processed:job.completedKeys.length,
      checkedVisits:job.checkedVisits||0,pendingWindows:job.windows.length,scannedWindows:job.scannedWindows||0,skippedVisits:job.skippedVisits||0};
    return{enabled,days:deps.settings().historyDays,job:publicJob,count,coverage};
  }
  async function start(message={}){
    if(!await permitted())throw failure('PERMISSION_REQUIRED','请先点击启用并授权读取浏览器历史。');
    let job=message.resume?await store.getHistoryImport():null;
    if(message.resume&&(!job||!['failed','cancelled','stale','queued','running'].includes(job.status)))throw failure('HISTORY_JOB_NOT_FOUND','没有可继续的导入，请重新选择日期范围。');
    if(!job||job.status==='stale'){
      const range=historyRange(message.days||deps.settings().historyDays||30,now());
      job={id:'active',runId:crypto.randomUUID(),generation:crypto.randomUUID(),revision:0,at:now(),updatedAt:now(),range,status:'queued',
        windows:[{from:range.from,to:range.to,limit:500}],completedKeys:[],checkedVisits:0,skippedVisits:0,scannedWindows:0,error:''};
    }else job={...job,generation:crypto.randomUUID(),revision:job.revision+1,status:'queued',error:'',updatedAt:now()};
    const settings=await store.beginHistoryImport(job);await deps.onSettings(settings);deps.invalidate();return status();
  }
  async function cancel(){await store.cancelHistoryImport('已停止导入，保留已核对的缓存；可继续或重新选择范围。');deps.invalidate();return status();}
  async function step(){
    if(running)return status();
    const enabled=deps.settings().historyEnabled;if(!enabled)return status(false);
    if(!await permitted())return disconnect();
    let job=await store.getHistoryImport();if(!job||!['queued','running'].includes(job.status))return status(false);
    running=true;
    try{
      job={...job,status:'running',updatedAt:now(),error:''};
      if(!job.windows.length){job.status='done';await store.writeHistoryStep(job,[]);deps.invalidate();return status(false);}
      const window=job.windows[0],items=await api.history.search({text:'',startTime:window.from,endTime:window.to,maxResults:window.limit});
      if(items.length>=window.limit){
        if(window.to-window.from>1){const middle=Math.floor((window.from+window.to)/2);job.windows.splice(0,1,{from:window.from,to:middle,limit:500},{from:middle,to:window.to,limit:500});}
        else if(window.limit<64000)job.windows[0]={...window,limit:Math.min(64000,window.limit*2)};
        else throw failure('HISTORY_RANGE_INCOMPLETE','同一时刻的历史条目达到浏览器可枚举边界，这个范围尚未完成，请缩小范围后重试。');
        await store.writeHistoryStep(job,[]);return status(false);
      }
      const completed=new Set(job.completedKeys);
      const pending=items.filter(item=>item.url&&!completed.has(stableHash(item.url))).slice(0,48),records=[];
      for(let offset=0;offset<pending.length;offset+=6){
        const batch=await Promise.all(pending.slice(offset,offset+6).map(async item=>{
          if(!normalizeUrl(item.url)||!deps.allowed(item.url))return{item,visits:[],records:[]};
          const visits=await api.history.getVisits({url:item.url});return{item,visits,records:historyRecords(item,visits,{...job,now:now()},deps.allowed)};
        }));
        for(const result of batch){completed.add(stableHash(result.item.url));records.push(...result.records);job.checkedVisits+=result.records.length;job.skippedVisits+=result.visits.length-result.records.length;}
      }
      job.completedKeys=[...completed];
      if(items.every(item=>!item.url||completed.has(stableHash(item.url)))){job.windows.shift();job.scannedWindows++;}
      job.status=job.windows.length?'queued':'done';job.updatedAt=now();
      await store.writeHistoryStep(job,records.filter(record=>deps.allowed(record.url)));deps.invalidate();
    }catch(error){
      if(error.code!=='STALE_HISTORY_IMPORT'){
        const current=await store.getHistoryImport();
        if(current?.generation===job.generation&&['queued','running'].includes(current.status)){
          try{await store.writeHistoryStep({...current,status:'failed',error:error.message,updatedAt:now()},[]);}catch(value){if(value.code!=='STALE_HISTORY_IMPORT')throw value;}
        }
      }
    }finally{running=false;}
    return status(false);
  }
  async function remove(removed){
    if(!deps.settings().historyEnabled)return;
    const urls=removed.urls||[],result=await store.removeBrowserHistory({all:removed.allHistory===true,sourceKeys:urls.map(stableHash)});deps.invalidate();
    if(removed.allHistory||!await permitted())return;
    const metadata=new Map(result.removed.map(row=>[row.sourceKey,row]));
    const records=[];
    for(const raw of urls){const old=metadata.get(stableHash(raw));if(!old||!deps.allowed(raw))continue;
      const visits=await api.history.getVisits({url:raw});records.push(...historyRecords({id:old.historyId,url:raw,title:old.title},visits,
        {runId:old.runId,range:historyRange(deps.settings().historyDays,now()),now:now()},deps.allowed));}
    if(await store.reconcileHistorySources(result.generation,records))deps.invalidate();
  }
  return{status,start,cancel,step,disconnect,remove};
}
