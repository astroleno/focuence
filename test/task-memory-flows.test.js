import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspace} from '../src/workspace.js';
import {createActivityState} from '../src/activity.js';
import {emptyWorkspace, taskFrom} from '../src/store.js';
import {assertRevision} from '../src/task-context.js';
import {pageIdForUrl} from '../src/text.js';
import {candidateSnapshot} from '../src/task-matching.js';

function fixture() {
  let now = 1700000000000, epoch = 0, data = emptyWorkspace(), jobs = [], failCommit = false;
  const page = (name, windowId = 1) => ({id: name.charCodeAt(0), pageId: pageIdForUrl('https://example.com/' + name), url: 'https://example.com/' + name, title: '浏览器 ' + name, windowId, active: true});
  const tabs = [page('a'), page('b'), page('c')];
  let tasks = [taskFrom({id: 'a', name: '浏览器开发', goal: '在本地查找页面', pages: [tabs[0]], revision: 0}), taskFrom({id: 'b', name: '第二个任务', pages: [tabs[1]], revision: 0})];
  let relations = [], segments = [], vectors = [], activity = createActivityState({now, sessionId: 'session'}), raw = tabs[0], activated = [];
  let restore = async task => ({opened: 1, reused: 0, failed: [], activeTabId: 10, resumePage: task.pages[0]});
  let infer = async items => ({vectors: new Map(items.map(item => [item.id, [1, 0]]))});
  const copy = value => structuredClone(value);
  const store = {
    getTasks: async () => copy(tasks), getTask: async id => copy(tasks.find(task => task.id === id)), getRelations: async () => copy(relations),
    getWorkspace: async () => copy(data), getPages: async () => copy(tabs.map(tab => ({...tab, id: tab.pageId}))), listSegments: async () => copy(segments),
    getVectors: async ids => copy(vectors.filter(item => ids.includes(item.id))),
    async commitWorkspace(change) {
      if (failCommit) throw new Error('Injected transaction failure');
      for (const expected of change.expectedTasks || []) assertRevision(tasks.find(task => task.id === expected.id), expected.revision);
      if (change.expectedContext && (data.context.windows[change.expectedContext.windowId]?.revision || 0) !== change.expectedContext.revision) throw Object.assign(new Error('stale'), {code: 'STALE_CONTEXT'});
      const removed = new Set(change.deleteTasks || []), reset = new Set([...(change.resetRelations || []), ...removed]);
      tasks = tasks.filter(task => !removed.has(task.id));
      for (const task of change.tasks || []) tasks = [...tasks.filter(item => item.id !== task.id), taskFrom(task)];
      relations = relations.filter(item => !reset.has(item.taskId) && !(change.deleteRelations || []).includes(item.id));
      for (const relation of change.relations || []) relations = [...relations.filter(item => item.id !== relation.id), copy(relation)];
      for (const item of change.segments || []) segments = [...segments.filter(old => old.id !== item.id), copy(item)];
      if (change.workspace) data = copy(change.workspace);
      return {};
    },
  };
  const deps = {store, sessionId: 'session', now: () => now, settings: () => ({tracking: true, semantic: true, retentionDays: 30}),
    epoch: () => epoch, invalidate: () => epoch++, getActivity: () => activity, setActivity: value => {activity = value;}, rawContext: async () => copy(raw),
    idleState: async () => 'active', targetWindow: async id => id || 1, tabs: async () => copy(tabs), allowed: () => true,
    loadJobs: async () => copy(jobs), saveJobs: async values => {jobs = copy(values);},
    restorePages: (...args) => restore(...args), activateTab: async (...args) => activated.push(args), openPage: async () => ({opened: true}), embed: (...args) => infer(...args)};
  const memory = createWorkspace(deps);
  return {memory, deps, store, tabs, get data() {return data;}, get activity() {return activity;}, get activated() {return activated;},
    fail: value => {failCommit = value;}, advance: value => {now += value;}, setRaw: value => {raw = value;}, restore: value => {restore = value;}, infer: value => {infer = value;},
    snapshot: () => copy({data, tasks, relations, segments, activity}),
    message: async (type, id = 'a', extra = {}) => memory.mutate({type, id, revision: (await store.getTask(id))?.revision, windowId: 1, contextRevision: data.context.windows[1]?.revision || 0, ...extra}),
  };
}

