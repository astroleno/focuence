import test from 'node:test';import assert from 'node:assert/strict';import {recentSessions,restoreRecentSession} from '../src/browser-history.js';
test('sessions remain optional and filtered windows cannot bypass exclusions through whole restore',async()=>{
 let enabled=false,restored=0;const api={permissions:{contains:async()=>enabled},sessions:{getRecentlyClosed:async()=>[{lastModified:100,window:{sessionId:'w',tabs:[{url:'https://good.test/',title:'好'},{url:'https://private.test/',title:'私密'}]}},{lastModified:101,tab:{sessionId:'t',url:'https://good.test/a',title:'页面'}}],restore:async()=>restored++}};
 const allowed=url=>!url.includes('private');assert.equal((await recentSessions(api,allowed)).enabled,false);
 await assert.rejects(restoreRecentSession(api,'t',allowed),{code:'PERMISSION_REQUIRED'});enabled=true;
 const list=await recentSessions(api,allowed);assert.equal(list.items[0].pages.length,1);assert.equal(list.items[0].omitted,1);assert.equal(list.items[0].at,100000);
 await assert.rejects(restoreRecentSession(api,'w',allowed),{code:'FILTERED_SESSION'});assert.equal(restored,0);
 await restoreRecentSession(api,'t',allowed);assert.equal(restored,1);await assert.rejects(restoreRecentSession(api,'gone',allowed),{code:'STALE_SESSION'});
});
