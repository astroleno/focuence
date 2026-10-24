import test from 'node:test';import assert from 'node:assert/strict';
import {libraryFrom,createLibrary,capturedDraft,validDraft} from '../src/library.js';
import {searchCorpus} from '../src/search-sources.js';import {searchDocuments,rankMemory} from '../src/memory-search.js';
import {decodeBackup,planImport,backupStamp} from '../src/backup.js';import * as normalizers from '../src/store.js';
const record=extra=>libraryFrom({id:'l',kind:'excerpt',url:'https://source.test/a?utm_source=x',title:'资料',quote:'保存的原文',note:'我的判断',taskIds:['t'],revision:0,createdAt:1,updatedAt:2,...extra});
function fixture(){let items=[],invalidations=0;const store={getLibraryItems:async()=>structuredClone(items),getLibraryItem:async id=>structuredClone(items.find(item=>item.id===id)||null),async putLibraryItem(item,{create,expectedRevision}){const old=items.find(row=>row.id===item.id);if(create?!!old:!old||old.revision!==expectedRevision)throw Object.assign(Error('stale'),{code:'STALE_LIBRARY'});items=[...items.filter(row=>row.id!==item.id),structuredClone(item)];},async deleteLibraryItem(id,revision){const old=items.find(item=>item.id===id);if(!old||old.revision!==revision)throw Object.assign(Error('stale'),{code:'STALE_LIBRARY'});items=items.filter(item=>item.id!==id);}};return{library:createLibrary({store,invalidate:()=>invalidations++,now:()=>100}),store,get invalidations(){return invalidations;}};}