test('unified result pages expose all matches and can focus a surviving tab in another window',async()=>{
  const f=fixture();const tabs=Array.from({length:105},(_,id)=>({id:id+1000,windowId:2,url:'https://cross.test/'+id,title:'完整范围资源 '+id,lastAccessed:1700000000000-id}));
  let focused;const memory=createWorkspace({...f.deps,allTabs:async()=>tabs,focusResult:async evidence=>{focused=evidence;return{focused:true};}});await memory.initialize();
  const job=await memory.createJob({query:'完整范围资源',scope:'windows'});assert.equal(job.resultTotal,105);
  const page=await memory.searchResults({jobId:job.id,offset:100,limit:50});assert.equal(page.results.length,5);
  const entry=page.results[4],evidence=await memory.searchResults({jobId:job.id,entryId:entry.id},true);assert.equal(evidence.items[0].source,'other-window');
  await memory.mutate({type:'OPEN_MEMORY_RESULT',jobId:job.id,entryId:entry.id});assert.equal(focused.windowId,2);
  memory.invalidate();await assert.rejects(memory.searchResults({jobId:job.id}),{code:'STALE_SUGGESTION'});
});

test('current intent is independent per window and old window revisions are rejected', async () => {
  const f = fixture(); await f.memory.initialize();
  await f.message('SET_CURRENT_TASK'); await f.message('SET_CURRENT_TASK', 'b', {windowId: 2, contextRevision: 0});
  assert.equal(f.data.context.windows[1].taskId, 'a'); assert.equal(f.data.context.windows[2].taskId, 'b');
  await assert.rejects(f.message('SET_CURRENT_TASK', 'b', {contextRevision: 0}), {code: 'STALE_CONTEXT'});
});

test('saved search survives opening, new title evidence and unrelated sources without admitting new matches',async()=>{
  const f=fixture();let live=[];
  const memory=createWorkspace({...f.deps,allTabs:async()=>structuredClone(live),openPage:async(url,windowId)=>{
    live.push({id:100+live.length,windowId,url,title:'新载入页面标题',lastAccessed:1700000001000});return{opened:true};
  }});await memory.initialize();
  const job=await memory.createJob({query:'',scope:'tasks'});
  const pages=job.results.filter(item=>item.kind==='page');assert.equal(pages.length,2);
  await memory.mutate({type:'OPEN_MEMORY_RESULT',jobId:job.id,entryId:pages[0].id});
  live.push({id:999,windowId:1,url:'https://new.test/',title:'额外新页面'});
  const refreshed=await memory.searchResults({jobId:job.id});
  assert.deepEqual(refreshed.results.map(item=>item.id),job.results.map(item=>item.id));
  assert.equal(refreshed.sourceEpoch,job.sourceEpoch);
  assert((await memory.searchResults({jobId:job.id,entryId:pages[0].id},true)).items.length);
  await memory.mutate({type:'OPEN_MEMORY_RESULT',jobId:job.id,entryId:pages[1].id});
});

