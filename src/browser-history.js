import {normalizeUrl} from './text.js';
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
