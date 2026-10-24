/** Zero-dependency native-extension acceptance helper. Requires a supplied Chrome for Testing executable. */
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join,extname} from 'node:path';
import {createServer} from 'node:http';

export const repo=resolve(new URL('../..',import.meta.url).pathname);
export const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function until(check,label,timeout=20000){const end=Date.now()+timeout;let last;while(Date.now()<end){try{const result=await check();if(result)return result;}catch(error){last=error;}await sleep(60);}throw Error('Timeout: '+label+(last?' / '+last.message:''));}
export class Browser{
  constructor(ws,proc,profile){this.ws=ws;this.proc=proc;this.profile=profile;this.serial=0;this.pending=new Map();this.events=[];
    ws.onmessage=event=>{const value=JSON.parse(event.data);if(!value.id){this.events.push(value);if(this.events.length>500)this.events.shift();return;}const saved=this.pending.get(value.id);if(!saved)return;this.pending.delete(value.id);clearTimeout(saved.timer);if(value.error)saved.reject(Error(value.error.message));else saved.resolve(value.result);};
    ws.onclose=()=>{for(const saved of this.pending.values()){clearTimeout(saved.timer);saved.reject(Error('Browser connection closed'));}this.pending.clear();};}
  send(method,params={},sessionId,timeout=30000){const id=++this.serial;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('CDP timeout: '+method));},timeout);this.pending.set(id,{resolve,reject,timer});this.ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});}
  async attach(targetId){const {sessionId}=await this.send('Target.attachToTarget',{targetId,flatten:true});await this.send('Runtime.enable',{},sessionId);return new Page(this,targetId,sessionId);}
  async page(url,width=1280,height=900){const {targetId}=await this.send('Target.createTarget',{url:'about:blank'});const page=await this.attach(targetId);await page.send('Page.enable');await page.size(width,height);await page.send('Page.navigate',{url});return page;}
  async close(){const exited=()=>this.proc.exitCode!==null||this.proc.signalCode!==null;try{await this.send('Browser.close',{},undefined,3000);}catch{}if(!exited()){this.proc.kill('SIGTERM');await Promise.race([new Promise(resolve=>this.proc.once('exit',resolve)),sleep(10000)]);}if(!exited()){this.proc.kill('SIGKILL');await Promise.race([new Promise(resolve=>this.proc.once('exit',resolve)),sleep(10000)]);}this.ws.close();await sleep(150);if(exited())rmSync(this.profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});else throw Error('Isolated test browser did not exit.');}
}
export class Page{
  constructor(browser,targetId,sessionId){Object.assign(this,{browser,targetId,sessionId});}
  send(method,params={},timeout=30000){return this.browser.send(method,params,this.sessionId,timeout);}
  async eval(fn,...args){const expression='('+fn.toString()+')(...'+JSON.stringify(args)+')';const value=await this.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true},120000);if(value.exceptionDetails)throw Error(value.exceptionDetails.exception?.description||value.exceptionDetails.text);return value.result?.value;}
  async size(width,height){await this.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});}
  async click(selector){await until(()=>this.eval(selector=>{const node=document.querySelector(selector);return node&&!node.disabled;},selector),'enabled '+selector);const rect=await this.eval(async selector=>{let previous='',stable=0;for(let index=0;index<60;index++){const node=document.querySelector(selector);if(!node||node.disabled){await new Promise(requestAnimationFrame);continue;}node.scrollIntoView({block:'nearest'});await new Promise(requestAnimationFrame);const r=node.getBoundingClientRect(),key=[r.x,r.y,r.width,r.height].join(',');stable=key===previous?stable+1:0;previous=key;if(stable>=4&&r.width&&r.height){const point={x:r.x+r.width/2,y:r.y+r.height/2};if(node.contains(document.elementFromPoint(point.x,point.y)))return point;}}throw Error('Unstable '+selector);},selector);await this.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...rect});await this.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...rect});}
  async fill(selector,value){await this.eval((selector,value)=>{const node=document.querySelector(selector);if(!node)throw Error('Missing '+selector);node.focus();node.value=value;node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));},selector,value);}
  async screenshot(path){const result=await this.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(path,Buffer.from(result.data,'base64'));}
  async close(){await this.browser.send('Target.closeTarget',{targetId:this.targetId});}
}
export async function setup({headed=false,out='docs/reviews/v2.3'}={}){
  const config=process.argv.find(value=>value.startsWith('--chrome-config='))?.split('=').slice(1).join('=');
  const binary=process.env.CHROME_PATH||(config?JSON.parse(readFileSync(config,'utf8')).binary:null);
  if(!binary)throw Error('Set CHROME_PATH or pass --chrome-config with a Chrome for Testing runtime JSON.');
  mkdirSync(resolve(out,'screenshots'),{recursive:true});
  const server=createServer((request,response)=>{const url=new URL(request.url,'http://fixture.test');
    if(url.pathname.startsWith('/fixture/')){const title=decodeURIComponent(url.pathname.slice(9)).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');response.setHeader('content-type','text/html; charset=utf-8');response.end('<!doctype html><html lang="zh"><meta charset="utf-8"><title>'+title+'</title><main><h1>浏览器扩展资料</h1><p id="quote">离线模型可以在浏览器中计算文本向量，用于找回阅读资料。</p><input aria-label="草稿" value="未保存的编辑"></main></html>');return;}
    try{const file=resolve(repo,'.'+decodeURIComponent(url.pathname));if(!file.startsWith(repo+'/'))throw Error();const type={'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.png':'image/png'}[extname(file)]||'application/octet-stream';response.setHeader('content-type',type);response.end(readFileSync(file));}catch{response.statusCode=404;response.end('Not found');}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  const profile=mkdtempSync(join(tmpdir(),'focuence-acceptance-'));
  const proc=spawn(binary,[...(headed?[]:['--headless=new']),'--remote-debugging-port=0','--user-data-dir='+profile,'--no-first-run','--no-default-browser-check',
    '--disable-background-networking','--renderer-process-limit=4','--process-per-site','--disk-cache-size=1048576','--media-cache-size=1048576','--disable-component-update','--disable-features=Translate,MediaRouter','--disable-dev-shm-usage','--mute-audio',
    '--disable-extensions-except='+repo,'--load-extension='+repo,'--window-size=1440,950','about:blank'],{stdio:['ignore','ignore','pipe']});
  let browser;
  try{const socket=await new Promise((resolve,reject)=>{let buffer='';const timer=setTimeout(()=>reject(Error('Chrome startup timeout: '+buffer.slice(-500))),30000);
    proc.stderr.on('data',chunk=>{buffer=(buffer+chunk.toString()).slice(-4000);const match=buffer.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1]);}});proc.once('error',error=>{clearTimeout(timer);reject(error);});proc.once('exit',code=>{clearTimeout(timer);reject(Error('Chrome startup exit '+code+': '+buffer));});});
    const ws=new WebSocket(socket);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});browser=new Browser(ws,proc,profile);
    const workerInfo=await until(async()=>{const {targetInfos}=await browser.send('Target.getTargets');for(const item of targetInfos.filter(item=>item.type==='service_worker'&&item.url.endsWith('/background.js'))){const target=await browser.attach(item.targetId);if((await target.eval(()=>chrome.runtime.getManifest().name))?.startsWith('Focuence'))return item;}},'extension worker',60000);
    const extensionId=new URL(workerInfo.url).hostname,worker=await browser.attach(workerInfo.targetId);
    const control=await browser.page('chrome-extension://'+extensionId+'/app/index.html#tasks');
    try{await until(()=>control.eval(()=>!!document.querySelector('#main')),'workspace ready');}catch(error){
      const detail=await control.eval(()=>({url:location.href,body:document.body?.innerText}));console.error(JSON.stringify({detail,errors:browser.events.filter(item=>item.method==='Runtime.exceptionThrown')},null,2));await control.screenshot(resolve(out,'screenshots/startup-failure.png')).catch(()=>{});throw error;
    }
    const windowId=await control.eval(async()=>(await chrome.windows.getCurrent()).id);
    const rpc=async(type,payload={})=>{const result=await control.eval(message=>chrome.runtime.sendMessage({target:'background',...message}),{type,windowId,...payload});if(!result?.ok)throw Object.assign(Error(result?.error||'No response'),{code:result?.code});return result.data;};
    await rpc('GET_STATE');
    return{browser,worker,control,rpc,windowId,extensionId,base,out:resolve(out),async close(){await browser.close();await new Promise(resolve=>server.close(resolve));}};
  }catch(error){if(browser)await browser.close();else{proc.kill('SIGTERM');await sleep(200);rmSync(profile,{recursive:true,force:true});}await new Promise(resolve=>server.close(resolve));throw error;}
}
