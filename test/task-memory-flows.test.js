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
