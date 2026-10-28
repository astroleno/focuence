import {el} from './ui.js';
import {AI_PRESETS,aiOrigin} from './ai-provider.js';

export function createAISettingsUI({getState,request,refresh,demo=false}) {
  let draft=null,dirty=false,pending=false,status='';
  function view() {
    const saved=getState()?.ai||{enabled:false,baseUrl:'',protocol:'openai',model:'',hasKey:false};
    if(!dirty&&!pending)draft={...saved,apiKey:''};
    const form=el('form',{class:'ai-settings memory-form','aria-label':'AI 服务设置'},el('h2',{},'AI 预测与补全'),
      el('p',{class:'field-help'},'按需把任务名称、目标、确认断点、有限候选标题或正在补全的输入发送给所选服务。不发送完整历史、资料库原文或网页正文；服务不可用时保留本机回退。'),
      el('label',{},'服务预设',el('select',{id:'ai-preset'},el('option',{value:''},'自定义 / 当前配置'),el('option',{value:'opencode'},'OpenCode Go · DeepSeek'),el('option',{value:'deepseek'},'DeepSeek · Anthropic'))),
      el('label',{},'Base URL',el('input',{id:'ai-base-url',type:'url',value:draft.baseUrl,placeholder:'https://your-service.example/v1',autocomplete:'off'})),
      el('label',{},'接口类型',el('select',{id:'ai-protocol'},el('option',{value:'openai',selected:draft.protocol==='openai'},'OpenAI Chat Completions'),el('option',{value:'anthropic',selected:draft.protocol==='anthropic'},'Anthropic Messages'))),
      el('label',{},'模型名',el('input',{id:'ai-model',value:draft.model,autocomplete:'off',maxlength:150})),
      el('label',{},'API 密钥',el('input',{id:'ai-key',type:'password',value:draft.apiKey,autocomplete:'new-password',placeholder:saved.hasKey?'已保存；留空保留当前地址的密钥':'仅保存在此扩展本机',maxlength:8192})),
      el('label',{class:'memory-checkbox'},el('input',{id:'ai-enabled',type:'checkbox',checked:draft.enabled}),'启用按需 AI 预测与补全'),
      el('p',{class:'field-help'},'保存启用时，仅为填写的服务请求站点权限。不会在打字时自动联网。更换地址需重新填写密钥；密钥不进入导出备份。'));
    const note=el('p',{class:'prediction-status',role:'status'},status||(saved.enabled?'当前已启用 AI 服务。':'当前使用本机线索。'));
    const save=el('button',{type:'submit',id:'ai-save',class:'memory-button',disabled:pending||demo},pending?'正在保存…':'保存 AI 设置');
    const clear=el('button',{type:'button',id:'ai-clear',class:'memory-button',disabled:pending||demo||!saved.hasKey},'清除服务与密钥');
    form.append(note,el('div',{class:'memory-actions'},save,clear));
    if(demo)form.append(el('p',{class:'field-help'},'示例页不保存密钥，也不连接外部 AI 服务。'));
    form.querySelectorAll('input,select').forEach(node=>node.disabled=pending||demo);
    const read=()=>{
      draft={baseUrl:form.querySelector('#ai-base-url').value,protocol:form.querySelector('#ai-protocol').value,model:form.querySelector('#ai-model').value,
        apiKey:form.querySelector('#ai-key').value,enabled:form.querySelector('#ai-enabled').checked};
      dirty=true;status='AI 配置尚未保存。';note.textContent=status;
    };
    form.addEventListener('input',read);
    form.querySelector('#ai-preset').addEventListener('change',event=>{
      const preset=AI_PRESETS[event.target.value];if(!preset)return;
      form.querySelector('#ai-base-url').value=preset.baseUrl;form.querySelector('#ai-protocol').value=preset.protocol;form.querySelector('#ai-model').value=preset.model;
      form.querySelector('#ai-key').value='';form.querySelector('#ai-enabled').checked=false;read();
    });
    const lock=value=>{pending=value;form.querySelectorAll('button,input,select').forEach(node=>node.disabled=value||demo);};
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(pending||demo)return;read();
      try{
        // Permission must be requested directly from this user gesture.
        const granted=draft.enabled?chrome.permissions.request({origins:[aiOrigin(draft.baseUrl,draft.protocol)]}):Promise.resolve(true);
        lock(true);if(!await granted)throw Error('未授权 AI 服务，配置未启用；仍可使用本机线索。');
        const {apiKey,...config}=draft;
        await request('SAVE_AI_SETTINGS',{config:{...config,...(apiKey?{apiKey}:{})}});
        draft.apiKey='';form.querySelector('#ai-key').value='';dirty=false;status='AI 设置已保存。';lock(false);await refresh();
      }catch(error){status=error.message;}
      finally{lock(false);note.textContent=status;}
    });
    clear.addEventListener('click',async()=>{
      if(pending||demo)return;lock(true);
      try{await request('CLEAR_AI_SETTINGS');dirty=false;status='服务配置与密钥已清除，已恢复本机线索。';lock(false);await refresh();}
      catch(error){status=error.message;}finally{lock(false);note.textContent=status;}
    });
    return form;
  }
  return {view,reset(){draft=null;dirty=false;pending=false;status='';}};
}
