import {el} from './ui.js';

const button=(label,id,callback,disabled=false)=>{
  const node=el('button',{type:'button',id,class:'memory-button',disabled},label);
  node.addEventListener('click',callback);return node;
};
const caption=text=>el('p',{class:'memory-caption'},text);
const basisLabel=candidate=>({checkpoint:'已确认的继续页',saved:'当前任务保存资料',confirmed:'你已确认相关',semantic:'语义关联 · 尚未确认',keywords:'关键词关联 · 尚未确认',task:'其他任务 · 推测相关',shared:'其他任务 · 共享确认资料',transition:'已观察转向 · 推测需要'}[candidate.basis||candidate.method]||'候选线索');

/** Candidates stay separate from confirmed text, task intent and observed map edges. */
export function createPredictionUI({getState,request,getWindowId,showTask,notify,demo=false}) {
  const clientId='prediction-'+crypto.randomUUID(), completions=new Map(),proofs=new Map(),shown=new Set();
  let next={pending:false,result:null,notice:'',serial:0,host:null,key:''};
  const stateKey=(taskId)=>{
    const state=getState(),task=state?.tasks.find(item=>item.id===(taskId||state.work?.current.taskId));
    return JSON.stringify([state?.work?.epoch,state?.work?.current.taskId,state?.work?.current.revision,task?.id,task?.revision,state?.ai]);
  };
  const visible=host=>host?.isConnected&&(!host.closest('dialog')||host.closest('dialog').open);
  const feedback=(result,action,extra={})=>{if(!demo&&result?.token)request('PREDICTION_FEEDBACK',{windowId:getWindowId(),token:result.token,action,...extra}).catch(()=>{});};
  function shownResult(result,host,started){if(result?.token&&result.candidates?.length&&visible(host)&&!shown.has(result.token)){shown.add(result.token);if(shown.size>40)shown.delete(shown.values().next().value);feedback(result,'shown',{elapsedMs:Math.max(0,performance.now()-(started||performance.now()))});}}
  const explanation=()=>demo?'示例使用本机线索，不连接 AI 服务。':getState()?.ai?.enabled?'点击时会把当前任务与有限候选标题发给已配置的 AI 服务。':'AI 未启用，按当前目标筛选本机断点、保存资料和关联线索。';

  function nextView() {
    const key=stateKey();
    if(next.key!==key){next={pending:false,result:null,notice:'',serial:next.serial+1,key,host:null};}
    const host=el('section',{class:'prediction-section',id:'next-prediction','aria-label':'下一步建议'});next.host=host;
    drawNext();return host;
  }
  function drawNext() {
    const host=next.host;if(!host)return;
    host.replaceChildren(el('div',{class:'memory-heading'},el('h2',{},'下一步可能需要'),button(next.pending?'正在找线索…':'建议下一步','predict-next',loadNext,next.pending)),
      caption('优先接上当前断点；其他关联仅作为候选，由你决定。'),caption(explanation()));
    if(next.notice)host.append(el('p',{class:'prediction-status',role:'status'},next.notice));
    const result=next.result;
    if(!result)return;
    host.append(caption(result.source==='api'?'AI 推测 · 尚未确认':'本机线索 · 按需选择'));
    if(!result.candidates.length)host.append(caption('暂时没有足够相关的候选。可补充任务目标、保存资料或分析相关页面。'));
    for(const candidate of result.candidates){
      const trigger=button(candidate.kind==='task'?'查看任务':'打开页面','prediction-open-'+encodeURIComponent(candidate.id),async()=>{
        trigger.disabled=true;
        try{
          if(next.key!==stateKey())throw Error('当前聚焦已改变，请重新获取建议。');
          const response=await request('OPEN_NEXT_SUGGESTION',{windowId:getWindowId(),token:result.token,id:candidate.id});
          if(response.taskId){const task=getState()?.tasks.find(item=>item.id===response.taskId);if(task){showTask(task);feedback(result,'opened',{choice:result.candidates.indexOf(candidate)});}}
        }catch(error){notify(error.message,true);}finally{if(trigger.isConnected)trigger.disabled=false;}
      });
      host.append(el('article',{class:'prediction-row'},el('div',{},el('h3',{},candidate.title),caption(basisLabel(candidate)),caption(candidate.reason)),trigger));
    }
    shownResult(result,host,next.started);
  }
  async function loadNext() {
    const serial=++next.serial,key=stateKey();next.pending=true;next.notice='';next.started=performance.now();drawNext();
    try{
      const result=await request('PREDICT_NEXT',{windowId:getWindowId(),clientId});
      if(serial!==next.serial||key!==stateKey()||!visible(next.host))return;
      next.result=result;next.notice=result.notice;
    }catch(error){if(serial===next.serial){next.notice=error.message;next.result=null;}}
    finally{if(serial===next.serial){const restore=['BODY','MAIN'].includes(document.activeElement?.tagName)||document.activeElement?.id==='predict-next';next.pending=false;drawNext();if(restore)document.getElementById('predict-next')?.focus({preventScroll:true});}}
  }

  function completion({inputId,field,task}) {
    const id='completion-'+inputId,key=stateKey(task?.id);
    let state=completions.get(inputId);
    if(!state||state.key!==key||(state.host?.closest('dialog')&&!state.host.closest('dialog').open)){proofs.delete(inputId);state={serial:(state?.serial||0)+1,pending:false,result:null,notice:'',key,taskId:task?.id};completions.set(inputId,state);}
    state.host=el('div',{id,class:'text-completion','aria-label':field==='search'?'查找文字补全':'下一步文字补全'});
    state.field=field;state.revision=task?.revision;
    drawCompletion(inputId,state);return state.host;
  }
  function drawCompletion(inputId,state) {
    const input=()=>document.getElementById(inputId),host=state.host;
    host.replaceChildren(button(state.pending?'正在补全…':'补全文字','complete-'+inputId,async()=>{
      if(state.pending||!input())return;
      const serial=++state.serial,original=input().value,key=stateKey(state.taskId);
      proofs.delete(inputId);state.pending=true;state.result=null;state.notice='';state.started=performance.now();drawCompletion(inputId,state);
      try{
        const result=await request('COMPLETE_TEXT',{windowId:getWindowId(),clientId:clientId+':'+inputId,field:state.field,text:original,
          ...(state.taskId?{taskId:state.taskId,revision:state.revision}:{})});
        if(serial!==state.serial||key!==stateKey(state.taskId)||!visible(state.host)||input()?.value!==original)return;
        state.result=result;state.original=original;state.notice=result.notice;
      }catch(error){if(serial===state.serial&&visible(state.host))state.notice=error.message;}
      finally{if(serial===state.serial){state.pending=false;if(visible(state.host)){drawCompletion(inputId,state);document.getElementById('complete-'+inputId)?.focus({preventScroll:true});}}}
    },state.pending),caption(demo?'示例仅使用本机补全。':getState()?.ai?.enabled?'点击后发送此输入及任务目标、确认断点；候选采用后才填入。':'使用本机已保存文字，候选采用后才填入。'));
    if(state.notice)host.append(el('p',{class:'prediction-status',role:'status'},state.notice));
    if(!state.result)return;
    host.append(caption(state.result.source==='api'?'AI 文字候选':'本机文字候选'));
    if(!state.result.candidates.length)host.append(caption('没有可用补全，可以直接继续输入。'));
    state.result.candidates.forEach((text,index)=>{
      const accept=button('采用','complete-accept-'+inputId+'-'+index,()=>{
        const node=input();
        if(!node||node.value!==state.original||state.key!==stateKey(state.taskId)){state.result=null;state.notice='输入或任务已改变，请重新补全。';drawCompletion(inputId,state);return;}
        const result=state.result;node.value=text;node.dispatchEvent(new Event('input',{bubbles:true}));
        if(result?.token){proofs.set(inputId,{token:result.token,choice:index,value:text,key:state.key});feedback(result,'adopted',{choice:index});}node.focus();
      });
      host.append(el('div',{class:'completion-choice'},el('p',{},text),accept));
    });
    host.append(button('忽略候选','complete-dismiss-'+inputId,()=>{state.serial++;state.result=null;state.notice='';drawCompletion(inputId,state);input()?.focus();}));
    shownResult(state.result,host,state.started);
  }
  document.addEventListener('input',event=>{
    proofs.delete(event.target.id);
    const state=completions.get(event.target.id);if(!state)return;
    state.serial++;state.pending=false;state.result=null;state.notice='';drawCompletion(event.target.id,state);
  });
  return {nextView,completion,completionProof(inputId){const proof=proofs.get(inputId),state=completions.get(inputId),input=document.getElementById(inputId);
    return proof&&state&&visible(state.host)&&proof.key===stateKey(state.taskId)&&input?.value===proof.value?{token:proof.token,choice:proof.choice}:undefined;}};
}
