import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryCorpus, searchDocuments, rankMemory, accumulateSearchScores } from '../src/memory-search.js';
import { pageIdForUrl } from '../src/text.js';

const page={pageId:pageIdForUrl('https://docs.test/power'),url:'https://docs.test/power',title:'待机电流与低功耗方案'};
const task={id:'A',name:'设备续航',goal:'降低设备耗电',notes:'比较休眠模式和电池容量',pages:[page],updatedAt:10};

test('search merges page sources while retaining task and notes evidence', () => {
  const entries=memoryCorpus({tabs:[page],tasks:[task],pages:[{...page,id:page.pageId}],segments:[{pageId:page.pageId,status:'active',foregroundMs:1000,endedAt:5}]});
  const match=entries.find(entry=>entry.kind==='page');
  assert.equal(entries.length,2); assert.deepEqual(new Set(match.sources),new Set(['window','saved','history']));
  const result=rankMemory(entries,'电池容量');
  assert.equal(result.results[0].taskId,'A'); assert(result.results[0].snippet.includes('电池容量'));
});

test('excluded pages and metadata sightings do not become historical search evidence', () => {
  const entries=memoryCorpus({tabs:[page],tasks:[task],pages:[{...page,id:page.pageId}],allowed:()=>false});
  assert.equal(entries.filter(entry=>entry.kind==='page').length,0);
  assert.equal(memoryCorpus({pages:[{...page,id:page.pageId}],scope:'history'}).length,0);
  assert.equal(memoryCorpus({tasks:[task],scope:'window'}).length,0);
});

test('semantic ranking can find a non-lexical match with an explicit method', () => {
  const entries=memoryCorpus({tabs:[page]});
  assert.equal(rankMemory(entries,'延长续航').results.length,0);
  const ranked=rankMemory(entries,'延长续航',{[entries[0].id]:.8});
  assert.equal(ranked.results[0].method,'semantic'); assert.equal(ranked.results[0].pageId,page.pageId);
});

test('long notes are indexed in bounded chunks without truncating saved text', () => {
  const entries=memoryCorpus({tasks:[{...task,notes:'前文'.repeat(600)+'尾部恢复线索'}],scope:'tasks'});
  const docs=searchDocuments(entries).filter(item=>item.entryId==='task:A');
  assert(docs.length>10); assert(docs.at(-1).item.text.includes('尾部恢复线索'));
});

test('adding a title variant preserves document identities and equal text in different fields stays distinct', () => {
  const entry={id:'page:p',kind:'page',pageId:'p',searchTexts:['原来保存的标题']};
  const original=searchDocuments([entry]);
  const expanded=searchDocuments([{...entry,searchTexts:['刚打开的标题',...entry.searchTexts]}]);
  assert(expanded.some(doc=>doc.item.id===original[0].item.id));
  const fields=searchDocuments([{id:'library:l',kind:'library',libraryId:'l',searchParts:[{field:'quote',text:'同样文字'},{field:'note',text:'同样文字'}]}]);
  assert.equal(new Set(fields.map(doc=>doc.item.id)).size,2);
});
test('semantic note results show the winning passage rather than unrelated opening text', () => {
  const entries = memoryCorpus({tasks: [{...task, notes: '前文没有相关信息。'.repeat(100) + '数字麦克风将声音采样为离散数值。'}], scope: 'tasks'});
  const docs = searchDocuments(entries).filter(item => item.entryId === 'task:A');
  const vectors = new Map(docs.map((doc, index) => [doc.item.id, index === docs.length - 1 ? [1, 0] : [0, 1]]));
  const scores = accumulateSearchScores({}, docs, vectors, [1, 0]);
  const match = rankMemory(entries, '声音如何变成数值', scores).results.find(item => item.id === 'task:A');
  assert.equal(match.method, 'semantic'); assert(match.snippet.includes('数字麦克风'));
});
