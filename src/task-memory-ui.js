import { el, icon, duration } from './ui.js';
import { relationFor, taskText } from './task-context.js';
import { TASK_STATUSES, statusOf } from './task-lifecycle.js';
import {SOURCE_LABELS} from './search-sources.js';
import {createHistoryUI} from './history-ui.js';

const stamp = value => value ? new Date(value).toLocaleString('zh-CN', {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'}) : '';
const pending = job => ['queued', 'running'].includes(job?.status);

/** Shared task interactions for the workbench, side panel, and popup. */
export function createTaskMemoryUI({ getState, request, refresh, render, notify, getWindowId, surface, showEvidence,showLibrary,demo=false }) {
  let working = false, dialog = null, returnFocus = '', searchJob = null, searchEpoch = null, expanded = false;
  let query = '', scope = 'all', searchSerial = 0, associationSerial = 0, pollingAssociation = '';
  const shownPrompts = new Set();
  let promptObserver;
  let statusFilter = 'daily';
  let filters={from:'',until:'',domain:'',taskId:'',taskMode:'associated'},filtersOpen=false,offset=0;
  const historyUI=createHistoryUI({request,render,refresh,notify,demo,getState});
  const clientId = 'memory-' + surface + '-' + crypto.randomUUID();
  const work = () => getState()?.work || {current: {taskId: null, revision: 0}, relations: [], drafts: {}, undo: {}};
  const taskById = id => getState()?.tasks.find(item => item.id === id);
  const canContinue = task => {
    if(statusOf(task)!=='active')return false;
    const relations = work().relations || [];
    const page = task.checkpoint?.page || work().drafts?.[task.id]?.page || task.pages.find(page => relationFor(task, page.pageId, relations).related);
    return page && relationFor(task, page.pageId, relations).source !== 'excluded';
  };
  const payload = task => ({ id: task.id, revision: task.revision || 0, windowId: getWindowId(), contextRevision: work().current.revision });
  const action = (label, name, data = {}, primary = false) => el('button', {id: 'memory-' + name + '-' + [data.id, data.pageId,data.entryId,data.offset, data.decision, data.feedback, data.manage ? 'manage' : '', data.slot].filter(value=>value!==undefined&&value!==''&&value!==false).map(encodeURIComponent).join('-'), type: 'button', class: 'memory-button' + (primary ? ' primary' : ''), disabled: working,
    'data-action': 'memory-' + name, ...Object.fromEntries(Object.entries(data).map(([key, value]) => ['data-' + key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase()), value]))}, label);
  const small = text => el('p', {class: 'memory-caption'}, text);

  async function run(callback) {
    if (working) return;
    working = true; render();
    try { await callback(); }
    catch (error) { if (/^STALE_|TASK_NOT_FOUND/.test(error.code || '')) await refresh(); notify(error.message, true); }
    finally { working = false; render(); }
  }
  function close() { if (working) return; dialog?.close(); }
  function modal(title, description) {
    dialog?.remove(); returnFocus = document.activeElement?.id || '';
    dialog = el('dialog', {class: 'memory-dialog', 'aria-labelledby': 'memory-dialog-title'},
      el('div', {class: 'memory-heading'}, el('h2', {id: 'memory-dialog-title'}, title), action('关闭', 'close')),
      description && small(description));
    dialog.addEventListener('cancel', event => { if (working) event.preventDefault(); });
    dialog.addEventListener('close', () => { document.getElementById(returnFocus)?.focus({preventScroll: true}); });
    document.body.append(dialog); dialog.showModal(); return dialog;
  }
  function checkpoint(task, { pause = false, switchTo = null } = {}) {
    const expected = payload(task), current = task.checkpoint || {}, draft = work().drafts?.[task.id];
    const relations = work().relations || [];
    const pages = [...new Map([...task.pages, ...relations.filter(item => item.taskId === task.id && item.decision === 'related').map(item => item.page)]
      .filter(page => relationFor(task, page.pageId, relations).related).map(page => [page.pageId, page])).values()];
    const frame = modal(switchTo ? '切换前，留一句继续线索' : pause ? '暂停当前任务' : '保存任务断点', '进展、卡点与下一步由你确认。最近访问只提供页面和时间线索。');
    const form = el('form', {class: 'memory-form'},
      ['progress', 'blocker', 'nextStep'].map((name, index) => el('label', {}, ['已做到哪里', '遇到的卡点（可留空）', '下一步'][index],
        el('textarea', {id: 'checkpoint-' + name, name, rows: 2, placeholder: ['用一句话记下已做的事', '还有什么没有解决', '下次打开时，先做什么'][index]}, current[name] || ''))),
      el('label', {}, '继续页面', el('select', {id: 'checkpoint-page', name: 'pageId'}, el('option', {value: ''}, '暂不指定页面'),
        pages.map(page => el('option', {value: page.pageId, selected: page.pageId === current.page?.pageId}, page.title || page.url)))),
      draft && el('div', {class: 'memory-observation'}, small('最近记录 · ' + stamp(draft.at)), el('p', {}, draft.page.title),
        pages.some(page => page.pageId === draft.page.pageId) && el('label', {class: 'memory-checkbox'}, el('input', {type: 'checkbox', name: 'useEvidence'}), '使用这条访问记录作为继续线索')),
      el('p', {class: 'memory-form-error', role: 'alert'}),
      el('div', {class: 'memory-actions'}, (pause || switchTo) && action(switchTo ? '直接切换' : '只暂停', 'direct-transition', {id: task.id, next: switchTo?.id || '', revision: expected.contextRevision}),
        el('button', {type: 'submit', class: 'memory-button primary'}, switchTo ? '保存并切换' : pause ? '保存并暂停' : '保存断点')));
    frame.append(form);
    form.elements.useEvidence?.addEventListener('change', event => { if (event.target.checked) form.elements.pageId.value = draft.page.pageId; });
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (working) return;
      const values = Object.fromEntries(new FormData(form));
      try { for (const field of ['progress', 'blocker', 'nextStep']) values[field] = taskText(values[field], field); }
      catch (error) { form.querySelector('.memory-form-error').textContent = error.message; return; }
      const data = {progress: values.progress, blocker: values.blocker, nextStep: values.nextStep, pageId: values.pageId,
        evidenceId: values.useEvidence && values.pageId === draft?.page.pageId ? draft.segmentId : undefined};
      working = true; form.querySelectorAll('button,input,select,textarea').forEach(node => node.disabled = true);
      try {
        await request(switchTo ? 'SET_CURRENT_TASK' : pause ? 'PAUSE_TASK' : 'SAVE_CHECKPOINT', {
          ...expected, ...(switchTo ? {id: switchTo.id, previousTaskId: task.id, previousRevision: expected.revision} : {}), checkpoint: data });
        await refresh(); working = false; close(); notify(switchTo ? '断点已保存，已切换任务。' : pause ? '断点已保存，当前任务已暂停。' : '断点已保存。');
      } catch (error) {
        form.querySelector('.memory-form-error').textContent = error.message;
        if (/^STALE_/.test(error.code || '')) {
          await refresh();
          const reload = action('核对最新版本后重新保存', 'rebase-checkpoint');
          reload.disabled = false;
          reload.addEventListener('click', () => {
            const latest = taskById(task.id);
            if (!latest) return;
            expected.revision = latest.revision; expected.previousRevision = latest.revision;
            expected.contextRevision = work().current.revision;
            form.querySelector('.memory-form-error').textContent = '已读取最新版本：' + (latest.checkpoint?.nextStep || '尚无下一步') + '。请核对你的草稿后再保存。'; reload.remove();
          });
          form.querySelector('.memory-form-error').append(reload);
        }
      } finally { working = false; form.querySelectorAll('button,input,select,textarea').forEach(node => node.disabled = false); render(); }
    });
    form.elements.progress.focus();
  }

  function checkpointSummary(task) {
    const point = task.checkpoint, draft = work().drafts?.[task.id];
    if (!point) return draft ? el('div', {class: 'memory-checkpoint'}, small('最近记录 · ' + stamp(draft.at)), el('p', {}, draft.page.title), small('尚未确认断点')) : null;
    const evidence = work().checkpointEvidence?.[task.id];
    return el('div', {class: 'memory-checkpoint'}, small('已确认断点 · ' + stamp(point.confirmedAt)),
      point.progress && el('p', {}, el('strong', {}, '进展 · '), point.progress),
      point.blocker && el('p', {}, el('strong', {}, '卡点 · '), point.blocker),
      point.nextStep && el('p', {}, el('strong', {}, '下一步 · '), point.nextStep),
      point.page && small('继续页面 · ' + point.page.title),
      point.page && !task.pages.some(page => page.pageId === point.page.pageId) && small('此页未在保存列表中，可用“继续一页”打开。'),
      point.evidence && evidence?.reason === 'expired' && small('原始访问记录已过期；你确认的断点仍保留。'));
  }
  function taskActions(task) {
    const current = work().current.taskId === task.id;
    return el('div', {class: 'memory-task-detail'}, task.goal && el('p', {class: 'memory-goal'}, task.goal), checkpointSummary(task),
      el('label', {class: 'memory-caption', for: 'memory-task-status-' + task.id}, '任务状态'),
      el('select', {id: 'memory-task-status-' + task.id, class: 'standard-select', 'data-task-status': task.id, disabled: working},
        Object.entries(TASK_STATUSES).map(([value,label]) => el('option', {value, selected: statusOf(task) === value}, label))),
      el('div', {class: 'memory-actions'}, statusOf(task)==='active'?action(current ? '正在做' : '设为当前任务', 'select', {id: task.id, ...(current ? {current: true} : {})}):small('改为进行中后可继续任务。'),
        action('留断点', 'checkpoint', {id: task.id}), action('关联记忆', 'manage', {id: task.id}),
        canContinue(task) && action('继续一页', 'continue', {id: task.id})));
  }

  function manager(task) {
    const relations = work().relations || [], known = relations.filter(item => item.taskId === task.id);
    const pages = [...new Map([...task.pages, ...known.map(item => item.page)].map(page => [page.pageId, page])).values()];
    const frame = modal('「' + task.name + '」的关联记忆', '相关判断用于任务识别；保存的页面用于恢复任务，最多 30 页。标记不相关不会自动移出保存列表。');
    frame.append(el('div', {class: 'memory-record-list'}, pages.length ? pages.map(page => {
      const decision = relationFor(task, page.pageId, relations), saved = task.pages.some(item => item.pageId === page.pageId);
      return el('article', {class: 'memory-record'}, el('h3', {}, page.title), small((saved ? '已保存 · ' : '') + ({confirmed: '已确认相关', excluded: '已标记不相关', saved: '来自保存列表'}[decision.source] || '未确认')),
        el('div', {class: 'memory-actions'}, action(decision.related ? '标记不相关' : '确认相关', 'relation', {id: task.id, pageId: page.pageId, decision: decision.related ? 'unrelated' : 'related', manage: true}),
          saved ? action('移出保存列表', 'remove-page', {id: task.id, pageId: page.pageId}) : decision.related && action('保存到任务', 'save-page', {id: task.id, pageId: page.pageId})));
    }) : small('还没有保存页面或关联判断。')),
    el('div', {class: 'memory-actions'}, work().undo?.[task.id] && action('撤销上次判断', 'undo', {id: task.id, manage: true}), known.length > 0 && action('重置关联记忆', 'reset-confirm', {id: task.id})));
  }
  function taskDetail(task) {
    const frame = modal(task.name, '已保存的任务与继续线索');
    frame.append(el('div', {}, task.goal && el('p', {class: 'memory-goal'}, task.goal), checkpointSummary(task),
      task.notes && el('div', {class: 'memory-record'}, el('h3', {}, '任务笔记'), el('p', {class: 'memory-snippet'}, task.notes)),
      el('div', {class: 'memory-actions'}, canContinue(task) && action('继续一页', 'continue', {id: task.id, slot: 'detail'}, true),
        action('留断点', 'checkpoint', {id: task.id, slot: 'detail'}), action('关联记忆', 'manage', {id: task.id, slot: 'detail'}))));
  }
  function candidateRow(task, candidate) {
    const data = {id: task.id, pageId: candidate.page.pageId, tabId: candidate.tabId, snapshotHash: candidate.hash};
    return el('article', {class: 'memory-record'}, el('h3', {}, candidate.page.title), small(candidate.reason),
      el('div', {class: 'memory-actions'}, candidate.related ? small('已相关') : action('相关', 'relation', {...data, decision: 'related'}),
        action('不相关', 'relation', {...data, decision: 'unrelated'}),
        candidate.related && !task.pages.some(page => page.pageId === candidate.pageId) && action('保存到任务', 'save-page', data)));
  }
  function current({ compact = false, support = false } = {}) {
    const state = getState(), data = work(), task = taskById(data.current.taskId);
    if (!state) return null;
    const association = data.association || {}, candidates = association.candidates || [];
    if (pending(association) && pollingAssociation !== association.id) {
      pollingAssociation = association.id; const serial = ++associationSerial;
      setTimeout(() => poll(association, serial, true), 0);
    }
    const prompt = support && data.returnPrompt;
    const promptNode = prompt && el('aside', {class: 'memory-return', 'data-return-prompt': prompt.id, 'aria-label': '返回任务提示'},
      el('h3', {}, '要回到「' + task?.name + '」吗？'), small('最近 ' + duration(prompt.durationMs) + ' 在 ' + prompt.pages + ' 个已确认的其他页面。'),
      el('div', {class: 'memory-actions'}, action('返回任务', 'feedback', {feedback: 'return', promptId: prompt.id}, true),
        action('这页也相关', 'feedback', {feedback: 'related', promptId: prompt.id}), action('暂不提醒', 'feedback', {feedback: 'dismiss', promptId: prompt.id}),
        action('本次任务不提醒', 'feedback', {feedback: 'snooze', promptId: prompt.id})),
      el('details', {}, el('summary', {}, '查看依据'), prompt.evidence.map(item => small(item.title + ' · ' + stamp(item.startedAt)))));
    promptObserver?.disconnect();
    if (prompt && !prompt.shown && !shownPrompts.has(prompt.id)) {
      requestAnimationFrame(() => {
        const node = document.querySelector('[data-return-prompt]');
        if (!node || node.dataset.returnPrompt !== prompt.id) return;
        promptObserver = new IntersectionObserver(entries => {
          if (document.hidden || !entries.some(entry => entry.isIntersecting) || shownPrompts.has(prompt.id)) return;
          shownPrompts.add(prompt.id); promptObserver.disconnect();
          request('FOCUS_FEEDBACK', {windowId: getWindowId(), promptId: prompt.id, action: 'shown'}).catch(() => shownPrompts.delete(prompt.id));
        }, {threshold: .5});
        promptObserver.observe(node);
      });
    }
    return el('section', {class: 'memory-current', 'aria-label': '当前任务'},
      el('div', {class: 'memory-heading'}, el('div', {}, small('这个窗口 · 当前任务'), el('h2', {}, task?.name || '现在想推进哪件事？')),
        task && action('暂停', 'pause', {id: task.id})),
      task ? el('div', {}, task.goal && el('p', {class: 'memory-goal'}, task.goal), checkpointSummary(task),
        el('div', {class: 'memory-actions'}, canContinue(task) && action('继续一页', 'continue', {id: task.id, slot: 'current'}, true), action('留断点', 'checkpoint', {id: task.id, slot: 'current'})),
        !canContinue(task) && small('关联并保存一页资料，或在断点中选择新的继续页面。'),
        !compact && el('details', {class: 'memory-association', open: expanded}, el('summary', {}, '相关页面 · ' + candidates.length + ' 条'),
          small('按任务目标和你的确认寻找线索，不会自动移动或分组页面。'),
          el('div', {class: 'memory-actions'}, action(pending(association) ? '正在分析…' : '分析关联', 'associate', {id: task.id}),
            pending(association) && action('停止分析', 'cancel-association', {jobId: association.id}), action('管理关联', 'manage', {id: task.id, slot: 'current'})),
          association.error && small(association.error), pending(association) && small('本地分析 · ' + association.completed + ' / ' + association.total),
          candidates.length ? candidates.map(item => candidateRow(task, item)) : small('暂时没有匹配的页面。可以补充任务目标后重新分析。'),
          work().undo?.[task.id] && action('撤销上次判断', 'undo', {id: task.id}))) :
        small('新建任务写下目标，或在下方选择“设为当前任务”。'), promptNode,
      support && el('label', {class: 'memory-checkbox'}, el('input', {id: 'memory-support', type: 'checkbox', checked: state.settings.focusSupport}), '在侧栏提供低频返回提示'));
  }

  async function poll(job, serial, association = false) {
    let next = job;
    while (pending(next) && (association ? serial === associationSerial : serial === searchSerial)) {
      try { next = await request('GET_SEARCH_STATUS', {jobId: next.id}); }
      catch (error) { next = {...next, status: 'failed', error: error.message}; }
      if (association ? serial !== associationSerial : serial !== searchSerial) return;
      if (association) await refresh(); else { searchJob = next; render(); }
      if (pending(next)) await new Promise(resolve => setTimeout(resolve, 150));
    }
    if (association) pollingAssociation = '';
  }
  async function search() {
    if ([...query.trim()].length > 3000) { notify('查找内容最多 3000 个字符。', true); return; }
    const serial = ++searchSerial;
    offset=0;
    if (pending(searchJob)) request('CANCEL_SEARCH', {jobId: searchJob.id}).catch(() => {});
    searchJob = {status: 'starting', results: [], total: 0, completed: 0}; render();
    try {
      const job = await request('SEARCH_MEMORY', {query, scope,filters, clientId, windowId: getWindowId()});
      if (serial !== searchSerial) return;
      searchJob = job; searchEpoch = job.sourceEpoch??work().epoch;
      if(job.explanation&&job.filters){const localDay=value=>value==null?'':new Date(value-new Date(value).getTimezoneOffset()*60000).toISOString().slice(0,10);filters={...filters,from:localDay(job.filters.from),until:localDay(job.filters.until)};filtersOpen=true;}
      render(); await poll(job, serial);
    } catch (error) { if (serial === searchSerial) { searchJob = {status: 'failed', results: [], error: error.message}; render(); } }
  }
  function searchView() {
    if (searchJob && searchEpoch != null && work().epoch > searchEpoch) {
      searchSerial++; searchJob = {status: 'stale', results: [], error: '资料已更新，请重新查找。'}; searchEpoch = work().epoch;
    }
    const job = searchJob;
    return el('section', {class: 'memory-search'}, el('h1', {}, '找回线索'), small('从当前和其他窗口、任务与两类访问来源找回资料。日期按每条来源的实际时间筛选。'),
      el('form', {id: 'memory-search-form', class: 'memory-search-form'}, el('label', {class: 'sr-only', for: 'memory-query'}, '想找什么'),
        el('input', {id: 'memory-query', name: 'query', value: query, placeholder: '例如：昨天 本机模型资料'}),
        el('label', {class: 'sr-only', for: 'memory-scope'}, '查找范围'), el('select', {id: 'memory-scope', name: 'scope'},
          [['all', '全部资料'], ['window', '当前窗口'],['windows','全部窗口'], ['tasks', '已保存任务'], ['history', '自记录访问'],['browser','浏览器历史'],['library','资料库']].map(([value, text]) => el('option', {value, selected: value === scope}, text))),
        el('button', {type: 'submit', class: 'memory-button primary'}, '查找'),
        el('details',{class:'memory-filters',open:filtersOpen},el('summary',{},'日期、站点与任务筛选'),el('div',{class:'memory-filter-grid'},
          [['from','开始日期','date'],['until','结束日期','date'],['domain','站点域名','text']].map(([key,label,type])=>el('label',{},label,el('input',{id:'memory-filter-'+key,'data-search-filter':key,type,value:filters[key],placeholder:key==='domain'?'例如：developer.chrome.com':undefined}))),
          el('label',{},'任务',el('select',{id:'memory-filter-task','data-search-filter':'taskId'},el('option',{value:''},'全部任务'),filters.taskId&&!(getState()?.tasks||[]).some(task=>task.id===filters.taskId)&&el('option',{value:filters.taskId,selected:true},'已删除任务（请重新选择）'),(getState()?.tasks||[]).map(task=>el('option',{value:task.id,selected:filters.taskId===task.id},task.name)))),
          el('label',{},'任务含义',el('select',{id:'memory-filter-mode','data-search-filter':'taskMode'},[['associated','目前关联此任务'],['observed','访问时正在做此任务']].map(([value,label])=>el('option',{value,selected:filters.taskMode===value},label))))),
          small('“访问时”只依据自记录片段。“目前关联”依据已保存页面或确认关系；不会把今天的关联写成过去的任务。缺失时间的来源不进入日期结果。'),action('清空筛选','clear-filters'))),
      job?.explanation&&small(job.explanation+' · '+(job.filters?.from?stamp(job.filters.from):'不限开始')+' — '+(job.filters?.until?stamp(job.filters.until):'不限结束')+'；可在上方修改日期。'),
      small(getState()?.demo ? '示例仅演示关键词查找；真实扩展可使用本机模型。' : getState()?.settings.semantic ? '先显示关键词结果，再用本机模型补充语义结果。' : '语义增强已关闭，当前使用关键词查找。'),
      job && el('div', {role: 'status', class: 'memory-search-status'}, job.status === 'starting' ? '正在读取资料…' : pending(job) ? '本地分析 · ' + job.completed + ' / ' + job.total + ' · 可继续查看已有结果' : job.error || '找到 ' + (job.resultTotal || 0) + ' 条线索',
        pending(job) && action('停止分析', 'cancel-search', {jobId: job.id})),
      el('div', {class: 'memory-results'}, (job?.results || []).map(item => el('article', {class: 'memory-record'},
        el('h2', {}, item.title), small((item.kind === 'task' ? '任务' : item.kind==='library'?'材料':'页面') + ' · ' + (item.method === 'semantic' ? '语义匹配' : item.method==='filtered'?'筛选结果':'关键词匹配')),
        small((item.sources || []).map(source => SOURCE_LABELS[source]||source).join(' · ') + (item.visitedAt ? ' · '+item.timeType+' · ' + stamp(item.visitedAt) : ' · 时间未知')),
        item.snippetField&&small({quote:'摘录原文',note:'自己的笔记',source:'标题与来源'}[item.snippetField]),el('p', {class: 'memory-snippet'}, item.snippet), item.url && small(item.url),
        el('div',{class:'memory-actions'},item.kind === 'task' ? action('查看任务', 'result-task', {id: item.taskId || item.id.replace(/^task:/, '')}) : item.kind==='library'?action('查看材料与笔记','result-library',{id:item.libraryId}):action(item.sources.some(source=>['window','other-window'].includes(source))?'定位已开页面':'打开页面', 'result-page', {entryId: item.id, jobId: job.id}),
          action('来源记录 · '+(item.evidenceCount||1),'result-evidence',{entryId:item.id,jobId:job.id}))))),
      job?.status === 'done' && !job.results?.length && small('没有找到匹配的资料。试试任务目标中的词，或切换查找范围。'),
      job?.resultTotal > 50 && el('div',{class:'memory-actions'},offset>0&&action('上一页','result-pagination',{offset:Math.max(0,offset-50)}),small((offset+1)+'—'+Math.min(offset+50,job.resultTotal)+' / '+job.resultTotal),offset+50<job.resultTotal&&!pending(job)&&action('下一页','result-pagination',{offset:offset+50})),historyUI.view());
  }
  async function resultEvidence(data){
    const result=await request('GET_MEMORY_EVIDENCE',{jobId:data.jobId,entryId:data.entryId,offset:Number(data.offset)||0});
    const frame=modal(result.title,'来源时间分别表示访问、保存或修改；浏览器标题是当前元数据。');
    frame.append(...result.items.map((item,index)=>el('article',{class:'memory-record'},el('h3',{},SOURCE_LABELS[item.source]||item.source),small(item.timeType+' · '+(stamp(item.at)||'时间未知')+(item.endAt?' — '+stamp(item.endAt):'')),
      item.windowId!=null&&small('窗口 '+item.windowId),item.source==='history'&&small('当时任务：'+(taskById(item.observedTaskId)?.name||'未指定或已删除')),
      (item.taskIds||[]).length>0&&small('目前关联：'+item.taskIds.map(id=>taskById(id)?.name||'已删除任务').join('、')),item.url&&small(item.url),
      item.segmentId&&showEvidence&&action('定位访问片段','evidence',{segmentId:item.segmentId,slot:index}),item.taskId&&taskById(item.taskId)&&action('查看任务','result-task',{id:item.taskId,slot:index}))));
    frame.append(el('div',{class:'memory-actions'},result.offset>0&&action('上一页','result-evidence',{...data,offset:Math.max(0,result.offset-result.limit)}),small((result.offset+1)+'—'+Math.min(result.offset+result.limit,result.total)+' / '+result.total),result.offset+result.limit<result.total&&action('下一页','result-evidence',{...data,offset:result.offset+result.limit})));
  }
  function patterns() {
    const data = work().patterns;
    if (!data) return null;
    const name = id => taskById(id)?.name || '已删除任务';
    return el('section', {class: 'memory-patterns'}, el('h2', {}, '任务之间的往返'),
      small('根据已确认的任务关系统计；前台停留不代表工作完成。'),
      el('div', {class: 'memory-pattern-counts'}, small('任务内换页 ' + data.sameTaskSwitches + ' 次'), small('跨任务切换 ' + data.taskSwitches + ' 次'), small('恢复任务 ' + data.restoreActions + ' 次')),
      data.repeatedReturns.length ? data.repeatedReturns.map(item => el('details', {class: 'memory-record'},
        el('summary', {}, name(item.taskId) + ' → ' + name(item.via) + ' → 返回 · ' + item.count + ' 次'),
        small('来自 ' + item.sessions + ' 段独立记录；平均返回间隔 ' + duration(item.meanIntervalMs) + '。'),
        item.evidence.map(row => el('div', {class: 'memory-evidence'}, small(stamp(row.leftAt) + ' → ' + stamp(row.returnedAt)), row.evidence.map(page => small(page.title)),
          showEvidence && action('定位返回记录', 'evidence', {segmentId: row.evidence.at(-1).id, slot: row.returnedAt}))),
        item.evidenceTotal > item.evidence.length && small('展示最近 ' + item.evidence.length + ' 条，共 ' + item.evidenceTotal + ' 条。'))) : small('至少有 3 段独立记录呈现同一种往返，才会在这里显示模式。'),
      data.repeatedFinds.map(item => el('details', {class: 'memory-record'}, el('summary', {}, '反复找回 · ' + item.title), small(item.days + ' 天里打开 ' + item.count + ' 次'), item.evidence.map(row => small(stamp(row.at))),
        action('打开资料', 'recalled-page', {pageId: item.pageId, url: item.url}))),
      el('details', {}, el('summary', {}, '查看任务切换依据 · ' + data.transitionsTotal + ' 条'), data.transitions.map(item => small(stamp(item.at) + ' · ' + name(item.from) + ' → ' + name(item.to) + ' · ' + item.toPage.title)),
        data.transitionsTotal > data.transitions.length && small('展示最近 ' + data.transitions.length + ' 条。')));
  }

  async function handle(name, target) {
    const data = target.dataset, task = taskById(data.id);
    if (name === 'close') return close();
    if (name === 'checkpoint') return task && checkpoint(task);
    if (name === 'pause') return task && checkpoint(task, {pause: true});
    if (name === 'manage') return task && manager(task);
    if (name === 'result-task') return task && taskDetail(task);
    if (name === 'evidence') return showEvidence?.(data.segmentId);
    if (name === 'result-evidence') return resultEvidence(data);
    if (name === 'result-library') return showLibrary?.(data.id);
    if (name === 'clear-filters') {filters={from:'',until:'',domain:'',taskId:'',taskMode:'associated'};render();return;}
    if (name === 'result-pagination') {offset=Number(data.offset);searchJob=await request('GET_SEARCH_RESULTS',{jobId:searchJob.id,offset,limit:50});render();return;}
    if (name === 'select') {
      if (!task || data.current) return;
      if (statusOf(task) !== 'active') { notify('请先把任务状态改为进行中，再继续。'); return; }
      const previous = taskById(work().current.taskId);
      if (previous) return checkpoint(previous, {switchTo: task});
    }
    if (name === 'reset-confirm') {
      const frame = modal('重置关联记忆？', '将清除这个任务的相关和不相关判断。保存的页面与已确认断点会保留。');
      frame.append(action('确认重置', 'reset', {id: task.id})); return;
    }
    await run(async () => {
      if (name === 'direct-transition') {
        await request(data.next ? 'SET_CURRENT_TASK' : 'PAUSE_TASK', {id: data.next || data.id, contextRevision: Number(data.revision), windowId: getWindowId()});
        dialog?.close();
      } else if (name === 'select') await request('SET_CURRENT_TASK', payload(task));
      else if (name === 'continue') {
        const result = await request('RESTORE_TASK', {...payload(task), mode: 'page'});
        notify(result.failed?.length ? '继续页面未能打开，请重试或调整断点。' : '已接回继续页面。', Boolean(result.failed?.length));
      } else if (name === 'relation' || name === 'save-page') {
        await request(name === 'relation' ? 'SET_TASK_RELATION' : 'UPDATE_TASK_PAGES', {...payload(task), pageId: data.pageId,
          ...(data.tabId ? {tabId: Number(data.tabId), snapshotHash: data.snapshotHash} : {}), decision: data.decision});
        notify(name === 'relation' ? '已记住这次判断。' : '页面已保存到任务。');
      } else if (name === 'remove-page') await request('UPDATE_TASK_PAGES', {...payload(task), removePageId: data.pageId});
      else if (name === 'undo') { await request('UNDO_TASK_RELATION', {...payload(task), token: work().undo[task.id].token}); notify('已撤销上次判断。'); }
      else if (name === 'reset') { await request('RESET_TASK_RELATIONS', payload(task)); dialog?.close(); }
      else if (name === 'associate') {
        expanded = true;
        const job = await request('SUGGEST_TASK_PAGES', {...payload(task), clientId});
        pollingAssociation = job.id; const serial = ++associationSerial;
        poll(job, serial, true).catch(error => notify(error.message, true));
      } else if (name === 'cancel-search' || name === 'cancel-association') {
        const job = await request('CANCEL_SEARCH', {jobId: data.jobId});
        if (name === 'cancel-search') { searchSerial++; searchJob = job; } else { associationSerial++; pollingAssociation = ''; }
      } else if (name === 'result-page') await request('OPEN_MEMORY_RESULT', {jobId: data.jobId, entryId: data.entryId});
      else if (name === 'recalled-page') await request('OPEN_PAGE', {url: data.url, windowId: getWindowId()});
      else if (name === 'feedback') await request('FOCUS_FEEDBACK', {promptId: data.promptId, action: data.feedback, windowId: getWindowId()});
      else return;
      await refresh();
    });
    if (dialog?.open && task && (data.manage || name === 'remove-page' || name === 'save-page')) manager(taskById(task.id));
  }
  document.addEventListener('click', event => {
    const target = event.target.closest('[data-action^="memory-"]');
    if (target && !target.disabled) handle(target.dataset.action.slice(7), target).catch(error => notify(error.message, true));
  });
  document.addEventListener('toggle', event => { if (event.target.matches?.('.memory-association')) expanded = event.target.open;if(event.target.matches?.('.memory-filters'))filtersOpen=event.target.open; }, true);
  document.addEventListener('input', event => { if (event.target.id === 'memory-query') query = event.target.value;if(event.target.dataset.searchFilter)filters[event.target.dataset.searchFilter]=event.target.value; });
  document.addEventListener('change', event => {
    if (event.target.id === 'memory-task-filter') { statusFilter = event.target.value; render(); }
    if (event.target.dataset.taskStatus) {
      const task = taskById(event.target.dataset.taskStatus), status = event.target.value;
      run(async () => { await request('SET_TASK_STATUS', {...payload(task), status}); await refresh(); notify('任务已设为' + TASK_STATUSES[status] + '。'); });
    }
    if (event.target.id === 'memory-scope') scope = event.target.value;
    if (event.target.id === 'memory-support') run(async () => { await request('UPDATE_FOCUS_SUPPORT', {enabled: event.target.checked}); await refresh(); });
  });
  document.addEventListener('submit', event => { if (event.target.id === 'memory-search-form') { event.preventDefault(); search(); } });
  window.addEventListener('pagehide', () => { searchSerial++; associationSerial++; });
  const filterTasks = tasks => tasks.filter(task => statusFilter === 'all' || (statusFilter === 'daily' ? statusOf(task) !== 'archived' : statusOf(task) === statusFilter));
  const taskFilter = () => el('select', {id: 'memory-task-filter', class: 'standard-select', 'aria-label': '筛选任务状态'},
    [['daily','日常任务'],['all','全部任务'],...Object.entries(TASK_STATUSES)].map(([value,label]) => el('option', {value,selected:statusFilter===value},label)));
  return { current, taskActions, searchView, patterns, filterTasks, taskFilter,historyView:historyUI.view };
}
