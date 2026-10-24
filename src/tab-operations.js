import {tabIdentity,tabAllowed,protectionReasons,validateTabPlan} from './tab-workspace.js';
import {pageFromTab,normalizeUrl} from './text.js';
import {failure,assertRevision,taskText} from './task-context.js';
import {makeCheckpoint} from './checkpoints.js';
import {statusOf} from './task-lifecycle.js';

/** Browser side effects follow a committed recovery log; interrupted closes never resume automatically. */
export function createTabOperations(deps) {
  const previews=new Map(),restorePreviews=new Map();
  const now=deps.now||Date.now;
  function expire(){for(const map of [previews,restorePreviews])for(const [id,item]of map)if(item.at<now()-15*60000)map.delete(id);}
  async function preview(message){
    expire();const all=await deps.tabs(),ids=[...new Set(message.tabIds||[])];
    if(!ids.length)throw failure('INVALID_TAB_SELECTION','请选择需要保存关闭的页面。');
    const tabs=ids.map(id=>all.find(tab=>tab.id===id));
    if(tabs.some(tab=>!tab||!tabAllowed(tab,deps.allowed)))throw failure('STALE_TAB_PLAN','所选页面不再可处理，请重新读取。');
    if(message.snapshots)for(const tab of tabs)if(message.snapshots.find(row=>row.tabId===tab.id)?.identity!==await tabIdentity(tab))throw failure('STALE_TAB_PLAN','所选页面已改变，请刷新后重新勾选，再核对预览。');
    const confirmed=new Set(message.confirmedProtected||[]);
    if(tabs.some(tab=>protectionReasons(tab).length&&!confirmed.has(tab.id)))throw failure('PROTECTED_TAB','请在预览中逐项确认受保护页面。');
    if(!['park','duplicates'].includes(message.kind||'park'))throw failure('INVALID_TAB_ACTION','页面操作无效。');
    const existing=message.taskId?assertRevision(await deps.store.getTask(message.taskId),message.revision):null;
    if(existing&&statusOf(existing)!=='active')throw failure('TASK_INACTIVE','请先将目标任务设为进行中。');
    const pages=[...new Map([...(existing?.pages||[]),...tabs.map(tab=>{const page=pageFromTab(tab);return{pageId:page.id,url:page.url,title:page.title,tags:page.tags};})].map(page=>[page.pageId,page])).values()];
    if(pages.length>30)throw failure('TASK_PAGE_LIMIT','保存后将超过 30 个不同页面，请调整所选页面或目标任务。');
    const at=now(),task={...(existing||{id:'task_'+crypto.randomUUID(),revision:0,createdAt:at,color:'orange',notes:'',status:'active'}),
      name:taskText(message.name||existing?.name,'name',{required:true}),goal:taskText(message.goal??existing?.goal,'goal'),pages,updatedAt:at,revision:(existing?.revision||0)+1};
    if(message.checkpoint)task.checkpoint=makeCheckpoint(message.checkpoint,{task,relations:await deps.store.getRelations(),draft:null,now:at});
    const rows=await Promise.all(tabs.map(async tab=>({key:String(tab.id),tabId:tab.id,windowId:tab.windowId,index:tab.index,originalIndex:tab.index,identity:await tabIdentity(tab),
      url:normalizeUrl(tab.url),title:pageFromTab(tab).title,pinned:!!tab.pinned,active:!!tab.active,groupId:tab.groupId??-1,
      group:tab.groupId>=0?await deps.group(tab.groupId).catch(()=>null):null,closeState:'pending',restoreState:'pending'})));
    const baseline={};
    for(const tab of all.filter(tab=>!ids.includes(tab.id)&&tabAllowed(tab,deps.allowed))){const key=tab.windowId+'|'+normalizeUrl(tab.url);baseline[key]=(baseline[key]||0)+1;}
    const plan={token:crypto.randomUUID(),at,kind:message.kind||'park',task,expectedRevision:existing?.revision,rows,baseline,sessionId:deps.sessionId};
    await validateTabPlan(plan,all,deps.allowed);previews.set(plan.token,plan);
    return{token:plan.token,taskName:task.name,pages:pages.length,rows:rows.map(({identity,...row})=>row),kind:plan.kind,at};
  }
  async function execute(message){
    expire();const plan=previews.get(message.token);
    if(!plan||plan.sessionId!==deps.sessionId)throw failure('STALE_TAB_PLAN','预览已过期，请重新预览后再执行。');
    await validateTabPlan(plan,await deps.tabs(),deps.allowed);
    const log={id:crypto.randomUUID(),at:now(),sessionId:deps.sessionId,kind:plan.kind,taskId:plan.task.id,taskName:plan.task.name,rows:plan.rows,baseline:plan.baseline,status:'running'};
    await deps.save(plan.task,log,plan.expectedRevision);previews.delete(message.token);
    for(const row of log.rows){
      const live=await deps.tabs();
      try{await validateTabPlan({...plan,rows:[row],...(plan.kind==='duplicates'?{rows:plan.rows.filter(item=>item.closeState==='pending')}: {})},live,deps.allowed);}
      catch(error){row.closeState='failed';row.error=error.message;log.status='interrupted';break;}
      row.closeState='requested';await deps.store.putTabOperation(log);
      try{
        await deps.remove(row.tabId);
        const remains=await deps.getTab(row.tabId).catch(()=>null);
        row.closeState=remains?'failed':'closed';row.error=remains?'页面仍打开，可能未完成关闭。':'';
      }catch(error){row.closeState='failed';row.error=error.message;}
      if(row.closeState==='closed'){
        const fresh=await deps.tabs();
        for(const pending of log.rows.filter(item=>item.closeState==='pending'&&item.windowId===row.windowId&&item.index>row.index)){
          const tab=fresh.find(item=>item.id===pending.tabId);
          if(tab&&tab.index===pending.index-1&&await tabIdentity({...tab,index:pending.index})===pending.identity){pending.index=tab.index;pending.identity=await tabIdentity(tab);}
        }
      }
      await deps.store.putTabOperation(log);
    }
    log.status=log.status==='interrupted'?'interrupted':log.rows.every(row=>row.closeState==='closed')?'closed':'partial';
    await deps.store.putTabOperation(log);deps.invalidate();return summary(log);
  }
  function summary(log){return{...log,rows:log.rows.map(({identity,...row})=>row),closed:log.rows.filter(row=>row.closeState==='closed').length,
    failed:log.rows.filter(row=>row.closeState==='failed').length,pending:log.rows.filter(row=>['pending','requested','unknown'].includes(row.closeState)).length};}
  async function list(){return(await deps.store.listTabOperations()).map(summary);}
  async function previewRestore(message){
    expire();const log=await deps.store.getTabOperation(message.id);if(!log)throw failure('OPERATION_NOT_FOUND','恢复记录已清理。');
    const windows=await deps.windows(),normal=windows.filter(window=>window.type==='normal'&&!window.incognito);
    const fallback=message.windowId??normal.find(window=>window.focused)?.id??normal[0]?.id;
    if(!normal.some(window=>window.id===fallback))throw failure('NO_WINDOW','请选择一个普通窗口作为恢复目标。');
    const all=await deps.tabs(),counts=new Map(),used=new Set();
    const rows=[];
    for(const row of log.rows){
      if(row.closeState==='failed')continue;
      const sameSession=log.sessionId===deps.sessionId;
      const original=sameSession?all.find(tab=>tab.id===row.tabId):null;
      if(row.closeState==='pending'&&original)continue;
      if(row.closeState==='requested'&&original)continue;
      if(!deps.allowed(row.url))continue;
      const requested=message.targets?.[row.windowId];
      const target=requested??(sameSession&&normal.some(window=>window.id===row.windowId)?row.windowId:fallback);
      if(!normal.some(window=>window.id===target))throw failure('STALE_TAB_PLAN','恢复目标窗口已关闭，请重新选择。');
      const key=target+'|'+row.url,baseline=log.baseline[row.windowId+'|'+row.url]||0;
      const urlOf=tab=>normalizeUrl(tab.pendingUrl||tab.url);
      if(!counts.has(key))counts.set(key,all.filter(tab=>tab.windowId===target&&urlOf(tab)===row.url).slice(baseline));
      const candidates=counts.get(key),recorded=row.restoredSessionId===deps.sessionId?all.find(tab=>tab.id===row.restoredTabId&&tab.windowId===target&&urlOf(tab)===row.url&&!used.has(tab.id)):null;
      let existing=recorded;while(!existing&&candidates.length){const candidate=candidates.shift();if(!used.has(candidate.id))existing=candidate;}
      if(existing)used.add(existing.id);
      rows.push({key:row.key,url:row.url,title:row.title,windowId:target,reuseId:existing?.id??null,uncertain:row.closeState!=='closed',pinned:row.pinned,index:row.originalIndex??row.index,group:row.group,groupId:row.groupId});
    }
    const plan={token:crypto.randomUUID(),at:now(),operationId:log.id,rows,sessionId:deps.sessionId};restorePreviews.set(plan.token,plan);
    return{...plan,willOpen:rows.filter(row=>row.reuseId==null).length,reused:rows.filter(row=>row.reuseId!=null).length};
  }
  async function restore(message){
    expire();const plan=restorePreviews.get(message.token);if(!plan)throw failure('STALE_TAB_PLAN','恢复预览已过期，请重新读取。');
    const log=await deps.store.getTabOperation(plan.operationId);if(!log)throw failure('OPERATION_NOT_FOUND','恢复记录已清理。');
    restorePreviews.delete(plan.token);let opened=0,reused=0;const failed=[],groups=new Map();
    for(const row of plan.rows){
      const saved=log.rows.find(item=>item.key===row.key);
      try{
        if(!deps.allowed(row.url))throw Error('站点已排除，未恢复。');
        let tab=row.reuseId==null?null:await deps.getTab(row.reuseId).catch(()=>null);
        if(tab&&(tab.windowId!==row.windowId||normalizeUrl(tab.pendingUrl||tab.url)!==row.url))throw failure('STALE_TAB_PLAN','已有页面已改变，请重新预览恢复。');
        if(tab)reused++;else{
          tab=await deps.create({windowId:row.windowId,url:row.url,active:false,pinned:row.pinned,index:row.index});opened++;
          if(row.group&&!row.pinned){const key=row.windowId+'|'+row.groupId;if(!groups.has(key))groups.set(key,{windowId:row.windowId,info:row.group,ids:[]});groups.get(key).ids.push(tab.id);}
        }
        saved.restoredTabId=tab.id;saved.restoredSessionId=deps.sessionId;saved.restoreState='restored';saved.restoredAt=now();
        await deps.store.putTabOperation(log);
      }catch(error){saved.restoreState='failed';saved.restoreError=error.message;failed.push({key:row.key,title:row.title,error:error.message});await deps.store.putTabOperation(log);}
    }
    for(const group of groups.values())try{await deps.restoreGroup({...group,reuseGroup:log.sessionId===deps.sessionId});}catch(error){failed.push({title:'页面分组',error:error.message});}
    log.lastRestore={at:now(),opened,reused,failed};await deps.store.putTabOperation(log);deps.invalidate();return{opened,reused,failed};
  }
  return{preview,execute,list,previewRestore,restore,invalidate:()=>{previews.clear();restorePreviews.clear();}};
}