test('window search keeps pagination stable after visits but rejects removed or changed original documents',async()=>{
  const f=fixture();let tabs=Array.from({length:55},(_,i)=>({id:i+100,windowId:1,url:'https://pages.test/'+i,title:'连续资料 '+i,lastAccessed:i}));
  const memory=createWorkspace({...f.deps,allTabs:async()=>structuredClone(tabs)});await memory.initialize();
  const job=await memory.createJob({query:'连续资料',scope:'windows'});
  tabs[0].lastAccessed=999999;tabs.push({id:900,windowId:1,url:'https://new.test',title:'连续资料 新页面'});
  const first=await memory.searchResults({jobId:job.id});assert.deepEqual(first.results.map(item=>item.id),job.results.slice(0,25).map(item=>item.id));
  assert.equal((await memory.searchResults({jobId:job.id,offset:50,limit:50})).results.length,5);
  tabs[0].title='内容已经变更';await assert.rejects(memory.searchResults({jobId:job.id}),{code:'STALE_SUGGESTION'});
  tabs[0].title='连续资料 0';tabs[0].pendingUrl='https://changed.test/';await assert.rejects(memory.searchResults({jobId:job.id}),{code:'STALE_SUGGESTION'});
  tabs=tabs.filter(item=>item.id!==100);await assert.rejects(memory.mutate({type:'OPEN_MEMORY_RESULT',jobId:job.id,entryId:job.results[0].id}),{code:'STALE_SUGGESTION'});
});

test('search reads only selected sources while preserving library task ownership',async()=>{
  const f=fixture(), reads={window:0,windows:0,history:0,browser:0,library:0};
  const url='https://owned.test/page', at=1700000000000, title='归属验证';
  const rows={browser:[{id:'visit',url,title,visitedAt:at}],
    history:[{id:'segment',url,title,startedAt:at,endedAt:at+1,status:'active',taskId:'b'}],
    library:[{id:'material',url,title,kind:'link',createdAt:at,updatedAt:at,taskIds:['a']}]};
  f.store.listSegments=async()=>{reads.history++;return rows.history;};
  f.store.getLibraryItems=async()=>{reads.library++;return rows.library;};
  const memory=createWorkspace({...f.deps,
    tabs:async()=>{reads.window++;return [{id:1,windowId:1,url,title}];},
    allTabs:async()=>{reads.windows++;return [{id:2,windowId:2,url,title}];},
    historyRows:async()=>{reads.browser++;return rows.browser;},
  });
  await memory.initialize();
  const check=async (scope,filters,source,expected)=>{
    Object.keys(reads).forEach(key=>{reads[key]=0;});
    const job=await memory.createJob({query:title,scope,filters});
    assert.equal(job.resultTotal,1);
    assert.deepEqual(job.results[0].sources,[source]);
    assert.deepEqual(reads,{window:0,windows:0,history:0,browser:0,library:0,...expected});
    return job.results[0];
  };
  await check('all',{sources:['browser'],taskId:'a'},'browser',{browser:1,library:1});
  const observed=await check('history',{taskId:'b',taskMode:'observed'},'history',{history:1,library:1});
  assert.deepEqual(observed.taskIds,['a']);
  assert.deepEqual([observed.sourceEvidence[0].observedTaskId,observed.sourceEvidence[0].taskIds],['b',['a']]);
  await check('all',{sources:['window']},'window',{window:1,library:1});
  await check('windows',{sources:['other-window']},'other-window',{windows:1,library:1});
  await check('library',{},'library',{library:1});
});

test('same URL and title cannot replace original evidence, including across a worker reload',async()=>{
  const f=fixture(), url='https://identity.test/page', title='同名页面', at=1700000000000;
  let tabs=[1,2].map(id=>({id,windowId:1,url,title,lastAccessed:at}));
  const deps={...f.deps,tabs:async()=>structuredClone(tabs)};
  const memory=createWorkspace(deps);await memory.initialize();
  const job=await memory.createJob({query:title,scope:'window',filters:{until:at}}), entryId=job.results[0].id;
  tabs=[{...tabs[1],lastAccessed:at+100},tabs[0],{id:3,windowId:1,url,title,lastAccessed:at}];
  const reloaded=createWorkspace(deps);await reloaded.initialize();
  const first=await reloaded.searchResults({jobId:job.id,entryId,limit:1},true);
  const next=await reloaded.searchResults({jobId:job.id,entryId,offset:1,limit:1},true);
  assert.deepEqual([first.total,first.items[0].id,next.items[0].id,next.items[0].at],[2,'tab:1','tab:2',at]);
  tabs=tabs.filter(tab=>tab.id!==1);
  await assert.rejects(reloaded.searchResults({jobId:job.id,entryId},true),{code:'STALE_SUGGESTION'});
  await assert.rejects(reloaded.mutate({type:'OPEN_MEMORY_RESULT',jobId:job.id,entryId}),{code:'STALE_SUGGESTION'});
});

