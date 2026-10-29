import {el} from './ui.js';

const names={'capture.state':'采集状态','semantic.run':'本机分析','ai.request':'AI 接口请求','prediction.result':'下一步候选生成',
  'prediction.shown':'下一步候选已展示','prediction.opened':'打开页面或查看任务','completion.result':'文字候选生成','completion.shown':'文字候选已展示',
  'completion.adopted':'采用文字候选','completion.saved':'候选原样保存到断点','checkpoint.saved':'保存断点','focus.continued':'继续任务','focus.selected':'选择当前聚焦','focus.paused':'暂停当前聚焦',
  'group.preview':'分组预览','group.apply':'应用分组','group.undo':'撤销分组','runtime.error':'运行异常'};
const statuses={active:'正在记录前台访问',unfocused:'浏览器未处于前台',paused:'浏览记录已暂停',idle:'设备暂离',locked:'设备已锁定',
  excluded:'站点已排除',unsupported:'当前页面无需记录',incognito:'无痕页面不记录','no-tab':'未找到活动页面'};
const outcomes={success:'完成',empty:'没有候选或可撤销项',error:'失败',cancelled:'取消或已过期'};
const sources={local:'本机',api:'AI'};
const reasons={'no-focused-window':'没有聚焦的普通窗口','multiple-focused-windows':'浏览器报告了多个聚焦窗口','tracking-paused':'浏览记录已暂停',
  foreground:'有效的前台页面',idle:'设备暂离',locked:'设备锁定',excluded:'站点排除',unsupported:'页面类型不记录',incognito:'无痕页面','no-tab':'没有活动标签页'};
const errors={AI_DISABLED:'AI 未启用',AI_PERMISSION:'服务站点未授权',AI_CONFIG:'服务配置无效',AI_INPUT:'输入或资料不足',AI_HTTP:'服务返回错误',AI_TIMEOUT:'服务超时',
  AI_NETWORK:'连接失败',AI_RESPONSE:'候选格式不可用',AI_STALE:'请求已过期',STALE_PREDICTION:'候选已过期',STALE_TASK:'任务已更新',STALE_CONTEXT:'聚焦已改变',
  STALE_PROPOSAL:'分组预览已过期',STALE_SUGGESTION:'来源已改变',CANCELLED:'已取消',STORAGE_QUOTA:'本机空间不足',MODEL_ERROR:'本机模型异常',INVALID_QUERY:'输入无效',INTERNAL:'内部异常'};
const caption=text=>el('p',{class:'memory-caption'},text);
const num=value=>value==null?'—':value.toLocaleString('zh-CN');
const percent=value=>value==null?'—':(value*100).toFixed(1)+'%';
const ms=value=>value==null?'—':value<1000?num(value)+' ms':(value/1000).toFixed(2)+' 秒';
const stamp=value=>value?new Date(value).toLocaleString('zh-CN',{hour12:false}):'尚无记录';

