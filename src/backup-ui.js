import {el} from './ui.js';
export function createBackupUI({request,render,refresh,notify,demo=false}){
  const ui={file:'',name:'',mode:'merge',choices:{},adoptSettings:false,preview:null,busy:false,error:'',point:null,loaded:false,restorePoint:false};
  const caption=text=>el('p',{class:'memory-caption'},text);
  const button=(label,handler,primary=false)=>{const node=el('button',{type:'button',class:'memory-button'+(primary?' primary':''),disabled:ui.busy},label);node.addEventListener('click',()=>run(handler));return node;};
  async function run(callback){if(ui.busy)return;ui.busy=true;ui.error='';render();try{await callback();}catch(error){ui.error=error.message;if(error.code==='IMPORT_PREVIEW_STALE')ui.preview=null;}finally{ui.busy=false;render();}}
  async function preview(){ui.preview=await request('PREVIEW_IMPORT',{...(ui.restorePoint?{restorePoint:true}:{data:ui.file}),mode:ui.mode,choices:ui.choices,adoptSettings:ui.adoptSettings});}
  function view(){
    if(demo)return el('section',{class:'browser-workspace'},el('h2',{},'导入与恢复'),caption('示例数据留在当前页面；安装后的扩展可预览备份冲突并原子恢复。'));
    if(!ui.loaded&&!ui.busy){ui.loaded=true;queueMicrotask(()=>run(async()=>{ui.point=await request('GET_RESTORE_POINT');}));}
    const root=el('section',{class:'browser-workspace','aria-label':'备份导入与恢复'},el('h2',{},'导入与恢复'),caption('先核对文件和冲突，再执行。导入前保留最近一次本机快照。'),ui.error&&el('p',{class:'w-error',role:'alert'},ui.error));
    const file=el('input',{id:'backup-file',type:'file',accept:'.json,application/json',disabled:ui.busy});
    file.addEventListener('change',()=>run(async()=>{const selected=file.files[0];if(!selected)return;ui.file=await selected.text();ui.name=selected.name;ui.restorePoint=false;ui.preview=null;ui.choices={};}));
    const mode=el('select',{id:'backup-mode','aria-label':'导入方式'},[['merge','合并，默认保留本机'],['replace','整体还原为备份']].map(([value,label])=>el('option',{value,selected:ui.mode===value},label)));
    mode.addEventListener('change',()=>{ui.mode=mode.value;ui.preview=null;render();});
    const settings=el('input',{id:'backup-settings',type:'checkbox',checked:ui.adoptSettings});settings.addEventListener('change',()=>{ui.adoptSettings=settings.checked;ui.preview=null;render();});
    root.append(el('label',{for:'backup-file',class:'w-field'},'选择 Focuence JSON 备份',file),ui.name&&caption('已选择：'+ui.name),mode,
      el('label',{for:'backup-settings'},settings,'合并时采用备份里的普通设置'),
      button(ui.restorePoint?'重新预览恢复点':'校验并预览导入',async()=>{if(!ui.restorePoint&&!ui.file)throw Error('请先选择备份文件。');await preview();}));
    if(ui.mode==='replace')root.append(caption('整体恢复会覆盖现有资料；浏览器标签页不会关闭。'));
    if(ui.point)root.append(button('预览恢复前快照 · '+new Date(ui.point.at).toLocaleString('zh-CN'),async()=>{ui.restorePoint=true;ui.mode='replace';ui.choices={};ui.name='恢复前快照';await preview();}));
    if(ui.preview){const value=ui.preview,c=value.counts;
      root.append(el('section',{class:'w-preview'},el('h3',{},'导入预览 · 格式 '+value.schemaVersion),caption(c.tasks+' 个任务 · '+c.relations+' 条关联 · '+c.pages+' 个页面 · '+c.segments+' 条访问'),
        caption('新增任务 '+c.newTasks+' 个 · 任务冲突 '+c.taskConflicts+' 个 · 重复访问 '+c.duplicateSegments+' 条'),
        value.mode==='replace'&&caption('将移除本机备份中没有的 '+c.removedTasks+' 个任务、'+c.removedSegments+' 条访问。'),
        value.conflicts.map(conflict=>{const select=el('select',{'aria-label':conflict.name+'的冲突选择'},el('option',{value:'local',selected:conflict.choice==='local'},'保留本机：'+conflict.localName),el('option',{value:'backup',selected:conflict.choice==='backup'},'使用备份：'+conflict.name));
          select.addEventListener('change',()=>run(async()=>{ui.choices[conflict.id]=select.value;await preview();}));return el('label',{class:'w-field'},'任务冲突',select);}),
        button(value.mode==='replace'?'按预览整体恢复':'按预览合并导入',async()=>{const result=await request('APPLY_IMPORT',{token:value.token});ui.preview=null;ui.point=await request('GET_RESTORE_POINT');await refresh();notify('资料已导入，恢复前快照已保存。');},true)));
    }
    return root;
  }
  return{view,reload:async()=>{ui.point=await request('GET_RESTORE_POINT');render();}};
}