test('paged evidence keeps matching visits and original order with newly added same-title visits',async()=>{
  const f=fixture(), url='https://visits.test/page', at=1700000000000;
  let visits=Array.from({length:30},(_,i)=>({id:'visit:'+i,url,title:i%2?'实际匹配标题':'其他标题',visitedAt:at-i}));
  const memory=createWorkspace({...f.deps,historyRows:async()=>structuredClone(visits)});await memory.initialize();
  const job=await memory.createJob({query:'实际匹配标题',scope:'browser'}), entryId=job.results[0].id;
  assert.equal(job.results[0].title,'其他标题');
  assert.equal(job.results[0].snippet,'实际匹配标题');
  const before=await memory.searchResults({jobId:job.id,entryId,offset:25},true);
  visits=[{id:'new',url,title:'实际匹配标题',visitedAt:at+10},...visits.toReversed()];
  const after=await memory.searchResults({jobId:job.id,entryId,offset:25},true);
  assert.deepEqual(after,before);
  assert.equal(after.total,30);
  assert.deepEqual(after.items.map(item=>[item.id,item.matched]),[25,26,27,28,29].map(i=>['visit:'+i,Boolean(i%2)]));
  visits=visits.filter(visit=>visit.id!=='visit:0');
  await assert.rejects(memory.searchResults({jobId:job.id,entryId,offset:25},true),{code:'STALE_SUGGESTION'});
});

test('search explains the original evidence that contributed the winning passage',async()=>{
  const f=fixture(), url='https://material.test/page', at=1700000000000;
  f.store.getLibraryItems=async()=>[{id:'material',url,title:'材料标题',kind:'excerpt',quote:'逐字摘录检索',note:'本人笔记线索',
    createdAt:at-100,updatedAt:at,taskIds:[]}];
  const memory=createWorkspace({...f.deps,historyRows:async()=>[{id:'visit',url,title:'历史记录标题',visitedAt:at}],
    tabs:async()=>[{id:1,windowId:1,url,title:'当前标签标题'}]});await memory.initialize();
  for(const [query,scope,field,source] of [['材料标题','library','title','library'],['逐字摘录检索','library','quote','library'],
    ['本人笔记线索','library','note','library'],['历史记录标题','all','title','browser']]){
    const job=await memory.createJob({query,scope});
    const item=job.results.find(item=>item.url===url&&item.snippet.includes(query));
    assert.deepEqual([item.method,item.snippetField,item.matchedSources],['keywords',field,[source]]);
    const detail=await memory.searchResults({jobId:job.id,entryId:item.id},true);
    assert.deepEqual(detail.match,{method:'keywords',field,snippet:query,sources:[source]});
    assert(detail.items.every(row=>row.matched===(row.source===source)));
  }
  f.infer(async items=>({vectors:new Map(items.map(item=>[item.id,item.text.includes('本人笔记线索')||item.id.startsWith('mem:query:') ? [1,0] : [0,1]]))}));
  const job=await memory.createJob({query:'自己的想法写在哪里',scope:'library'});
  const result=await memory.advanceJob({jobId:job.id});
  assert.equal(result.status,'done');
  assert.deepEqual([result.results[0].method,result.results[0].snippetField,result.results[0].matchedSources],['semantic','note',['library']]);
});

