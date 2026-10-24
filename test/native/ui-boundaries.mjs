import {setup,until} from './cdp.mjs';import assert from 'node:assert/strict';import {writeFileSync} from 'node:fs';
const env=await setup({headed:true}),{browser,control,rpc,windowId,base,extensionId}=env,report={environment:'Native extension UI and isolated synthetic pages. Toolbar popup is opened through the actual browser action.',checks:[],errors:[]};
const check=(name,detail={})=>{report.checks.push({name,status:'passed',detail});console.log(name);};
let currentPage;
try{
 await rpc('CLEAR_ALL');await rpc('UPDATE_SETTINGS',{patch:{tracking:false,semantic:false}});
 await control.eval(async({base,windowId})=>{for(const path of ['麦克风接口','扬声器功放','网页离线模型'])await chrome.tabs.create({windowId,url:base+'/fixture/'+path,active:false});},{base,windowId});
 await until(async()=>(await rpc('LIST_WORKSPACE_TABS')).tabs.length===3,'fixtures loaded');
 const task=await rpc('SAVE_TASK',{mode:'intent',name:'音频接口核对',goal:'核对输入和播放资料',notes:'保留原始参数'});
 const audit=async(page,label)=>{
  const value=await page.eval(()=>({width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,
    duplicateIds:[...document.querySelectorAll('[id]')].map(node=>node.id).filter((id,index,all)=>all.indexOf(id)!==index),stray:[...document.querySelectorAll('.browser-workspace')].some(node=>/(^|\n)(false|true)(\n|$)/.test(node.innerText))}));
  assert.equal(value.overflow,false,label);assert.deepEqual(value.duplicateIds,[],label);assert.equal(value.stray,false,label);check(label,value);
 };
 for(const [surface,width,height]of [['panel',320,760],['panel',360,760],['popup',400,520],['popup',400,600],['app',1440,950]]){
  const page=await browser.page('chrome-extension://'+extensionId+'/'+surface+'/index.html?windowId='+windowId+'#pages',width,height);
  currentPage=page;
  if(surface==='popup'){await until(()=>page.eval(()=>!!document.querySelector('[data-action="view"][data-view="tabs"]')),'popup tabs');await page.click('[data-action="view"][data-view="tabs"]');}
  else{await until(()=>page.eval(()=>!!document.querySelector('[data-mode="workspace"]')),'workspace navigation');await page.click('[data-mode="workspace"]');}
  await until(()=>page.eval(()=>document.querySelectorAll('.w-row').length===3),'workspace rows');await audit(page,surface+' '+width+'×'+height+' workspace');
  const first=await page.eval(()=>document.querySelector('.w-row input').id);await page.click('#'+first);
  await until(()=>page.eval(()=>!!document.querySelector('#w-field-name')),'selected page form');
  await page.fill('#w-field-name','长'.repeat(121));await page.fill('#w-field-nextStep','核对供电噪声');await page.click('[data-w-action="preview"]');
  await until(()=>page.eval(()=>!!document.querySelector('.w-error')),'overlong task error');assert.equal(await page.eval(()=>document.querySelector('#w-field-name').value.length),121);
  await page.fill('#w-field-name','页面收起核对');await page.click('[data-w-action="preview"]');await until(()=>page.eval(()=>!!document.querySelector('[data-w-action="execute"]')),'close preview');
  await audit(page,surface+' '+width+'×'+height+' close preview');await page.screenshot(env.out+'/screenshots/'+surface+'-'+width+'x'+height+'-preview.png');
  if(surface==='panel'&&width===360){await page.click('[data-w-action="execute"]');await until(async()=>(await rpc('GET_TAB_OPERATIONS')).some(item=>item.taskName==='页面收起核对'&&item.closed===1),'UI close');
    const operation=(await rpc('GET_TAB_OPERATIONS')).find(item=>item.taskName==='页面收起核对');const restore=await rpc('PREVIEW_RESTORE_OPERATION',{id:operation.id,windowId});await rpc('RESTORE_TAB_OPERATION',{token:restore.token});}
  await page.close();
 }
 check('Native narrow UI preserves an invalid draft and executes a reviewed save/close action');
 await control.eval(()=>location.hash='tasks');await control.send('Page.reload');await until(()=>control.eval(id=>!!document.querySelector('[data-task-status="'+id+'"]'),task.id),'task state menu');
 await control.fill('[data-task-status="'+task.id+'"]','archived');await until(()=>control.eval(id=>!document.querySelector('[data-task-status="'+id+'"]'),task.id),'archive hidden');
 await control.fill('#memory-task-filter','all');await until(()=>control.eval(id=>document.querySelector('[data-task-status="'+id+'"]')?.value==='archived',task.id),'archive visible with all filter');
 await control.fill('[data-task-status="'+task.id+'"]','active');await until(async()=>(await rpc('GET_STATE')).tasks.find(item=>item.id===task.id).status==='active','restart archived task');check('Native status menu archives, filters and explicitly restarts a task');
 await control.eval(()=>chrome.action.openPopup());
 const target=await until(async()=>(await browser.send('Target.getTargets')).targetInfos.find(item=>item.url==='chrome-extension://'+extensionId+'/popup/index.html'),'native toolbar popup');
 const popup=await browser.attach(target.targetId);await until(()=>popup.eval(()=>!!document.querySelector('[data-action="view"][data-view="tabs"]')),'actual popup UI');await popup.click('[data-action="view"][data-view="tabs"]');
 await until(()=>popup.eval(()=>document.querySelectorAll('.w-row').length===3),'actual popup rows');await audit(popup,'Actual native toolbar popup');await popup.screenshot(env.out+'/screenshots/actual-toolbar-popup.png');
 assert.equal(browser.events.filter(item=>item.method==='Runtime.exceptionThrown'&&item.params?.exceptionDetails?.url?.startsWith('chrome-extension://'+extensionId)).length,0);check('No uncaught script errors on the new native surfaces');
}catch(error){report.errors.push(error.stack);console.error(error.stack);if(currentPage)console.error('UI_DETAIL',await currentPage.eval(()=>({text:document.body.innerText.slice(-2600),name:document.querySelector('#w-field-name')?.value,errors:[...document.querySelectorAll('[role=alert]')].map(node=>node.textContent)})).catch(()=>null));console.error('SCRIPT_ERRORS',browser.events.filter(item=>item.method==='Runtime.exceptionThrown'));process.exitCode=1;}
finally{writeFileSync(env.out+'/ui.json',JSON.stringify(report,null,2));await env.close();}
