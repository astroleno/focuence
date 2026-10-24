import {el} from './ui.js';
const pending=job=>['queued','running'].includes(job?.status);
const date=at=>at?new Date(at).toLocaleString('zh-CN'):'尚未读取';

/** Permission requests stay directly in the user's click handler. */
export function createHistoryUI({request,render,refresh,notify,demo=false,getState=()=>null}){
  let state=null,loading=false,error='',open=false,days=30,serial=0,busy=false,lastReadEpoch;
  async function read(advance=false){
    try{state=await request('GET_HISTORY_IMPORT',{advance});error='';days=state.days||days;}
    catch(value){error=value.message;}finally{loading=false;render();}
    return state;
  }
  async function poll(token){
    while(token===serial&&pending(state?.job)){
      await read(true);if(error)break;
      if(pending(state?.job))await new Promise(resolve=>setTimeout(resolve,180));
    }
    if(token===serial)await refresh();
  }
  async function act(type,payload={}){
    if(busy)return;busy=true;render();
    try{state=await request(type,payload);error='';serial++;if(pending(state.job))poll(serial).catch(value=>notify(value.message,true));else await refresh();}
    catch(value){error=value.message;notify(error,true);}finally{busy=false;render();}
  }
  function button(label,id,callback){const node=el('button',{id:'history-'+id,type:'button',class:'memory-button',disabled:busy},label);node.addEventListener('click',callback);return node;}
  function enable(){
    if(demo)return;
    const permission=chrome.permissions.request({permissions:['history']});
    permission.then(granted=>granted?act('START_HISTORY_IMPORT',{days}):notify('未授权读取浏览器历史。任务与自记录访问仍可使用。',true)).catch(value=>notify(value.message,true));
  }
  function view(compact=true){
    const epoch=getState()?.work?.epoch;
    if((!state||lastReadEpoch!==epoch)&&!loading&&!demo){lastReadEpoch=epoch;loading=true;queueMicrotask(()=>read().then(value=>{if(pending(value?.job))poll(++serial);}));}
    const job=state?.job,coverage=state?.coverage;
    const node=el(compact?'details':'section',{class:'memory-history',...(compact?{open}:{} )},
      compact?el('summary',{},'浏览器历史 · '+(state?.enabled?'已连接':'按需启用')):el('h2',{},'浏览器历史'),
      el('p',{class:'memory-caption'},'主动导入本设备访问。与前台记录分别管理；暂停记录期间不会自动补采。标题使用浏览器当前元数据，不提供停留时长。'),
      demo?el('p',{class:'memory-caption'},'请在真实扩展中启用；示例页面不会读取浏览器历史。'):el('div',{},
        el('label',{class:'history-range'},'导入并保留',el('select',{id:'history-days','aria-label':'历史导入及缓存范围'},[7,30,90].map(value=>el('option',{value,selected:days===value},'最近 '+value+' 天')))),
        el('div',{class:'memory-actions'},state?.enabled?button(pending(job)?'重新导入所选范围':'刷新所选范围','start',()=>act('START_HISTORY_IMPORT',{days})):button('启用并导入','enable',enable),
          pending(job)&&button('停止导入','cancel',()=>act('CANCEL_HISTORY_IMPORT')),
          ['failed','cancelled','stale'].includes(job?.status)&&button(job.status==='stale'?'重新核对范围':'继续导入','resume',()=>act('START_HISTORY_IMPORT',{resume:true,days})),
          state?.enabled&&button('断开并清除缓存','disconnect',()=>act('DISCONNECT_BROWSER_HISTORY').then(()=>chrome.permissions.remove({permissions:['history']}))))),
      loading&&el('p',{role:'status',class:'memory-caption'},'正在核对连接…'),
      error&&el('p',{role:'alert',class:'memory-form-error'},error),
      error&&button('重试读取','retry',()=>read()),
      state&&el('p',{class:'memory-caption'},'本机缓存 '+state.count+' 次访问'+(coverage?' · 已核对 '+date(coverage.range.from)+' — '+date(coverage.range.to)+(coverage.invalidated?' · 浏览器记录已改变，请刷新':''):' · 尚无完整范围快照')),
      job&&el('div',{role:'status'},el('p',{class:'memory-caption'},({queued:'正在导入',running:'正在导入',done:'所选范围已导入',failed:'导入未完成',cancelled:'导入已停止',stale:'范围需要重新核对'}[job.status]||job.status)+' · 已处理 '+job.processed+' 个地址 / '+job.checkedVisits+' 次本机访问 · 待核对 '+job.pendingWindows+' 个时间窗口'),
        job.error&&el('p',{class:'memory-form-error'},job.error)),
      el('p',{class:'memory-caption'},'刷新会完整核对所选范围，取消后保留已导入部分。断开、撤销权限或清除扩展历史会清理此缓存；主动保存的任务不受影响。'));
    node.querySelector('#history-days')?.addEventListener('change',event=>{days=Number(event.target.value);});
    if(compact)node.addEventListener('toggle',()=>{open=node.open;});return node;
  }
  window.addEventListener('pagehide',()=>serial++);
  if(!demo&&globalThis.chrome?.permissions?.onRemoved)chrome.permissions.onRemoved.addListener(()=>read());
  return{view,reload:()=>read()};
}