test('task text remains searchable without exposing its excluded checkpoint URL',async()=>{
  const f=fixture(), url=f.tabs[0].url;
  await f.memory.initialize();
  await f.message('SAVE_CHECKPOINT','a',{checkpoint:{progress:'独立任务进度',pageId:f.tabs[0].pageId}});
  let excluded=false;
  const memory=createWorkspace({...f.deps,allowed:value=>Boolean(value)&&(!excluded||value!==url)});
  await memory.initialize();
  const message={query:'独立任务进度',scope:'tasks',filters:{sources:['task']}};
  const original=await memory.createJob(message);
  assert.equal(original.results[0].sourceEvidence[0].url,url);
  excluded=true;
  await assert.rejects(memory.searchResults({jobId:original.id,entryId:'task:a'},true),{code:'STALE_SUGGESTION'});
  const job=await memory.createJob(message);
  const result=job.results[0], detail=await memory.searchResults({jobId:job.id,entryId:result.id},true);
  assert.equal(result.id,'task:a');
  assert.equal(result.url,null);
  assert.equal(result.sourceEvidence[0].url,null);
  assert.equal(detail.items[0].url,null);
  const filtered=await memory.createJob({...message,filters:{...message.filters,domain:'example.com'}});
  assert.equal(filtered.resultTotal,0);
});

test('library evidence keeps an allowed frame without exposing its excluded parent URL',async()=>{
  const f=fixture(), url='https://frame.test/source', parentUrl='https://excluded.test/parent', at=1700000000000;
  f.store.getLibraryItems=async()=>[{id:'frame',kind:'excerpt',url,parentUrl,title:'框架选文',quote:'可以显示的摘录',note:'',
    taskIds:[],createdAt:at,updatedAt:at+100}];
  const memory=createWorkspace({...f.deps,allowed:value=>Boolean(value)&&value!==parentUrl});
  await memory.initialize();
  const job=await memory.createJob({query:'可以显示的摘录',scope:'library'});
  const result=job.results[0], detail=await memory.searchResults({jobId:job.id,entryId:result.id},true);
  assert.equal(result.url,url);
  assert.equal(result.evidenceCount,2);
  for(const row of [...result.sourceEvidence,...detail.items]) assert.deepEqual([row.url,row.parentUrl],[url,null]);
  for(const key of ['searchVariants','searchDocuments']) assert(!Object.hasOwn(result,key));
});

test('association view handles same-epoch stale jobs after tab navigation',async()=>{
  const f=fixture();await f.memory.initialize();
  await f.message('SET_CURRENT_TASK');
  const task=await f.store.getTask('a');
  const job=await f.memory.createJob({id:task.id,revision:task.revision,windowId:1,contextRevision:1},'association');
  f.infer(async items=>{
    f.tabs[0].title='导航后的标题';
    return {vectors:new Map(items.map(item=>[item.id,[1,0]]))};
  });
  assert.equal((await f.memory.advanceJob({jobId:job.id})).status,'stale');
  const view=await f.memory.view({windowId:1,tasks:await f.store.getTasks(),tabs:f.tabs,segments:[]});
  assert.equal(view.association.status,'ready');
  assert.match(view.association.error,/重新分析/);
});

