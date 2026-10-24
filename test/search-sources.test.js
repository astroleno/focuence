import test from 'node:test';import assert from 'node:assert/strict';
import {interpretSearch,searchCorpus} from '../src/search-sources.js';
import {searchDocuments,rankMemory} from '../src/memory-search.js';
import {pageIdForUrl} from '../src/text.js';
import {execFileSync} from 'node:child_process';
const url='https://fixture.test/article',pageId=pageIdForUrl(url),at=+new Date('2026-10-24T14:00:00');
const source={tabs:[{id:1,windowId:1,url,title:'新标题',lastAccessed:at},{id:2,windowId:2,url,title:'另一标题'}],tasks:[{id:'new',name:'新任务',pages:[{url,pageId,title:'保存标题'}],updatedAt:at}],segments:[{id:'s',url,pageId,title:'历史标题',status:'active',taskId:'old',startedAt:at-10000,endedAt:at,foregroundMs:10000}],browserVisits:[{id:'b',url,title:'浏览器元数据',visitedAt:at-5000}],currentWindowId:1};
test('merged resource retains all source evidence and title variants before semantic segmentation',()=>{const entries=searchCorpus(source),entry=entries.find(entry=>entry.kind==='page');assert.deepEqual(new Set(entry.sources),new Set(['window','other-window','saved','history','browser']));assert.equal(entry.evidence.length,5);assert(searchDocuments([entry]).some(document=>document.item.text.includes('历史标题')));});
test('observed task and current association filters have separate meanings',()=>{
  const observed=searchCorpus({...source,filters:{taskId:'old',taskMode:'observed'}});assert.equal(observed.length,1);assert.deepEqual(observed[0].sources,['history']);
  const associated=searchCorpus({...source,filters:{taskId:'new',taskMode:'associated'}});assert(associated.find(entry=>entry.kind==='page').sources.includes('browser'));
  assert.equal(searchCorpus({...source,filters:{taskId:'new',taskMode:'observed'}}).length,0);
});
test('source date and domain filters apply to actual evidence and exclude unknown times',()=>{
  const rows=searchCorpus({...source,filters:{from:at-6000,until:at,domain:'fixture.test',sources:['browser','other-window']}});assert.equal(rows.length,1);assert.deepEqual(rows[0].sources,['browser']);
  assert.equal(searchCorpus({...source,filters:{domain:'unrelated.test'}}).length,0);assert.equal(searchCorpus({...source,scope:'browser'}).length,1);
  assert.equal(searchCorpus({...source,scope:'window'})[0].sources[0],'window');
});
test('date expressions are explicit local calendar rules and manual fields override them',()=>{
  const yesterday=interpretSearch('昨天 模型',{},at);assert.equal(yesterday.terms,'模型');assert.equal(new Date(yesterday.filters.from).getDate(),23);assert.equal(new Date(yesterday.filters.until).getDate(),23);
  const week=interpretSearch('上周',{},at);assert.equal(new Date(week.filters.from).getDay(),1);assert.equal(new Date(week.filters.until).getDay(),0);
  const recent=interpretSearch('最近 7 天 向量',{},at);assert.equal(new Date(recent.filters.from).getDate(),18);assert.equal(recent.filters.until,at);
  assert.equal(interpretSearch('昨天 模型',{from:'2026-10-20',until:'2026-10-21'},at).filters.from,+new Date('2026-10-20T00:00:00'));
  assert.throws(()=>interpretSearch('a',{from:'2026-02-30'}),{code:'INVALID_FILTER'});assert.throws(()=>interpretSearch('a',{from:'2026-10-24',until:'2026-10-23'}),{code:'INVALID_FILTER'});
  assert.equal(interpretSearch('前阵子的资料',{},at).terms,'前阵子的资料');
});
test('filtered browsing and keywords retain matches beyond the first result page',()=>{
  const entries=searchCorpus({...source,tabs:Array.from({length:105},(_,id)=>({id,windowId:1,title:'共同词 '+id,url:'https://fixture.test/'+id,lastAccessed:at-id})),tasks:[],segments:[],browserVisits:[]});
  assert.equal(rankMemory(entries,'共同词',{},Infinity).results.length,105);assert.equal(rankMemory(entries,'',{},50,true).total,105);assert.equal(rankMemory(entries,'',{},Infinity,true).results.length,105);
});
test('yesterday follows a daylight-saving day rather than assuming 24 hours',()=>{
  const result=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',"import {interpretSearch} from './src/search-sources.js';const x=interpretSearch('昨天',{},+new Date('2026-03-09T12:00:00'));console.log(JSON.stringify({hours:(x.filters.until-x.filters.from+1)/3600000,day:new Date(x.filters.from).getDate()}));"],{cwd:new URL('..',import.meta.url),env:{...process.env,TZ:'America/New_York'},encoding:'utf8'}));
  assert.equal(result.hours,23);assert.equal(result.day,8);
});
