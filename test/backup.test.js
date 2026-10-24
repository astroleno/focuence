import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeBackup,planImport,backupStamp} from '../src/backup.js';
import * as normalizers from '../src/store.js';
const fixture=()=>({schemaVersion:3,pages:[],tasks:[normalizers.taskFrom({id:'t',name:'目标',notes:'🙂'.repeat(15000),createdAt:1,updatedAt:2,pages:[]})],taskRelations:[],libraryItems:[],segments:[],settings:normalizers.settingsFrom({})});
test('formats two through six round-trip full text and unknown future format is rejected',()=>{
  for(const version of [2,3,4,5,6]){const raw={...fixture(),schemaVersion:version}; if(version===2)delete raw.taskRelations; const value=decodeBackup(JSON.stringify(raw),normalizers); assert.equal(value.tasks[0].notes,raw.tasks[0].notes);}
  assert.throws(()=>decodeBackup({...fixture(),schemaVersion:99},normalizers),{code:'IMPORT_VERSION'});
  assert.throws(()=>decodeBackup('{',normalizers),{code:'IMPORT_INVALID'});
});
test('merge previews explicit task conflict choices and never overwrites local text by default',()=>{
  const current=fixture(),incoming=decodeBackup({...fixture(),tasks:[{...fixture().tasks[0],name:'备份名称'}]},normalizers);
  const plan=planImport(incoming,current); assert.equal(plan.data.tasks[0].name,'目标');assert.equal(plan.conflicts.length,1);
  assert.equal(planImport(incoming,current,{choices:{t:'backup'}}).data.tasks[0].name,'备份名称');
  assert.equal(planImport(incoming,current,{mode:'replace'}).data.tasks[0].name,'备份名称');
});
test('invalid references, protocols, overlong fields and conflicting visit IDs fail before mutation',()=>{
  const raw=fixture(); raw.tasks[0].notes='长'.repeat(20001); assert.throws(()=>decodeBackup(raw,normalizers),{code:'IMPORT_INVALID'});
  const unsafe=fixture();unsafe.tasks[0].id='__proto__';assert.throws(()=>decodeBackup(unsafe,normalizers),{code:'IMPORT_INVALID'});
  const relation={id:'r',taskId:'missing',revision:'r',decision:'related',page:{url:'javascript:bad'}};
  assert.throws(()=>decodeBackup({...fixture(),taskRelations:[relation]},normalizers),{code:'IMPORT_INVALID'});
  const segment={id:'s',pageId:'p',url:'https://example.test/',title:'A',status:'active',startedAt:1,endedAt:2,foregroundMs:1};
  const a=decodeBackup({...fixture(),segments:[segment]},normalizers),b=decodeBackup({...fixture(),segments:[{...segment,title:'B'}]},normalizers);
  assert.throws(()=>planImport(a,b),{code:'IMPORT_CONFLICT'});
  assert.equal(planImport(a,a).data.segments.length,0);
});
test('merge base tolerates new observations but replacement and task mutations invalidate preview',()=>{
  const before=fixture(),after=structuredClone(before);after.segments.push({id:'new'});
  assert.equal(backupStamp(before),backupStamp(after));assert.notEqual(backupStamp(before,true),backupStamp(after,true));
  after.tasks[0].revision++;assert.notEqual(backupStamp(before),backupStamp(after));
});