test('a search snapshot preserves full literal phrases across semantic chunk boundaries',async()=>{
  const f=fixture();await f.memory.initialize();const query='核对连续文字'.repeat(25);
  await f.message('UPDATE_TASK','a',{notes:query});
  const job=await f.memory.createJob({query,scope:'tasks'}),fresh=await f.memory.searchResults({jobId:job.id,limit:50});
  assert.equal(fresh.results.find(item=>item.id==='task:a').score,job.results.find(item=>item.id==='task:a').score);
});
test('switch stores the previous task checkpoint and context in one successful commit', async () => {
  const f = fixture(); await f.memory.initialize(); await f.message('SET_CURRENT_TASK'); f.advance(10000);
  const before = f.snapshot(); f.fail(true);
  const input = {previousTaskId: 'a', previousRevision: 0, checkpoint: {nextStep: '核对资料', pageId: f.tabs[0].pageId}};
  await assert.rejects(f.message('SET_CURRENT_TASK', 'b', input), /transaction failure/);
  assert.deepEqual(f.snapshot(), before); f.fail(false);
  await f.message('SET_CURRENT_TASK', 'b', input);
  assert.equal((await f.store.getTask('a')).checkpoint.nextStep, '核对资料');
  assert.equal((await f.store.getTask('b')).checkpoint, null);
  assert.equal(f.data.context.windows[1].taskId, 'b');
});
test('observations do not overwrite confirmed text and pause keeps checkpoint', async () => {
  const f = fixture(); await f.memory.initialize(); await f.message('SET_CURRENT_TASK');
  await f.message('SAVE_CHECKPOINT', 'a', {checkpoint: {progress: '我已核对接口', nextStep: '试一条失败路径', pageId: f.tabs[0].pageId}});
  f.advance(30000); await f.message('PAUSE_TASK');
  assert.equal(f.data.context.windows[1].taskId, null);
  assert.equal((await f.store.getTask('a')).checkpoint.progress, '我已核对接口');
  assert.equal(f.data.drafts.a.page.pageId, f.tabs[0].pageId);
});

