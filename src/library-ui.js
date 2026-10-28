import {el} from './ui.js';
import {openWorkspace} from './navigation.js';
import {createDraftGuard} from './draft-guard.js';
const stamp=value=>new Date(value).toLocaleString('zh-CN');
const caption=value=>el('p',{class:'memory-caption'},value);

/** One material form and detail view for full workspace, sidebar and popup. */
export function createLibraryUI({getState,request,render,refresh,notify,getWindowId,demo=false,surface='workspace'}){
  let listing=null,loading=false,error='',query='',taskId='',kind='',offset=0,loadedEpoch,serial=0,capture=null,initialized=false;
  let dialog=null,form=null,busy=false,returnFocus='',draftGuard=null;
  const tasks=()=>getState()?.tasks||[];
  function button(label,id,callback,primary=false){const node=el('button',{id:'library-'+id,type:'button',class:'memory-button'+(primary?' primary':''),disabled:busy},label);node.addEventListener('click',()=>Promise.resolve(callback()).catch(value=>notify(value.message,true)));return node;}
  async function read(){
    const token=++serial;loading=true;error='';loadedEpoch=getState()?.work?.epoch;render();
    try{const [rows,status]=await Promise.all([request('LIST_LIBRARY',{query,taskId,kind,offset}),request('GET_LIBRARY_CAPTURE')]);if(token!==serial)return;listing=rows;capture=status;}
    catch(value){if(token===serial)error=value.message;}finally{if(token===serial){loading=false;render();}}
  }
  function close(){if(busy)return;const finish=()=>dialog?.close();if(draftGuard)draftGuard.requestExit(finish);else finish();}
  function frame(title,description){
    if(!dialog?.open){dialog?.remove();returnFocus=document.activeElement?.id||'';dialog=el('dialog',{class:'memory-dialog library-dialog','aria-labelledby':'library-dialog-title'});document.body.append(dialog);dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.addEventListener('close',()=>{draftGuard?.dispose();draftGuard=null;form=null;document.getElementById(returnFocus)?.focus({preventScroll:true});});dialog.showModal();}
    dialog.replaceChildren(el('div',{class:'memory-heading'},el('h2',{id:'library-dialog-title'},title),button('关闭','close',close)),caption(description));return dialog;
  }
  async function detail(id){
    const item=await request('GET_LIBRARY_ITEM',{id});draftGuard?.dispose();draftGuard=null;form=null;
    const root=frame(item.title,item.kind==='excerpt'?'已保存在本机的摘录；网页后续变化不会改写这份原文。':'已保存在本机的链接与笔记。');
    root.append(caption(item.url),item.parentUrl?caption('所在页面：'+item.parentUrl):el('span'),caption('保存 '+stamp(item.createdAt)+' · 修改 '+stamp(item.updatedAt)),caption('关联任务：'+(item.taskIds.map(id=>tasks().find(task=>task.id===id)?.name||'已删除任务').join('、')||'未关联')),
      el('div',{class:'library-text-columns'},item.kind==='excerpt'&&el('section',{},el('h3',{},'摘录原文'),el('p',{class:'library-original'},item.quote)),el('section',{},el('h3',{},'自己的笔记'),el('p',{class:'library-original'},item.note||'暂无笔记。'))),
      el('div',{class:'memory-actions'},button('打开来源','open-source',()=>request('OPEN_PAGE',{url:item.url,windowId:getWindowId()})),button('编辑与关联任务','edit',()=>editor(item)),
        surface!=='workspace'&&!demo&&button('在完整工作台查看','open-workspace',()=>openWorkspace({view:'library',item:item.id,windowId:getWindowId()})),
        button('删除材料','delete',()=>{const box=frame('删除这份材料？','将删除这份原文、笔记及其任务关联，任务本身保留。');box.append(caption(item.title),button('确认删除','confirm-delete',async()=>{await request('DELETE_LIBRARY_ITEM',{id:item.id,revision:item.revision});dialog.close();await refresh();await read();notify('材料已删除。');},true));})));
  }
  function editor(item={},draftId=''){
    draftGuard?.dispose();
    form={kind:'link',url:'',title:'',quote:'',note:'',taskIds:[],source:'manual',sourceVerified:false,...structuredClone(item),...(draftId?{draftId}:{}),error:'',duplicate:null};drawEditor();
    draftGuard=createDraftGuard({root:()=>dialog,id:'library-draft',snapshot:()=>({kind:form.kind,url:form.url,title:form.title,quote:form.quote,note:form.note,taskIds:form.taskIds.slice().sort(),sourceVerified:form.sourceVerified}),fallback:()=>document.getElementById('library-field-title')});
  }
  function drawEditor(){
    const focused=document.activeElement,focusId=focused?.id,selection=typeof focused?.selectionStart==='number'?[focused.selectionStart,focused.selectionEnd]:null;
    const item=form,root=frame(item.id&&!item.draftId?'编辑材料':'保存研究材料',item.draftId?'核对浏览器传入的选文及实际来源。草稿仅保留在当前浏览器会话，15 分钟未保存即失效。':'原文和自己的笔记分别保存；每栏最多 20,000 个字符。');
    const field=(label,key,type='textarea',rows=3)=>el('label',{},label,type==='textarea'?el('textarea',{id:'library-field-'+key,'data-library-field':key,rows},item[key]||''):el('input',{id:'library-field-'+key,'data-library-field':key,type,value:item[key]||'',required:key==='url'}));
    const body=el('form',{id:'library-editor',class:'memory-form'},
      el('label',{},'材料类型',el('select',{id:'library-field-kind'},[['link','链接'],['excerpt','摘录']].map(([value,label])=>el('option',{value,selected:item.kind===value},label)))),
      field('标题','title','text'),field(item.parentUrl?'选文实际来源（frame）':'来源地址','url','url'),item.parentUrl&&caption('所在页面：'+item.parentUrl),
      item.kind==='excerpt'&&field('摘录原文','quote','textarea',6),el('p',{id:'library-count-quote',class:'memory-caption'},'原文 '+[...item.quote].length+' / 20,000'),field('自己的笔记','note','textarea',4),el('p',{id:'library-count-note',class:'memory-caption'},'笔记 '+[...item.note].length+' / 20,000'),
      el('fieldset',{class:'library-tasks'},el('legend',{},'关联任务（可多选）'),tasks().length?tasks().map(task=>el('label',{},el('input',{type:'checkbox','data-library-task':task.id,checked:item.taskIds.includes(task.id)}),el('span',{},task.name))):caption('暂无任务，可先保存，之后再关联。')),
      item.source==='selection'&&el('label',{class:'memory-checkbox'},el('input',{id:'library-source-verified',type:'checkbox',checked:item.sourceVerified,required:true}),'我已核对选文和实际来源'),
      item.error&&el('p',{class:'memory-form-error',role:'alert',tabindex:'-1'},item.error),
      item.errorCode==='TASK_NOT_FOUND'&&button('更新任务列表，保留草稿','refresh-tasks',async()=>{await refresh();item.taskIds=item.taskIds.filter(id=>tasks().some(task=>task.id===id));item.error='任务列表已更新，已删除任务不再关联；请核对后保存。';item.errorCode='';drawEditor();}),
      item.errorCode==='STALE_LIBRARY'&&button(item.id?'读取最新材料以核对':'重新核对已有材料','read-latest',async()=>{if(!item.id){item.duplicate=null;return save();}try{item.latest=await request('GET_LIBRARY_ITEM',{id:item.id});}catch(value){item.error=value.message;item.deleted=value.code==='LIBRARY_NOT_FOUND';}drawEditor();}),
      item.deleted&&button('将这份草稿另存为新材料','save-new',()=>{delete item.id;delete item.revision;item.deleted=false;return save();}),
      item.latest&&el('details',{class:'library-duplicate',open:true},el('summary',{},'最新保存版本 · '+item.latest.title),caption(item.latest.url),el('h3',{},'最新原文'),el('p',{class:'library-original'},item.latest.quote||'链接材料'),el('h3',{},'最新笔记'),el('p',{class:'library-original'},item.latest.note||'暂无笔记'),caption('以上为最新保存版本。上方输入仍是你的草稿。'),button('已核对，按我的草稿保存','save-reviewed',()=>{item.revision=item.latest.revision;item.latest=null;item.errorCode='';return save();})),
      item.duplicate&&el('div',{class:'library-duplicate'},el('h3',{},'这份材料已经保存'),caption('已有：'+item.duplicate.title+'。复用保留已有标题和原文，并增加所选任务关联。'),
        item.note&&item.note!==item.duplicate.note&&caption('这次输入的笔记会在已有笔记之后追加，不覆盖原笔记。'),button(item.note&&item.note!==item.duplicate.note?'复用、关联并追加笔记':'复用并关联所选任务','reuse',()=>save(true),true)),
      el('div',{class:'memory-actions'},el('button',{id:'library-save',type:'submit',class:'memory-button primary',disabled:busy},busy?'正在保存…':'保存材料')));
    root.append(body);
    for(const control of body.querySelectorAll('input,textarea,select,button'))control.disabled=busy;
    body.addEventListener('input',event=>{const key=event.target.dataset.libraryField;if(key){item[key]=event.target.value;if(item.source==='selection'&&['url','quote'].includes(key)){item.sourceVerified=false;body.querySelector('#library-source-verified').checked=false;}if(['quote','note'].includes(key))document.getElementById('library-count-'+key).textContent=(key==='quote'?'原文 ':'笔记 ')+[...item[key]].length+' / 20,000';}});
    body.querySelector('#library-field-kind').addEventListener('change',event=>{item.kind=event.target.value;if(item.kind==='link'&&item.quote){item.error='草稿仍保留原文。清空原文后可存为链接，或切回摘录。';}drawEditor();});
    body.addEventListener('change',event=>{if(event.target.dataset.libraryTask){const selected=new Set(item.taskIds);if(event.target.checked)selected.add(event.target.dataset.libraryTask);else selected.delete(event.target.dataset.libraryTask);item.taskIds=[...selected];}if(event.target.id==='library-source-verified')item.sourceVerified=event.target.checked;});
    body.addEventListener('submit',event=>{event.preventDefault();save();});
    const previousFocus=focusId?document.getElementById(focusId):null,target=item.error?root.querySelector('[role="alert"]'):previousFocus&&root.contains(previousFocus)?previousFocus:body.querySelector('#library-field-title');
    if(target&&!target.disabled){target.focus({preventScroll:!item.error});if(selection&&typeof target.setSelectionRange==='function'&&target.tagName==='TEXTAREA')target.setSelectionRange(...selection);}
  }
  async function save(reuse=false){
    if(busy)return;busy=true;form.error='';drawEditor();
    try{
      const duplicate=form.duplicate,{error,errorCode,latest,deleted,expiresAt,duplicate:ignored,id,...data}=form;
      const result=await request(id&&!form.draftId?'UPDATE_LIBRARY_ITEM':'SAVE_LIBRARY_ITEM',{...data,...(id&&!form.draftId?{id}:{}),...(reuse?{reuseId:duplicate.id,reuseRevision:duplicate.revision,appendNote:!!form.note&&form.note!==duplicate.note}:{} )});
      if(result.duplicate){form.duplicate=result.duplicate;return;}
      dialog.close();form=null;await refresh();await read();notify(result.reused?'已复用材料并保存关联。':'材料已保存在本机。');
    }catch(value){if(form){form.error=value.message;form.errorCode=value.code;}else notify('材料已保存，界面刷新失败：'+value.message,true);}finally{busy=false;if(form)drawEditor();render();}
  }
  async function currentPage(){const tab=getState()?.tabs.find(tab=>tab.active);if(!tab)throw Error('当前没有可保存的普通网页，请手动填写来源。');editor({kind:'link',url:tab.url,title:tab.title,taskIds:getState()?.work?.current.taskId?[getState().work.current.taskId]:[]});}
  function enableCapture(){
    if(demo)return;const permission=chrome.permissions.request({permissions:['contextMenus']});permission.then(async granted=>{if(!granted){notify('未开启右键入口，仍可手动保存链接或摘录。',true);return;}capture=await request('SET_LIBRARY_CAPTURE',{enabled:true});render();}).catch(value=>notify(value.message,true));
  }
  async function initialize(){
    const params=new URLSearchParams(location.search);try{if(params.get('draft'))editor(await request('GET_LIBRARY_DRAFT',{id:params.get('draft')}),params.get('draft'));else if(params.get('item'))await detail(params.get('item'));else if(params.has('captureError')){const message=await request('GET_LIBRARY_CAPTURE_ERROR');if(message)notify(message,true);}}
    catch(value){error=value.message;render();}
  }
  function view(){
    if(!initialized){initialized=true;queueMicrotask(initialize);}
    if((!listing||loadedEpoch!==getState()?.work?.epoch)&&!loading){loading=true;queueMicrotask(read);}
    const search=el('form',{class:'library-list-filters'},el('label',{},'在资料库内查找',el('input',{id:'library-query',value:query,placeholder:'标题、原文、笔记或网址'})),el('label',{},'任务',el('select',{id:'library-task-filter'},el('option',{value:''},'全部任务'),taskId&&!tasks().some(task=>task.id===taskId)&&el('option',{value:taskId,selected:true},'已删除任务（请重新选择）'),tasks().map(task=>el('option',{value:task.id,selected:taskId===task.id},task.name)))),
      el('label',{},'类型',el('select',{id:'library-kind-filter'},[['','全部材料'],['link','链接'],['excerpt','摘录']].map(([value,label])=>el('option',{value,selected:kind===value},label)))),el('button',{type:'submit',class:'memory-button'},'筛选'));
    search.addEventListener('submit',event=>{event.preventDefault();query=search.querySelector('#library-query').value;taskId=search.querySelector('#library-task-filter').value;kind=search.querySelector('#library-kind-filter').value;offset=0;read();});
    search.addEventListener('input',event=>{if(event.target.id==='library-query')query=event.target.value;});
    search.addEventListener('change',event=>{if(event.target.id==='library-task-filter')taskId=event.target.value;if(event.target.id==='library-kind-filter')kind=event.target.value;});
    return el('section',{class:'library-workspace'},el('h1',{},'研究资料库'),caption('主动保存链接、选文和笔记。可关联多个任务，独立于历史保留期。'),
      el('div',{class:'memory-actions'},button('保存链接','new-link',()=>editor()),button('粘贴摘录','new-excerpt',()=>editor({kind:'excerpt'})),button('保存当前页','current',currentPage)),
      demo?caption('示例仅在当前页面演示手动保存；右键选文需在真实扩展中启用。'):el('div',{class:'memory-actions'},capture?.enabled?button('关闭右键采集','disable-capture',async()=>{capture=await request('SET_LIBRARY_CAPTURE',{enabled:false});await chrome.permissions.remove({permissions:['contextMenus']});render();}):button('启用右键保存选文','enable-capture',enableCapture)),search,
      loading&&el('p',{class:'memory-caption',role:'status'},'正在读取本机材料…'),error&&el('p',{class:'memory-form-error',role:'alert'},error),error&&button('重试读取','retry',read),
      el('div',{class:'library-list'},(listing?.items||[]).map(item=>el('article',{class:'memory-record'},el('h2',{},item.title),caption((item.kind==='excerpt'?'摘录':'链接')+' · 修改 '+stamp(item.updatedAt)),caption(item.url),el('p',{class:'memory-snippet'},item.preview||item.notePreview),caption(item.taskIds.map(id=>tasks().find(task=>task.id===id)?.name||'已删除任务').join(' · ')||'未关联任务'),button('查看原文与笔记','detail-'+item.id,()=>detail(item.id))))),
      !loading&&!listing?.total&&caption('还没有符合条件的材料。保存一个链接或粘贴摘录即可开始。'),listing?.total>0&&el('div',{class:'memory-actions'},offset>0&&button('上一页','prev',()=>{offset=Math.max(0,offset-25);return read();}),caption((offset+1)+'—'+Math.min(offset+25,listing.total)+' / '+listing.total),offset+25<listing.total&&button('下一页','next',()=>{offset+=25;return read();})));
  }
  return{view,detail,editor,reload:read};
}
