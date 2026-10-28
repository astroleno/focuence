import { el, icon, duration } from '../src/ui.js';
import { openWorkspace, openSidePanel } from '../src/navigation.js';
import { uniqueTaskPages } from '../src/tasks.js';
import { taskNotes } from '../src/task-notes.js';
import { taskPages } from '../src/task-pages.js';
import { proposalMembers, selectedProposal } from '../src/proposals.js';
import { createTaskMemoryUI } from '../src/task-memory-ui.js';
import { taskText } from '../src/task-context.js';
import { createTabWorkspaceUI } from '../src/tab-workspace-ui.js';
import {createLibraryUI} from '../src/library-ui.js';
import {createDraftGuard} from '../src/draft-guard.js';

const isDemo = new URLSearchParams(location.search).get('demo') === '1';
const byId = id => document.getElementById(id);
const ui = { state: null, view: 'tasks', working: '', analyzing: false, analysisNote: '', analysisError: false, form: null, members: new Map(), expandedNotes: new Set(), expandedPages: new Set(), didPropose: false, readError: '', feedbackAction: '' };
let windowId, transport, saveGuard;
let fitFrame;
function fitPopup() {
  document.body.style.maxHeight = '600px';
  cancelAnimationFrame(fitFrame);
  fitFrame = requestAnimationFrame(() => {
    fitFrame = requestAnimationFrame(() => {
      if (document.body.scrollHeight > innerHeight) document.body.style.maxHeight = innerHeight + 'px';
    });
  });
}
window.addEventListener('resize', fitPopup);
if (isDemo) {
  const { createDemoTransport } = await import('../app/demo-data.js');
  transport = createDemoTransport(); windowId = 1;
} else {
  transport = message => chrome.runtime.sendMessage(message);
  try { windowId = (await chrome.windows.getCurrent()).id; } catch { /* The backend resolves the window. */ }
}
async function request(type, payload = {}) {
  const response = await transport({ target: 'background', type, windowId, ...payload });
  if (!response?.ok) throw Object.assign(new Error(typeof response?.error === 'string' ? response.error : '操作没有完成，请重试。'), {code: response?.code});
  return response.data;
}
const memory = createTaskMemoryUI({getState: () => ui.state, request, refresh, render, notify: feedback, getWindowId: () => windowId, surface: 'popup',demo:isDemo,showLibrary:id=>libraryUI.detail(id)});
const tabWorkspace = createTabWorkspaceUI({request,getState:()=>ui.state,getWindowId:()=>windowId,render,refresh,notify:feedback,demo:isDemo});
const libraryUI=createLibraryUI({getState:()=>ui.state,request,render,refresh,notify:feedback,getWindowId:()=>windowId,demo:isDemo,surface:'popup'});
function feedback(message, error = false, actionName = '') {
  const regions = [byId('feedback'), byId('error')];
  const hadFocus = regions.some(region => region.contains(document.activeElement));
  for (const region of regions) { region.hidden = true; region.replaceChildren(); }
  const region = byId(error ? 'error' : 'feedback');
  ui.feedbackAction = actionName;
  region.replaceChildren(el('span', {}, message), actionName && action(actionName === 'undo' ? '撤销' : '重新生成', actionName, {id: 'feedback-action', disabled: false}, false));
  region.hidden = !message;
  if (hadFocus) (region.querySelector('button') || byId('popup-main')).focus({preventScroll: true});
  fitPopup();
}
function action(label, name, attributes = {}, primary = false, iconName) {
  return el('button', {id: 'action-' + name + '-' + encodeURIComponent(attributes['data-id'] || attributes['data-view'] || ''), type: 'button', 'data-action': name, disabled: Boolean(ui.working), ...attributes, class: 'button' + (primary ? ' primary' : '') + (attributes.class ? ' ' + attributes.class : '')}, iconName && icon(iconName), label);
}
function groupMembers(group) {
  return proposalMembers(group, ui.state.tabs, ui.members);
}
function selectedGroup(group) {
  return selectedProposal(group, ui.state.tabs, ui.members);
}
function groupCard(group) {
  const selected = groupMembers(group);
  const tabs = group.tabIds.map(id => ui.state.tabs.find(tab => tab.id === id)).filter(Boolean);
  return el('article', {class: 'proposal', 'data-group-id': group.id},
    el('div', {class: 'section-heading'}, el('h3', {}, group.name), el('span', {class: 'secondary'}, selected.size + ' / ' + tabs.length + ' 页')),
    el('div', {class: 'group-pages'}, tabs.map(tab => el('label', {class: 'page-option'},
      el('input', {id: 'group-member-' + group.id + '-' + tab.id, type: 'checkbox', 'data-group-member': group.id, 'data-tab-id': tab.id, checked: selected.has(tab.id), disabled: Boolean(ui.working) || ui.analyzing}),
      el('span', {title: tab.title || tab.url}, tab.title || tab.domain)))),
    el('div', {class: 'proposal-actions'},
      action('存为任务', 'save-group', {'data-id': group.id, disabled: Boolean(ui.working) || selected.size === 0}, false, 'save'),
      action(ui.working === 'apply-' + group.id ? '正在应用…' : '应用分组', 'apply-group', {'data-id': group.id, disabled: Boolean(ui.working) || ui.analyzing || selected.size < 2}, true, 'check')));
}
function taskCard(task, index) {
  const preview = task.restorePreview || {reused: 0, willOpen: task.pages.length};
  return el('article', {id: 'task-card-' + encodeURIComponent(task.id), tabindex: -1, class: 'recent-task'},
    el('h3', {}, task.name),
    memory.taskActions(task),
    task.resumePage && el('div', {class: 'resume-page'}, icon('page'), el('button', {id: 'resume-page-' + encodeURIComponent(task.id), type: 'button', class: 'resume-page-link', 'data-action': 'open-page', 'data-url': task.resumePage.url, title: task.resumePage.title, 'aria-label': '打开页面：' + (task.resumePage.title || task.resumePage.url), disabled: Boolean(ui.working)}, task.resumePage.title || new URL(task.resumePage.url).hostname)),
    task.lastRestoreResult?.failedCount > 0 && el('p', {class: 'restore-warning'}, '上次有 ' + task.lastRestoreResult.failedCount + ' 页未恢复，可以重试。'),
    task.pages.length > 0 && el('div', {class: 'task-actions'},
      el('span', {class: 'secondary'}, '复用 ' + preview.reused + ' 页 · 新开 ' + preview.willOpen + ' 页'),
      action(ui.working === 'restore-' + task.id ? '恢复中…' : '恢复全部 ' + task.pages.length + ' 页', 'restore-task', {'data-id': task.id, disabled: Boolean(ui.working) || !task.pages.length || (task.status&&task.status!=='active')}, false, 'arrow')),
    task.pages.length > 0 && taskPages(task, ui.expandedPages.has(task.id), Boolean(ui.working)),
    taskNotes(task, ui.expandedNotes.has(task.id)));
}
function saveForm() {
  const form = ui.form, count = form.selected.size;
  return el('form', {id: 'save-task-form'},
    el('div', {class: 'section-heading'}, el('h1', {}, '保存任务'), action('返回', 'cancel-save', {class: 'text-button'})),
    el('p', {class: 'form-scope secondary'}, form.scope + ' · 已选 ' + count + ' 页' + (form.deduplicated ? ' · 同一地址只保留一份' : '') + (form.intentOnly ? '。保存后可设为当前聚焦；目标不会改变地图主题。' : '')),
    el('label', {class: 'field'}, el('span', {}, '任务名称'), el('input', {id: 'task-name', name: 'name', required: true, value: form.name, placeholder: '正在做的这件事', disabled: Boolean(ui.working)})),
    el('label', {class: 'field'}, el('span', {}, '任务目标'), el('textarea', {id: 'task-goal', name: 'goal', rows: 2, placeholder: '这件事想达到什么目标？', disabled: Boolean(ui.working)}, form.goal)),
    el('label', {class: 'field'}, el('span', {}, '任务笔记'), el('textarea', {id: 'task-notes', name: 'notes', rows: 2, placeholder: '保留资料和上下文', disabled: Boolean(ui.working)}, form.notes)),
    !form.intentOnly && el('div', {class: 'selection-heading'}, el('span', {}, '保存的页面'), action(count ? '清空选择' : '全选', 'toggle-save-all', {class: 'text-button'})),
    el('div', {class: 'save-pages'}, form.tabs.map(tab => el('label', {class: 'page-option'},
      el('input', {id: 'save-member-' + tab.id, type: 'checkbox', 'data-save-member': tab.id, checked: form.selected.has(tab.id), disabled: Boolean(ui.working)}),
      el('span', {title: tab.title || tab.url}, tab.title || tab.domain)))),
    count > 30 && el('p', {class: 'form-error'}, '每个任务最多保存 30 页，请缩小选择范围。'));
}
function renderSaveActions() {
  const region = byId('save-actions');
  region.hidden = !ui.form;
  byId('popup-footer').hidden = Boolean(ui.form);
  document.body.classList.toggle('saving', Boolean(ui.form));
  if (!ui.form) { region.replaceChildren(); return; }
  const count = ui.form.selected.size;
  region.replaceChildren(
    el('span', {class: count > 30 ? 'form-error' : 'secondary'}, ui.form.intentOnly ? '保存目标后再关联资料' : count > 30 ? '最多保存 30 页' : count ? '已选 ' + count + ' 页' : '请选择页面'),
    el('button', {id: 'save-task-submit', type: 'submit', form: 'save-task-form', class: 'button primary', disabled: Boolean(ui.working) || (!ui.form.intentOnly && count === 0) || count > 30}, icon('save'), ui.working === 'save' ? '正在保存…' : '保存任务'));
}
function paint(...content) {
  const focused = document.activeElement;
  const id = focused?.id;
  const selection = focused && 'selectionStart' in focused ? [focused.selectionStart, focused.selectionEnd] : null;
  const hadFocus = byId('popup-main').contains(focused);
  const memberScroll = [...document.querySelectorAll('.task-pages')].map(list => [list.id, list.scrollTop]);
  byId('popup-main').replaceChildren(...content);
  fitPopup();
  const replacement = id && byId(id);
  if (replacement && !replacement.disabled) {
    replacement.focus({ preventScroll: true });
    if (selection && replacement.setSelectionRange && replacement.type !== 'checkbox') {
      try { replacement.setSelectionRange(...selection); } catch { /* Not every input supports a text range. */ }
    }
  } else if (hadFocus) byId('popup-main').focus({preventScroll: true});
  for (const [listId, scroll] of memberScroll) if (byId(listId)) byId(listId).scrollTop = scroll;
}
function render() {
  const state = ui.state;
  byId('open-panel').disabled = !state || Boolean(ui.working);
  byId('toggle-tracking').disabled = !state || Boolean(ui.working);
  byId('workspace').disabled = Boolean(ui.working);
  renderSaveActions();
  const feedbackButton = byId('feedback-action');
  if (feedbackButton) feedbackButton.disabled = Boolean(ui.working) || ui.analyzing || (ui.feedbackAction === 'undo' && !state?.undoAvailable);
  if (!state) {
    byId('popup-main').setAttribute('aria-busy', String(Boolean(ui.working)));
    if (ui.readError) paint(el('div', {class: 'empty'}, icon('info'), el('h1', {}, '暂时无法读取窗口'), el('p', {class: 'secondary'}, '可以在这里重试，恢复后继续整理页面。'), action(ui.working ? '正在重试…' : '重新读取', 'retry-read', {id: 'retry-read', disabled: Boolean(ui.working)}, true, 'refresh')));
    return;
  }
  byId('toggle-tracking').textContent = state.settings.tracking ? '暂停记录' : '恢复记录';
  byId('tracking-status').hidden = state.settings.tracking;
  const main = byId('popup-main');
  main.setAttribute('aria-busy', String(Boolean(ui.working)));
  if (ui.form) { paint(saveForm()); return; }
  const tabs = state.tabs || [];
  const eligible = tabs.filter(tab => !tab.pinned && Number(tab.groupId) < 0);
  const groups = state.groups || [];
  const navigation = el('nav', { class: 'popup-tabs', 'aria-label': '快捷操作' },
    [['tasks', '聚焦', '当前聚焦'], ['map', '地图', '注意力地图'], ['search', '查找', '找回线索'], ['groups', '整理', '整理页面'], ['library','资料', '研究资料库'], ['tabs','窗口', '窗口管理']].map(([view, label, full]) => action(label, 'view', { 'data-view': view, 'aria-label': full, title: full, 'aria-pressed': ui.view === view }, false)));
  const content = [isDemo && el('p', { class: 'demo-note' }, '示例模式 · 仅在本页内存中演示'), navigation];
  if (ui.view === 'groups') {
    content.push(el('div', { class: 'window-summary' }, el('div', {},
      el('h1', {}, '整理当前窗口'), el('p', { class: 'secondary' }, tabs.length + ' 页打开 · ' + eligible.length + ' 页待整理')),
      action(ui.working === 'propose' ? '正在整理…' : groups.length ? '重新整理' : '生成建议', 'propose', { disabled: Boolean(ui.working) || ui.analyzing || eligible.length < 2 }, !groups.length, 'layers')));
    content.push(el('p', {class: 'secondary concept-note'}, '分组只整理打开的页面；存为任务是保留资料，不会自动开始聚焦。'));
    if (ui.analysisNote) content.push(el('p', {class: 'analysis-status' + (ui.analysisError ? ' form-error' : ''), role: 'status'}, ui.analysisNote));
    if (state.proposalNotice) content.push(el('p', {class: 'proposal-notice', role: 'status'}, state.proposalNotice));
    if (groups.length) content.push(el('section', { class: 'proposal-list', 'aria-label': '可直接应用的分组建议' }, groups.map(groupCard)));
    else content.push(el('div', { class: 'empty' }, icon('layers'), el('p', {}, ui.didPropose ? '暂时没有需要合并的页面' : '先生成建议，再决定如何分组'),
      el('p', { class: 'secondary' }, '已固定和已有分组的页面会受到保护。')));
    content.push(el('div', { class: 'secondary-actions' },
      action('保存窗口', 'save-window', { disabled: Boolean(ui.working) || !tabs.length }, false, 'save'),
      action('撤销分组', 'undo', { disabled: Boolean(ui.working) || ui.analyzing || !state.undoAvailable })));
    content.push(action(ui.analyzing ? '本地语义分析中…' : '需要更细的建议？使用本机模型', 'semantic', { class: 'text-button', disabled: Boolean(ui.working) || ui.analyzing || !state.settings.semantic || eligible.length < 2 }));
  } else if (ui.view === 'tabs') {
    content.push(tabWorkspace.view());
  } else if (ui.view === 'search') {
    content.push(memory.searchView());
  } else if(ui.view==='library'){
    content.push(libraryUI.view());
  } else {
    content.push(el('h1', {class: 'focus-view-title'}, '当前聚焦'));
    content.push(memory.current({compact: true}));
    content.push(action('新建任务', 'new-task', {}, false, 'plus'));
    content.push(el('div', { class: 'section-heading' }, el('h1', {}, '从上次继续'), el('span', { class: 'secondary' }, state.tasks.length + ' 个任务')));
    content.push(memory.taskFilter());
    content.push(memory.filterTasks(state.tasks).length ? el('section', { class: 'task-list', 'aria-label': '最近保存或访问的任务' }, memory.filterTasks(state.tasks).slice(0, 3).map(taskCard)) :
      el('div', { class: 'empty' }, icon('folder'), el('p', {}, memory.taskFilterEmpty()?.title || '给正在做的事留个位置'), el('p', { class: 'secondary' }, memory.taskFilterEmpty()?.description || '保存相关页面，再写一句下次要做什么。'), memory.taskFilterEmpty() && action('查看全部任务', 'clear-task-filters')));
    content.push(action('保存当前窗口 · ' + tabs.length + ' 页', 'save-window', { class: 'button full', disabled: Boolean(ui.working) || !tabs.length }));
  }
  paint(...content.filter(item => item != null && item !== false));
}
let refreshEpoch = 0;
async function refresh() {
  const epoch = ++refreshEpoch;
  const state = await request('GET_STATE', { range: 'today' });
  if (epoch !== refreshEpoch) return;
  ui.state = state;
  ui.readError = '';
  render();
}
async function operation(key, callback) {
  if (ui.working) return;
  const focusId = document.activeElement?.id;
  ui.working = key; feedback(''); render();
  try { await callback(); } catch (error) {
    if (error.code === 'STALE_PROPOSAL') await refresh().catch(() => {});
    feedback(error.message, true, error.code === 'STALE_PROPOSAL' ? 'propose' : '');
  }
  finally {
    ui.working = ''; render();
    if ([document.body, byId('popup-main')].includes(document.activeElement)) {
      const target = focusId && byId(focusId);
      (target && !target.disabled ? target : byId('feedback-action') || byId('popup-main')).focus({preventScroll: true});
    }
  }
}
function startSave(group, intentOnly = false) {
  const selected = group ? new Set(selectedGroup(group).tabIds) : new Set(ui.state.tabs.map(tab => tab.id));
  const candidates = intentOnly ? [] : group ? ui.state.tabs.filter(tab => group.tabIds.includes(tab.id)) : ui.state.tabs;
  const tabs = uniqueTaskPages([...candidates.filter(tab => selected.has(tab.id)), ...candidates.filter(tab => !selected.has(tab.id))]);
  ui.form = { name: group?.name || '', goal: '', notes: '', intentOnly, scope: intentOnly ? '先记录目标，稍后关联资料' : group ? '当前分组' : '当前窗口', tabs, deduplicated: tabs.length < candidates.length, selected: new Set(tabs.filter(tab => selected.has(tab.id)).map(tab => tab.id)) };
  feedback(''); render(); byId('task-name').focus();
  saveGuard?.dispose();
  saveGuard = createDraftGuard({root: () => byId('save-task-form'), scrollRoot: () => byId('popup-main'), id: 'popup-task-draft', snapshot: () => ({name: ui.form.name, goal: ui.form.goal, notes: ui.form.notes, selected: [...ui.form.selected].sort((a,b) => a-b)}), fallback: () => byId('task-name')});
}
async function propose(semantic) {
  if (ui.analyzing || ui.working) return;
  const load = async () => {
    const result = await request('PROPOSE_GROUPS', {semantic});
    ui.didPropose = true; ui.members.clear(); await refresh();
    return result;
  };
  if (!semantic) return operation('propose', async () => {
    const result = await load();
    feedback(result.groups.length ? '建议已就绪，勾选页面后直接应用。' : '没有发现适合合并的页面。');
  });
  ui.analyzing = true; ui.analysisError = false;
  ui.analysisNote = '正在本机分析，可以先保存窗口或继续最近任务。';
  feedback(''); render();
  const timer = setInterval(() => { if (!ui.working && !ui.form) refresh().catch(() => {}); }, 1000);
  try {
    const result = await load();
    ui.analysisError = result.method !== 'semantic';
    ui.analysisNote = ui.analysisError ? '本机模型暂不可用，已保留快速规则建议。可以继续应用，或稍后重试。' : result.groups.length ? '本机分析完成，分组建议已更新。' : '分析完成，没有发现适合合并的页面。';
  } catch {
    ui.analysisError = true; ui.analysisNote = '本机分析没有完成，可以继续使用现有建议，或稍后重试。';
  } finally { clearInterval(timer); ui.analyzing = false; render(); }
}
async function performAction(actionName, target) {
  const id = target?.dataset?.id;
  switch (actionName) {
    case 'view':
      if (target.dataset.view === 'map') {
        await openWorkspace({windowId, view: 'map', range: 'today', demo: isDemo});
        if (!isDemo) window.close();
      } else { ui.view = target.dataset.view; feedback(''); render(); }
      break;
    case 'retry-read': await operation('read', async () => { try { await refresh(); } catch (error) { ui.readError = error.message; throw error; } }); break;
    case 'propose': await propose(false); break;
    case 'semantic': await propose(true); break;
    case 'apply-group': {
      const group = ui.state.groups.find(item => item.id === id);
      if (!group) throw new Error('建议已更新，请重新整理。');
      const selected = selectedGroup(group);
      await operation('apply-' + id, async () => {
        const result = await request('APPLY_GROUP', { group: selected }); await refresh();
        feedback('已将 ' + result.count + ' 页放入「' + result.name + '」。', false, 'undo');
      }); break;
    }
    case 'undo':
      await operation('undo', async () => { const result = await request('UNDO_GROUP'); await refresh(); feedback(result.restored ? '已撤销最近一次分组。' : '没有可以撤销的分组。'); }); break;
    case 'new-task': startSave(null, true); break;
    case 'save-window': startSave(); break;
    case 'save-group': startSave(ui.state.groups.find(item => item.id === id)); break;
    case 'cancel-save': saveGuard.requestExit(() => { saveGuard.dispose(); saveGuard = null; ui.form = null; feedback(''); render(); byId('action-new-task-')?.focus(); }); break;
    case 'clear-task-filters': memory.resetTaskFilter(); render(); byId('popup-main').scrollTop = 0; byId('memory-task-filter')?.focus(); break;
    case 'toggle-save-all': {
      ui.form.selected = ui.form.selected.size ? new Set() : new Set(ui.form.tabs.map(tab => tab.id)); render(); break;
    }
    case 'restore-task':
      await operation('restore-' + id, async () => {
        const result = await request('RESTORE_TASK', { id, revision: ui.state.tasks.find(task => task.id === id).revision || 0, contextRevision: ui.state.work?.current.revision || 0 }); await refresh();
        const failed = result.failed?.length || 0;
        feedback('复用 ' + result.reused + ' 页，新开 ' + result.opened + ' 页' + (failed ? '；' + failed + ' 页未恢复，可重试。' : '，已接回上次页面。'), failed > 0);
      }); break;
    case 'open-page':
      await operation('open-page', async () => { await request('OPEN_PAGE', {url: target.dataset.url}); feedback('已接回这个页面。'); }); break;
    case 'toggle-task-note':
      if (ui.expandedNotes.has(id)) ui.expandedNotes.delete(id); else ui.expandedNotes.add(id);
      render(); break;
    case 'toggle-task-pages':
      if (ui.expandedPages.has(id)) ui.expandedPages.delete(id); else ui.expandedPages.add(id);
      render(); break;
  }
}
document.addEventListener('click', event => {
  const target = event.target.closest('[data-action]');
  if (!target || target.disabled) return;
  performAction(target.dataset.action, target).catch(error => feedback(error.message, true));
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && ui.form && !ui.working && !document.querySelector('dialog[open]')) {
    event.preventDefault(); performAction('cancel-save', {}).catch(error => feedback(error.message, true));
  }
});
document.addEventListener('input', event => {
  if (!ui.form) return;
  if (event.target.name === 'name') ui.form.name = event.target.value;
  if (event.target.name === 'notes') ui.form.notes = event.target.value;
  if (event.target.name === 'goal') ui.form.goal = event.target.value;
});
document.addEventListener('change', event => {
  const target = event.target;
  if (target.dataset.groupMember) {
    const group = ui.state.groups.find(item => item.id === target.dataset.groupMember);
    const selected = groupMembers(group), id = Number(target.dataset.tabId);
    if (target.checked) selected.add(id); else selected.delete(id);
    render();
  } else if (target.dataset.saveMember) {
    const id = Number(target.dataset.saveMember);
    if (target.checked) ui.form.selected.add(id); else ui.form.selected.delete(id);
    render();
  }
});
document.addEventListener('submit', event => {
  if (event.target.id !== 'save-task-form') return;
  event.preventDefault();
  const form = ui.form;
  if (!form) return;
  if (!form.name.trim()) { feedback('请给任务起一个名字。', true); byId('task-name').focus(); return; }
  try { for (const field of ['name', 'goal', 'notes']) taskText(form[field], field, {required: field === 'name'}); }
  catch (error) { feedback(error.message, true); return; }
  if ((!form.intentOnly && !form.selected.size) || form.selected.size > 30) return;
  operation('save', async () => {
    const task = await request('SAVE_TASK', { name: form.name.trim(), goal: form.goal.trim(), notes: form.notes.trim(), tabIds: [...form.selected], ...(form.intentOnly ? {mode: 'intent'} : {}) });
    saveGuard?.dispose(); saveGuard = null; memory.resetTaskFilter();
    ui.form = null; ui.view = 'tasks'; await refresh();
    feedback('「' + task.name + '」已保存，共 ' + task.pages.length + ' 页。');
    const card = byId('task-card-' + encodeURIComponent(task.id));
    card?.scrollIntoView({block: 'nearest', behavior: 'instant'}); card?.focus({preventScroll: true});
  });
});
function handOff(open) {
  if (ui.working) return;
  const proceed = () => operation('handoff', async () => {
    // Invoke before the first await so a confirmed click retains its user gesture.
    await open();
    saveGuard?.dispose(); saveGuard = null;
    if (!isDemo) window.close();
  });
  if (ui.form) saveGuard.requestExit(proceed);
  else proceed();
}
byId('open-panel').addEventListener('click', () => handOff(() => openSidePanel({ windowId, demo: isDemo })));
byId('workspace').addEventListener('click', () => {
  handOff(() => openWorkspace({ windowId, view: 'tasks', demo: isDemo }));
});
byId('toggle-tracking').addEventListener('click', () => operation('tracking', async () => {
  const tracking = !ui.state.settings.tracking;
  await request('UPDATE_SETTINGS', { patch: { tracking } }); await refresh();
  feedback(tracking ? '浏览记录已恢复。' : '浏览记录已暂停，已保存任务仍可继续。');
}));
if (!isDemo && globalThis.chrome?.tabs) {
  let timer, pending = false;
  const update = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (ui.working || ui.form) { pending = true; return; }
      pending = false;
      try { await refresh(); } catch (error) { feedback('未能更新窗口：' + error.message, true); }
    }, 250);
  };
  for (const name of ['onCreated', 'onRemoved', 'onActivated', 'onMoved', 'onAttached', 'onDetached', 'onReplaced']) chrome.tabs[name].addListener(update);
  chrome.tabs.onUpdated.addListener((_id, change) => {
    if (change.url || change.pendingUrl || change.title || 'pinned' in change || 'groupId' in change || change.status === 'complete') update();
  });
  const heartbeat = setInterval(() => { if (pending) update(); }, 1000);
  window.addEventListener('pagehide', () => { clearTimeout(timer); clearInterval(heartbeat); });
}
try { await refresh(); } catch (error) { ui.readError = error.message; feedback(error.message, true); render(); }