test('library preserves Unicode source and notes separately without truncation or interpreting HTML',()=>{
 const quote='🙂'.repeat(20000),note='<img src=x onerror=alert(1)>\n自己的笔记',item=record({quote,note});assert.equal(item.quote,quote);assert.equal(item.note,note);assert.equal(item.url,'https://source.test/a');
 assert.throws(()=>record({quote:quote+'🙂'}),{code:'LIBRARY_TEXT_LIMIT'});assert.throws(()=>record({note:'中'.repeat(20001)}),{code:'LIBRARY_TEXT_LIMIT'});assert.throws(()=>record({url:'javascript:alert(1)'}),{code:'INVALID_LIBRARY_URL'});assert.throws(()=>record({kind:'link'}),{code:'INVALID_LIBRARY'});
});
test('selection drafts preserve frame provenance and overlong text but reject editable and incognito sources',()=>{
 const quote='😀'.repeat(21000),draft=capturedDraft({selectionText:quote,pageUrl:'https://parent.test/p',frameUrl:'https://actual.test/frame'},{title:'父页面标题'},{now:100});assert.equal(draft.title,'actual.test');assert.equal(draft.url,'https://actual.test/frame');assert.equal(draft.parentUrl,'https://parent.test/p');assert.equal(draft.quote,quote);assert.equal(draft.sourceVerified,false);
 assert.equal(validDraft(draft,101).quote,quote);assert.throws(()=>validDraft(draft,900100),{code:'LIBRARY_DRAFT_EXPIRED'});
 assert.throws(()=>capturedDraft({editable:true,selectionText:'私密输入'},{}),{code:'EDITABLE_SELECTION'});assert.throws(()=>capturedDraft({selectionText:'a',pageUrl:'https://x.test'},{incognito:true}),{code:'EXCLUDED_PAGE'});
 const unknown=capturedDraft({selectionText:'原文'},{});assert.equal(unknown.url,'');assert.equal(unknown.sourceUncertain,true);
});
test('duplicate reuse is explicit and only merges tasks or explicitly appends a new note',async()=>{
 const f=fixture(),input={kind:'excerpt',url:'https://source.test/a',title:'第一份',quote:'原文',note:'原笔记',taskIds:['a'],source:'manual'};
 const first=await f.library.save(input),duplicate=await f.library.save({...input,title:'新标题',note:'新笔记',taskIds:['b']});assert(duplicate.duplicate);assert.equal((await f.store.getLibraryItems()).length,1);
 const reuse={...input,note:'新笔记',taskIds:['b'],reuseId:first.item.id,reuseRevision:first.item.revision};await assert.rejects(f.library.save(reuse),{code:'DUPLICATE_NOTE'});
 const result=await f.library.save({...reuse,appendNote:true});assert.equal(result.item.title,'第一份');assert.deepEqual(result.item.taskIds,['a','b']);assert.equal(result.item.note,'原笔记\n\n新笔记');assert.equal(result.item.quote,'原文');
 await assert.rejects(f.library.save(reuse),{code:'STALE_LIBRARY'});
});
test('edits and deletion reject stale revisions and invalidate old search once persistence succeeds',async()=>{
 const f=fixture(),saved=await f.library.save({kind:'link',url:'https://source.test',title:'链接',note:'笔记',taskIds:[]});
 const edited=await f.library.save({...saved.item,note:'新笔记'});await assert.rejects(f.library.save(saved.item),{code:'STALE_LIBRARY'});assert.equal(edited.item.note,'新笔记');
 await assert.rejects(f.library.remove(saved.item),{code:'STALE_LIBRARY'});await f.library.remove(edited.item);assert.equal((await f.store.getLibraryItems()).length,0);assert.equal(f.invalidations,3);
});
test('unverified captured sources cannot be saved and exclusion checks do not discard drafts',async()=>{
 const f=fixture();await assert.rejects(f.library.save({kind:'excerpt',url:'https://source.test',quote:'原文',note:'',taskIds:[],source:'selection'}),{code:'SOURCE_CONFIRMATION_REQUIRED'});
 assert.equal((await f.store.getLibraryItems()).length,0);
});
test('long quote and note tails remain independent searchable entries even when the URL also has page evidence',()=>{
 const item=record({quote:'前文'.repeat(9000)+'星际尾部标记',note:'笔记'.repeat(9000)+'纸鹤结尾',taskIds:['t']});
 const entries=searchCorpus({library:[item],tasks:[{id:'t',name:'任务',pages:[],updatedAt:1}],tabs:[{id:1,url:item.url,windowId:1,title:'同来源页面'}],currentWindowId:1});assert.equal(entries.filter(entry=>entry.kind==='library').length,1);assert(entries.some(entry=>entry.kind==='page'));
 const material=entries.find(entry=>entry.kind==='library'),documents=searchDocuments([material]);assert(documents.some(document=>document.item.text.includes('星际尾部标记')&&document.field==='quote'));assert(documents.some(document=>document.item.text.includes('纸鹤结尾')&&document.field==='note'));assert(documents.every(document=>document.item.id.startsWith('mem:library:l:')));assert.equal(rankMemory(entries,'星际尾部标记').results[0].kind,'library');assert.equal(rankMemory(entries,'纸鹤结尾').results[0].snippetField,'note');assert.equal(rankMemory(entries,'星际尾部标记').results[0].searchParts,undefined);
 assert.equal(searchCorpus({library:[item],tasks:[{id:'t',name:'任务',pages:[]}],scope:'library',filters:{taskId:'t',taskMode:'associated'}}).length,1);
 assert.equal(searchCorpus({library:[item],scope:'library',filters:{taskId:'t',taskMode:'observed'}}).length,0);
});
test('format six round-trips complete materials and validates references; older formats supply an empty library',()=>{
 const task=normalizers.taskFrom({id:'t',name:'任务',pages:[]}),data={schemaVersion:6,pages:[],segments:[],taskRelations:[],tasks:[task],libraryItems:[record({quote:'🙂'.repeat(20000)})],settings:normalizers.settingsFrom({})};
 const value=decodeBackup(JSON.stringify(data),normalizers);assert.equal(value.libraryItems[0].quote,data.libraryItems[0].quote);assert.equal(planImport(value,{...value,libraryItems:[]}).data.libraryItems.length,1);
 const wrong=structuredClone(data);wrong.libraryItems[0].taskIds=['missing'];assert.throws(()=>decodeBackup(wrong,normalizers),{code:'IMPORT_INVALID'});
 for(const schemaVersion of [2,3,4,5])assert.deepEqual(decodeBackup({...data,schemaVersion,libraryItems:undefined},normalizers).libraryItems,[]);
 const changed=structuredClone(value);changed.libraryItems[0].note='改动';assert.notEqual(backupStamp(value),backupStamp(changed));
 const keep=planImport(changed,value),take=planImport(changed,value,{choices:{'library:l':'backup'}});assert.equal(keep.data.libraryItems[0].note,value.libraryItems[0].note);assert.equal(take.data.libraryItems[0].note,'改动');assert.equal(keep.counts.libraryConflicts,1);
});