export function createDiagnosticsUI({request,demo=false}) {
  let host,data=null,range='24h',pending=false,attempted=false,notice='',confirm=false,serial=0,updatedAt=null,restoreFocus='';
  function button(text,id,callback,disabled=false){const node=el('button',{type:'button',id,class:'btn small',disabled:disabled||pending||demo},text);node.addEventListener('click',callback);return node;}
  const metric=(label,value,detail)=>el('div',{class:'diagnostics-metric'},el('dt',{},label),el('dd',{},value),caption(detail));
  async function refresh(){
    if(demo)return;
    const turn=++serial;pending=true;attempted=true;notice='';draw();
    try{const result=await request('GET_DIAGNOSTICS',{range});if(turn===serial){data=result;updatedAt=Date.now();}}
    catch(error){if(turn===serial)notice=error.message||'运行记录暂时无法读取。';}
    finally{if(turn===serial){pending=false;draw();}}
  }
  async function mutate(type,payload={}){
    pending=true;notice='';draw();
    try{await request(type,payload);confirm=false;if(type==='CLEAR_DIAGNOSTICS')restoreFocus='diagnostics-clear';pending=false;await refresh();}
    catch(error){notice=error.message||'操作未完成，请重试。';pending=false;draw();}
  }
  async function download(){
    pending=true;notice='';draw();
    try{const snapshot=await request('EXPORT_DIAGNOSTICS');if(!snapshot.health?.available||!Array.isArray(snapshot.events))throw Error('运行日志暂不可用，暂时无法导出。');
      const url=URL.createObjectURL(new Blob([JSON.stringify(snapshot,null,2)],{type:'application/json'}));
      const link=el('a',{href:url,download:'focuence-diagnostics-'+new Date().toISOString().slice(0,10)+'.json'});link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
      notice='已导出本机运行日志。文件包含事件时间与用量统计，请自行保管。';
    }catch(error){notice=error.message||'导出未完成，请重试。';}
    finally{pending=false;draw();}
  }
  function draw(){
    if(!host)return;
    const inSection=host.contains(document.activeElement)?document.activeElement?.id:null;
    if(inSection)restoreFocus=inSection;
    const focused=inSection||(!pending&&['BODY','MAIN'].includes(document.activeElement?.tagName)?restoreFocus:null);
    const toggle=el('input',{id:'diagnostics-enabled',type:'checkbox',checked:data?.enabled??true,disabled:pending||demo||!data});
    toggle.addEventListener('change',event=>mutate('SET_DIAGNOSTICS',{enabled:event.target.checked}));
    const select=el('select',{id:'diagnostics-range',class:'standard-select','aria-label':'运行分析时间范围',disabled:demo||pending},
      el('option',{value:'24h',selected:range==='24h'},'最近 24 小时'),el('option',{value:'7d',selected:range==='7d'},'最近 7 天'));
    select.addEventListener('change',event=>{range=event.target.value;refresh();});
    const statusText=demo?'示例不读取或写入真实运行日志。':notice||(pending?'正在读取本机运行记录…':data?.health?.available?(data.enabled?'本机日志已开启':'本机日志已关闭，已有记录保留')+(updatedAt?' · 更新于 '+stamp(updatedAt):''):'本机运行日志暂不可用，主要功能仍可使用。');
    host.replaceChildren(el('h2',{},'运行与记录'),caption('检查采集、建议和分组是否顺畅。日志仅保存在本机，保留 7 天、最多 5,000 条；不记录标题、网址、输入原文或密钥。'),
      el('div',{class:'diagnostics-controls'},el('label',{class:'memory-checkbox'},toggle,'启用本机运行日志'),select,button(pending?'正在读取…':'刷新记录','diagnostics-refresh',refresh)),
      caption('日志开关立即生效。暂停浏览记录时不记候选采用、保存和分组等行为；无内容的服务诊断继续保留。关闭日志可停止全部新增记录。'),
      el('p',{id:'diagnostics-status',class:'diagnostics-status',role:'status'},statusText));
    if(demo){host.append(caption('实际扩展可查看耗时、tokens、候选采用与分组记录。'));return;}
    if(data?.health?.dropped)host.append(caption('本次运行有 '+num(data.health.dropped)+' 条日志未能保存；以下统计可能不完整。'));
    if(data?.capacityTrimmed)host.append(caption('日志曾达到容量上限，已移除 '+num(data.capacityTrimmed)+' 条早期记录；以下为当前保留样本。'));
    const summary=data?.summary;
    if(summary){
      host.append(caption('统计窗口：'+stamp(Math.max(summary.since,data.startedAt||0))+' — '+stamp(summary.until)+' · '+num(summary.events)+' 条保留记录。关闭或暂停期间未记录的行为不补记。'));
      const api=summary.api,next=summary.prediction,text=summary.nextStep,search=summary.search,model=summary.semantic;
      host.append(el('dl',{class:'diagnostics-metrics'},
        metric('AI 接口请求',num(api.calls),'完成 '+num(api.success)+' · 失败 '+num(api.errors)+' · 取消 '+num(api.cancelled)),
        metric('接口用时中位数',ms(api.latency.p50),'95 分位 '+ms(api.latency.p95)+' · '+num(api.latency.samples)+' 个样本'),
        metric('已报告 tokens',api.inputTokens==null?'—':num(api.inputTokens+api.outputTokens),'输入 '+num(api.inputTokens)+' · 输出 '+num(api.outputTokens)+'；完整用量 '+num(api.usageSamples)+' / '+num(api.calls)+' 次'),
        metric('AI 模式回退',percent(summary.generation.fallbackRate),num(summary.generation.fallback)+' / '+num(summary.generation.apiMode)+' 次；关闭 AI 的本机模式不计故障回退')));
      host.append(el('div',{class:'diagnostics-flow'},el('h3',{},'建议是否被使用'),
        caption('下一步资料：实际展示 '+num(next.shown)+' 次 → 打开页面或查看任务 '+num(next.acted)+' 次（'+percent(next.actionRate)+'）。'),
        caption('下一步文字：实际展示 '+num(text.shown)+' 次 → 采用 '+num(text.acted)+' 次 → 原样保存到断点 '+num(text.saved)+' 次。'),
        caption('查找文字：实际展示 '+num(search.shown)+' 次 → 采用 '+num(search.acted)+' 次（'+percent(search.actionRate)+'）。'),
        caption('候选显示用时中位数：资料建议 '+ms(next.renderLatency.p50)+' · 下一步文字 '+ms(text.renderLatency.p50)+' · 查找文字 '+ms(search.renderLatency.p50)+'，含已保留的本机与 AI 样本。'),
        caption('同一次候选只计一次。只有本期有展示记录的行为进入上述统计；采用不等于准确或实际节省时间。'),
        next.unmatched+text.unmatched+search.unmatched>0&&caption('另有 '+num(next.unmatched+text.unmatched+search.unmatched)+' 次后续行为缺少本期展示或采用记录，未混入采用比例。')));
      host.append(el('div',{class:'diagnostics-flow'},el('h3',{},'采集、本机分析与分组'),
        caption('最近采集状态：'+(statuses[summary.capture.latest?.status]||'尚无状态样本')+(summary.capture.latest?.reason?' · '+(reasons[summary.capture.latest.reason]||''):'')),
        caption('采集状态变化与定期样本 '+num(summary.capture.samples)+' 条；用于排错，不是浏览成功率或注意力时长。'),
        caption('本机分析 '+num(model.runs)+' 次 · 用时中位数 '+ms(model.latency.p50)+' · 排队中位数 '+ms(model.queueLatency.p50)+' · 复用缓存 '+num(model.cached)+' 项 / 新计算 '+num(model.computed)+' 项。'),
        caption('分组预览 '+num(summary.grouping.previews)+' 次 → 应用 '+num(summary.grouping.applied)+' 次；撤销 '+num(summary.grouping.undone)+' 次，失败 '+num(summary.grouping.errors)+' 次。'),
        caption('选择聚焦 '+num(summary.focus.selected)+' 次 · 暂停聚焦 '+num(summary.focus.paused)+' 次 · 保存断点 '+num(summary.focus.checkpoints)+' 次 · 继续任务 '+num(summary.focus.continued)+' 次。')));
      const recent=el('details',{class:'diagnostics-recent'},el('summary',{},'最近运行记录 · '+num(data.recent?.length||0)+' 条'));
      for(const row of data.recent||[]){const details=[outcomes[row.outcome],statuses[row.status],sources[row.source],row.field==='search'?'查找补全':row.field==='nextStep'?'下一步补全':'',
        row.candidateCount==null?'':num(row.candidateCount)+' 项候选',row.elapsedMs==null?'':ms(row.elapsedMs),row.errorCode?errors[row.errorCode]||'异常':''].filter(Boolean).join(' · ');
        recent.append(el('article',{class:'diagnostics-row'},el('time',{datetime:new Date(row.at).toISOString()},stamp(row.at)),el('div',{},el('strong',{},names[row.kind]||'运行记录'),caption(details||reasons[row.reason]||'已记录'))));}
      if(!data.recent?.length)recent.append(caption(data.enabled?'暂时没有运行记录，正常使用后会逐渐积累。':'日志已关闭，目前没有保留记录。'));
      host.append(recent);
    }
    host.append(el('div',{class:'diagnostics-controls'},button('导出运行日志','diagnostics-export',download,!data?.health?.available),button('清空运行日志','diagnostics-clear',()=>{confirm=true;draw();document.getElementById('diagnostics-clear-confirm')?.focus();},!data?.health?.available)));
    if(confirm)host.append(el('section',{class:'diagnostics-confirm',role:'alert'},caption('清空这台浏览器的运行日志和统计？任务、浏览记录与 AI 配置会保留。此操作无法撤销。'),
      el('div',{class:'diagnostics-controls'},button('确认清空','diagnostics-clear-confirm',()=>mutate('CLEAR_DIAGNOSTICS')),button('保留日志','diagnostics-clear-cancel',()=>{confirm=false;draw();document.getElementById('diagnostics-clear')?.focus();}))));
    if(focused){const target=host.querySelector('#'+CSS.escape(focused));if(target&&!target.disabled){target.focus({preventScroll:true});restoreFocus='';}}
  }
  return {view(){host=el('section',{id:'diagnostics-section',class:'settings-section diagnostics-section','aria-label':'运行与记录'});draw();if(!attempted&&!demo)queueMicrotask(refresh);return host;},
    reset(){serial++;data=null;attempted=false;notice='';confirm=false;pending=false;if(host?.isConnected)refresh();}};
}
