import {el} from './ui.js';
import {pageIdForUrl} from './text.js';

const caption=text=>el('p',{class:'memory-caption'},text);
export function createTabWorkspaceUI({request,getState,getWindowId,render,refresh,notify,demo=false}){
  const ui={catalog:null,operations:[],sessions:null,scope:'current',query:'',duplicates:false,selected:new Set(),snapshots:new Map(),acknowledged:new Set(),preview:null,restore:null,busy:false,error:'',loaded:false,at:0,
    taskId:'',name:'收起的页面',goal:'',progress:'',blocker:'',nextStep:'',pageId:''};
  function button(label,action,handler,primary=false){const node=el('button',{type:'button',class:'memory-button'+(primary?' primary':''),'data-w-action':action,disabled:ui.busy},label);node.addEventListener('click',()=>run(handler));return node;}
  async function run(callback){if(ui.busy)return;ui.busy=true;ui.error='';render();try{await callback();}catch(error){ui.error=error.message;}finally{ui.busy=false;render();}}
  async function load(){const [catalog,operations,sessions]=await Promise.all([request('LIST_WORKSPACE_TABS'),request('GET_TAB_OPERATIONS'),request('LIST_RECENTLY_CLOSED')]);
    ui.catalog=catalog;ui.operations=operations;ui.sessions=sessions;ui.loaded=true;ui.at=Date.now();}
  function rows(){return(ui.catalog?.tabs||[]).filter(tab=>(ui.scope==='all'||tab.windowId===(getWindowId()||getState()?.windowId))&&(!ui.duplicates||tab.duplicates.length)
    &&(!ui.query||[tab.title,tab.url].join(' ').toLocaleLowerCase().includes(ui.query.toLocaleLowerCase())));}
  function input(label,key,multiline=false){const id='w-field-'+key,node=el(multiline?'textarea':'input',{id,value:ui[key],...(multiline?{rows:2}:{type:'text'})});
    if(multiline)node.textContent=ui[key];node.addEventListener('input',()=>{ui[key]=node.value;ui.preview=null;});return el('label',{class:'w-field',for:id},label,node);}
  function renderPreview(){const plan=ui.preview;
    return el('section',{class:'w-preview','aria-label':'关闭前预览'},el('h3',{},'确认保存并关闭'),caption('任务「'+plan.taskName+'」将保存 '+plan.pages+' 个不同页面，关闭以下 '+plan.rows.length+' 个标签。'),
      caption('网址恢复不包含未保存的表单、登录状态或页面运行状态。请先保存网页中的编辑内容。'),
      el('div',{class:'w-scroll'},plan.rows.map(row=>el('p',{},row.title,el('small',{},'窗口 '+row.windowId+(row.pinned?' · 固定页':'')+(row.active?' · 当前页':'')+(row.groupId>=0?' · 已分组':''))))),
      button('保存成功后关闭这 '+plan.rows.length+' 页','execute',async()=>{const result=await request('EXECUTE_TAB_ACTION',{token:plan.token});ui.preview=null;ui.selected.clear();await load();await refresh();
        ui.snapshots.clear();ui.acknowledged.clear();notify('已关闭 '+result.closed+' 页；失败 '+result.failed+' 页；未执行或待核对 '+result.pending+' 页。',result.failed>0||result.pending>0);},true));
  }
  function operationRow(operation){return el('article',{class:'w-record'},el('div',{class:'w-heading'},el('strong',{},operation.taskName),caption(new Date(operation.at).toLocaleString('zh-CN'))),
    caption('关闭 '+operation.closed+' 页 · 失败 '+operation.failed+' 页 · 待核对 '+operation.pending+' 页'),
    operation.lastRestore&&caption('上次恢复：新开 '+operation.lastRestore.opened+' 页，复用 '+operation.lastRestore.reused+' 页，失败 '+operation.lastRestore.failed.length+' 项'),
    button('预览恢复本次关闭','restore-preview',async()=>{ui.restore=await request('PREVIEW_RESTORE_OPERATION',{id:operation.id,windowId:getWindowId()||getState()?.windowId});}));}
  function restorePreview(){const plan=ui.restore;
    const targets=new Map(plan.rows.map(row=>[row.key,row.windowId]));
    return el('section',{class:'w-preview'},el('h3',{},'恢复本次关闭'),caption('新开 '+plan.willOpen+' 页 · 复用 '+plan.reused+' 页。窗口目标如下；可先调整再重新预览。'),
      el('div',{class:'w-scroll'},plan.rows.map(row=>el('p',{},row.title,el('small',{},'恢复到窗口 '+row.windowId+(row.uncertain?' · 原关闭状态需核对':''))))),
      (()=>{const select=el('select',{id:'w-restore-target','aria-label':'恢复到其他窗口'},el('option',{value:''},'保留以上窗口分配'),(ui.catalog?.windows||[]).map(window=>el('option',{value:window.id},'全部恢复到窗口 '+window.id)));
        select.addEventListener('change',()=>run(async()=>{const operation=ui.operations.find(item=>item.id===plan.operationId),value=Number(select.value);if(value)ui.restore=await request('PREVIEW_RESTORE_OPERATION',{id:plan.operationId,windowId:value,targets:Object.fromEntries(operation.rows.map(row=>[row.windowId,value]))});}));return select;})(),
      button('按预览恢复页面','restore-apply',async()=>{const result=await request('RESTORE_TAB_OPERATION',{token:plan.token});ui.restore=null;await load();await refresh();notify('新开 '+result.opened+' 页，复用 '+result.reused+' 页，失败 '+result.failed.length+' 项。',result.failed.length>0);},true));
  }
  function sessionsView(){const state=ui.sessions;
    const section=el('section',{class:'w-section'},el('h3',{},'最近关闭'),caption('浏览器最多提供 25 条近期记录。保存关闭的操作另有本机恢复日志。'));
    if(!state?.enabled){const enable=el('button',{type:'button',class:'memory-button','data-w-action':'enable-sessions',disabled:ui.busy},'启用最近关闭');
      enable.addEventListener('click',()=>{const permission=chrome.permissions.request({permissions:['sessions']});run(async()=>{if(!await permission)throw Error('未授予会话权限，其他功能仍可使用。');await load();});});section.append(enable);return section;}
    section.append(button('刷新最近关闭','refresh-sessions',async()=>{ui.sessions=await request('LIST_RECENTLY_CLOSED');}));
    if(!state.items.length)section.append(caption('暂时没有可恢复的近期记录。'));
    for(const item of state.items)section.append(el('article',{class:'w-record'},el('strong',{},item.kind==='window'?'窗口 · '+item.pages.length+' 页':item.pages[0].title),
      caption(new Date(item.at).toLocaleString('zh-CN')),
      item.complete?button(item.kind==='window'?'恢复这个窗口':'恢复这个页面','recent-restore',async()=>{await request('RESTORE_RECENTLY_CLOSED',{id:item.id});await load();}):
        el('div',{},caption('有 '+item.omitted+' 个成员未列出；可逐项打开下列网址。'),item.pages.map(page=>button(page.title,'recent-open',async()=>{await request('OPEN_PAGE',{url:page.url,windowId:getWindowId()});})))));
    return section;
  }
  function view(){
    if(demo)return el('section',{class:'browser-workspace'},el('h2',{},'标签页工作区'),caption('跨窗口查找、保存后关闭和近期恢复在已安装扩展中使用。示例中的原有任务与查找仍可体验。'));
    if(!ui.loaded&&!ui.busy){ui.loaded=true;queueMicrotask(()=>run(load));}
    const visible=rows(),selected=(ui.catalog?.tabs||[]).filter(tab=>ui.selected.has(tab.id));
    const root=el('section',{class:'browser-workspace','aria-label':'标签页工作区'},el('div',{class:'w-heading'},el('h2',{},'标签页工作区'),button('刷新页面','refresh',load)),
      caption('先留下任务和下一步，再收起暂时不用的页面。'),ui.at?caption('读取于 '+new Date(ui.at).toLocaleTimeString('zh-CN')):null,ui.error&&el('p',{role:'alert',class:'w-error'},ui.error));
    const scope=el('select',{id:'w-window-scope','aria-label':'页面窗口范围'},[['current','当前窗口'],['all','全部普通窗口']].map(([value,label])=>el('option',{value,selected:ui.scope===value},label)));
    scope.addEventListener('change',()=>{ui.scope=scope.value;ui.selected.clear();ui.snapshots.clear();ui.acknowledged.clear();ui.preview=null;render();});
    const search=el('input',{id:'w-tab-query',type:'search',value:ui.query,placeholder:'查找标题或网址','aria-label':'查找标签页'});search.addEventListener('input',()=>{ui.query=search.value;render();});
    const duplicate=el('input',{id:'w-duplicates',type:'checkbox',checked:ui.duplicates});duplicate.addEventListener('change',()=>{ui.duplicates=duplicate.checked;ui.selected.clear();ui.snapshots.clear();ui.acknowledged.clear();ui.preview=null;render();});
    root.append(el('div',{class:'w-controls'},scope,search,el('label',{for:'w-duplicates'},duplicate,'只看重复网址')),
      caption(visible.length+' 页 · 已选 '+selected.length+' 页'+(ui.catalog?.omitted?' · '+ui.catalog.omitted+' 页因隐私或导航状态未列出':'')),
      button('选择未受保护页面','select-safe',async()=>{ui.selected.clear();ui.snapshots.clear();ui.acknowledged.clear();const keep=new Set();for(const group of ui.catalog.duplicateGroups||[]){const candidates=(ui.catalog.tabs||[]).filter(tab=>group.includes(tab.id));keep.add(candidates.find(tab=>tab.protection.length)?.id??group[0]);}
        for(const tab of visible)if(!tab.protection.length&&(!ui.duplicates||!keep.has(tab.id))){ui.selected.add(tab.id);ui.snapshots.set(tab.id,tab.identity);}ui.preview=null;}));
    root.append(el('div',{class:'w-scroll w-tabs'},visible.map(tab=>{const checkbox=el('input',{id:'w-tab-'+tab.id,type:'checkbox',checked:ui.selected.has(tab.id)});
      checkbox.addEventListener('change',()=>{if(checkbox.checked){ui.selected.add(tab.id);ui.snapshots.set(tab.id,tab.identity);if(tab.protection.length)ui.acknowledged.add(tab.id);}else{ui.selected.delete(tab.id);ui.snapshots.delete(tab.id);ui.acknowledged.delete(tab.id);}ui.preview=null;render();});
      return el('article',{class:'w-row'},el('label',{for:checkbox.id},checkbox,el('span',{},el('strong',{},tab.title),el('small',{},'窗口 '+tab.windowId+' · '+new URL(tab.url).hostname),
        tab.protection.length>0&&el('small',{class:'w-protected'},tab.protection.join(' · ')+'；勾选表示确认纳入关闭'))),
        button('定位','focus',async()=>{await request('FOCUS_TAB',{tabId:tab.id});}));})));
    if(!visible.length)root.append(caption(ui.catalog?'没有符合当前范围的页面。':'正在读取窗口…'));
    if(selected.length){
      const tasks=(getState()?.tasks||[]).filter(task=>!task.status||task.status==='active');
      const choice=el('select',{id:'w-target-task','aria-label':'保存到哪个任务'},el('option',{value:'',selected:!ui.taskId},'新建任务'),tasks.map(task=>el('option',{value:task.id,selected:ui.taskId===task.id},task.name)));
      choice.addEventListener('change',()=>{ui.taskId=choice.value;const task=tasks.find(item=>item.id===ui.taskId);ui.name=task?.name||'收起的页面';ui.goal=task?.goal||'';
        for(const key of ['progress','blocker','nextStep'])ui[key]=task?.checkpoint?.[key]||'';ui.pageId=task?.checkpoint?.page?.pageId||'';ui.preview=null;render();});
      const task=tasks.find(item=>item.id===ui.taskId),pages=[...new Map([...(task?.pages||[]),...selected.map(tab=>({...tab,pageId:pageIdForUrl(tab.url)}))].map(page=>[page.pageId,page])).values()];
      const page=el('select',{id:'w-continue-page','aria-label':'继续页面'},el('option',{value:''},'暂不指定继续页面'),pages.map(item=>el('option',{value:item.pageId,selected:ui.pageId===item.pageId},item.title)));
      page.addEventListener('change',()=>{ui.pageId=page.value;ui.preview=null;});
      root.append(el('section',{class:'w-section'},el('h3',{},'保存任务和断点'),choice,input('任务名称','name'),input('任务目标','goal',true),input('已做到哪里','progress',true),input('卡点','blocker',true),input('下一步','nextStep',true),page,
        button('预览保存并关闭','preview',async()=>{ui.preview=await request('PREVIEW_TAB_ACTION',{tabIds:selected.map(tab=>tab.id),snapshots:selected.map(tab=>({tabId:tab.id,identity:ui.snapshots.get(tab.id)})),confirmedProtected:selected.filter(tab=>ui.acknowledged.has(tab.id)).map(tab=>tab.id),
          kind:ui.duplicates?'duplicates':'park',taskId:ui.taskId||undefined,revision:task?.revision,name:ui.name,goal:ui.goal,checkpoint:{progress:ui.progress,blocker:ui.blocker,nextStep:ui.nextStep,pageId:ui.pageId||null}});},true)));
    }
    if(ui.preview)root.append(renderPreview());if(ui.restore)root.append(restorePreview());
    root.append(el('details',{class:'w-section'},el('summary',{},'保存关闭的记录 · '+ui.operations.length),ui.operations.length?ui.operations.map(operationRow):caption('本机恢复日志会在保存关闭后出现，保留 30 天。')),sessionsView());
    return root;
  }
  return{view,reload:()=>run(load)};
}
