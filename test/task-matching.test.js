import test from 'node:test';
import assert from 'node:assert/strict';
import { matchTaskPages, goalItem, pageItem } from '../src/task-matching.js';

const task={id:'A',name:'登录改版',goal:'设计登录错误状态',pages:[]};
const pages=[{id:1,pageId:'p',windowId:1,title:'表单校验与错误提示',url:'https://docs.test/form',pinned:true,groupId:3},
  {id:2,pageId:'q',windowId:1,title:'设备电池维护',url:'https://other.test/power'}];
const vectors=new Map([[goalItem(task).id,[1,0]],[pageItem(pages[0]).id,[1,0]],[pageItem(pages[1]).id,[0,1]]]);

test('task association permits cross-site pinned and grouped materials',()=>{
  const result=matchTaskPages(task,pages,[],vectors);
  assert.equal(result[0].pageId,'p'); assert.equal(result[0].method,'semantic'); assert(!result.some(item=>item.pageId==='q'));
});

test('explicit exclusions defeat semantic similarity and do not exclude other tasks',()=>{
  const relations=[{taskId:'A',pageId:'p',decision:'unrelated'}];
  assert(!matchTaskPages(task,pages,relations,vectors).some(item=>item.pageId==='p'));
  assert(matchTaskPages({...task,id:'B',pages:[pages[0]]},pages,relations,vectors).some(item=>item.pageId==='p'));
});
