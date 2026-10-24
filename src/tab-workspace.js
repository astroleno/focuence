import { pageFromTab, normalizeUrl } from './text.js';
import { failure } from './task-context.js';

export function protectionReasons(tab) {
  return [tab.pinned && '固定页面',tab.active && '当前页面',tab.audible && '正在播放',tab.groupId >= 0 && '已有分组'].filter(Boolean);
}
export async function tabIdentity(tab) {
  const value=JSON.stringify([tab.id,tab.windowId,tab.url,tab.pendingUrl||'',tab.index,!!tab.active,!!tab.pinned,!!tab.audible,tab.groupId??-1,tab.status||'complete']);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
}
export function tabAllowed(tab, allowed = () => true) {
  return !tab.incognito && !!normalizeUrl(tab.url) && allowed(tab.url) && !tab.pendingUrl && tab.status !== 'loading';
}
export async function workspaceCatalog(windows, tabs, allowed = () => true) {
  const normal=new Set(windows.filter(window=>window.type==='normal'&&!window.incognito).map(window=>window.id));
  const eligible=tabs.filter(tab=>normal.has(tab.windowId)&&tabAllowed(tab,allowed));
  const exact=new Map();
  for(const tab of eligible){if(!exact.has(tab.url))exact.set(tab.url,[]);exact.get(tab.url).push(tab.id);}
  const duplicateGroups=[...exact.values()].filter(ids=>ids.length>1);
  const rows=await Promise.all(eligible.map(async tab=>({...pageFromTab(tab),pageId:pageFromTab(tab).id,id:tab.id,windowId:tab.windowId,index:tab.index,
    pinned:!!tab.pinned,active:!!tab.active,audible:!!tab.audible,groupId:tab.groupId??-1,protection:protectionReasons(tab),identity:await tabIdentity(tab),
    duplicates:duplicateGroups.find(ids=>ids.includes(tab.id))||[]})));
  return {windows:windows.filter(window=>normal.has(window.id)).map(window=>({id:window.id,focused:window.focused,
    tabs:rows.filter(tab=>tab.windowId===window.id)})),tabs:rows,duplicateGroups,omitted:tabs.filter(tab=>normal.has(tab.windowId)).length-rows.length};
}
export async function validateTabPlan(plan, tabs, allowed) {
  for(const row of plan.rows){const tab=tabs.find(tab=>tab.id===row.tabId);
    if(!tab || !tabAllowed(tab,allowed) || await tabIdentity(tab)!==row.identity)throw failure('STALE_TAB_PLAN','页面已导航、移动或改变保护状态，请重新预览。');
  }
  if(plan.kind==='duplicates')for(const row of plan.rows){const selected=new Set(plan.rows.map(item=>item.tabId)),tab=tabs.find(item=>item.id===row.tabId);
    if(!tabs.some(other=>!selected.has(other.id)&&other.url===tab.url&&tabAllowed(other,allowed)))throw failure('STALE_TAB_PLAN','重复页的保留页面已改变，请重新预览。');
  }
}