test('pausing one window keeps another window, task lifecycle and recording setting unchanged', async () => {
  const f = fixture(); await f.memory.initialize();
  await f.message('SET_CURRENT_TASK');
  await f.message('SET_CURRENT_TASK', 'b', {windowId: 2, contextRevision: 0});
  const before = f.snapshot();
  const settings = structuredClone(f.deps.settings());
  await f.message('PAUSE_TASK');
  const after = f.snapshot();
  assert.equal(after.data.context.windows[1].taskId, null);
  assert.deepEqual(after.data.context.windows[2], before.data.context.windows[2]);
  assert.deepEqual(after.tasks.map(task => [task.id, task.status]), before.tasks.map(task => [task.id, task.status]));
  assert.deepEqual(f.deps.settings(), settings);
});
test('relation corrections are revision guarded, undoable and independent of restore membership', async () => {
  const f = fixture(); await f.memory.initialize(); await f.message('SET_CURRENT_TASK');
  const page = f.tabs[0], snapshot = candidateSnapshot(page);
  const correction = {tabId: page.id, pageId: page.pageId, snapshotHash: snapshot.hash, decision: 'unrelated'};
  const first = await f.message('SET_TASK_RELATION', 'a', correction);
  assert.equal((await f.store.getTask('a')).pages.length, 1);
  assert.equal((await f.memory.contextFor(page)).excludedFromIntent, true);
  await assert.rejects(f.message('SET_TASK_RELATION', 'a', {...correction, revision: 0}), {code: 'STALE_TASK'});
  await f.message('UNDO_TASK_RELATION', 'a', {token: first.undoToken});
  assert.equal((await f.memory.contextFor(page)).taskId, 'a');
  await assert.rejects(f.message('UNDO_TASK_RELATION', 'a', {token: first.undoToken}), {code: 'STALE_TASK'});
  await f.message('SET_TASK_RELATION', 'a', correction); await f.message('RESET_TASK_RELATIONS');
  assert.equal((await f.store.getRelations()).length, 0);
});
test('navigation invalidates candidate actions before a relation can be written', async () => {
  const f = fixture(); await f.memory.initialize(); const page = {...f.tabs[2]}, snapshot = candidateSnapshot(page);
  f.tabs[2].title = 'new title';
  await assert.rejects(f.message('SET_TASK_RELATION', 'a', {tabId: page.id, pageId: page.pageId, snapshotHash: snapshot.hash, decision: 'related'}), {code: 'STALE_SUGGESTION'});
  assert.equal((await f.store.getRelations()).length, 0);
});
test('all failed restores leave intention unchanged; successful page restore selects only after persistence', async () => {
  const f = fixture(); await f.memory.initialize(); await f.message('SET_CURRENT_TASK', 'b');
  f.restore(async () => ({opened: 0, reused: 0, failed: [{url: 'bad'}], resumePage: null}));
  await f.message('RESTORE_TASK'); assert.equal(f.data.context.windows[1].taskId, 'b'); assert.equal(f.activated.length, 0);
  let single;
  f.restore(async (task, windowId, page) => { single = page; return {opened: 0, reused: 1, failed: [], resumePage: page, activeTabId: 12}; });
  await f.message('RESTORE_TASK', 'a', {mode: 'page'});
  assert.equal(single.pageId, f.tabs[0].pageId); assert.equal(f.data.context.windows[1].taskId, 'a'); assert.deepEqual(f.activated, [[1, 12]]);
});
test('worker reload preserves current intent; a browser restart releases window bindings', async () => {
  const f = fixture(); await f.memory.initialize(); await f.message('SET_CURRENT_TASK');
  const same = createWorkspace(f.deps); await same.initialize(); assert.equal(same.getState().context.windows[1].taskId, 'a');
  const fresh = createWorkspace({...f.deps, sessionId: 'another-browser'}); await fresh.initialize(); assert.deepEqual(fresh.getState().context.windows, {});
});
test('new queries and cancellation cannot be overwritten by a late inference', async () => {
  const f = fixture(); await f.memory.initialize();
  let finish, started; const ready = new Promise(resolve => {started = resolve;});
  f.infer(items => new Promise(resolve => {finish = () => resolve({vectors: new Map(items.map(item => [item.id, [1, 0]]))}); started();}));
  const old = await f.memory.createJob({query: '浏览器', clientId: 'panel'});
  const pending = f.memory.advanceJob({jobId: old.id}); await ready;
  await f.memory.cancelJob({jobId: old.id}); finish();
  const cancelled = await pending; assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.completed, 0);
  const next = await f.memory.createJob({query: '第二个', clientId: 'panel'});
  assert.notEqual(next.id, old.id); await assert.rejects(f.memory.advanceJob({jobId: old.id}), {code: 'JOB_NOT_FOUND'});
});
test('data edits invalidate completed jobs and never return an old result', async () => {
  const f = fixture(); await f.memory.initialize();
  const job = await f.memory.createJob({query: '浏览器'}); assert(job.results.length > 0);
  await f.message('UPDATE_TASK', 'a', {goal: '新的目标'});
  const stale = await f.memory.advanceJob({jobId: job.id}); assert.equal(stale.status, 'stale'); assert.deepEqual(stale.results, []);
});
test('a replacement query cancels an in-flight response instead of returning obsolete results', async () => {
  const f = fixture(); await f.memory.initialize();
  let finish, started; const ready = new Promise(resolve => {started = resolve;});
  f.infer(items => new Promise(resolve => {finish = () => resolve({vectors: new Map(items.map(item => [item.id, [1, 0]]))}); started();}));
  const old = await f.memory.createJob({query: '浏览器', clientId: 'one-view'});
  const inFlight = f.memory.advanceJob({jobId: old.id}); await ready;
  const next = await f.memory.createJob({query: '第二个任务', clientId: 'one-view'});
  finish(); const response = await inFlight;
  assert.equal(response.status, 'cancelled'); assert.deepEqual(response.results, []); assert.notEqual(next.id, old.id);
});
test('recording pause prevents automatic associations and restoration event collection', async () => {
  const f = fixture(); f.deps.settings = () => ({tracking: false, semantic: true, retentionDays: 30});
  const paused = createWorkspace(f.deps); await paused.initialize();
  await paused.mutate({type: 'RESTORE_TASK', id: 'a', revision: 0, contextRevision: 0, windowId: 1});
  assert.deepEqual(paused.getState().events, []);
  await assert.rejects(paused.createJob({id: 'a', revision: 1, contextRevision: 1, windowId: 1}, 'association'), {code: 'TRACKING_PAUSED'});
  const view = await paused.view({windowId: 1, tasks: await f.store.getTasks(), tabs: f.tabs, segments: []});
  assert.deepEqual(view.association.candidates, []);
});
