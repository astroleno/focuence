import {openDiagnosticsStore} from './diagnostics-store.js';
import {diagnosticEvent,analyzeDiagnostics,DIAGNOSTIC_LIMIT,DIAGNOSTIC_DAYS} from './diagnostics.js';

export function createDiagnostics({open=openDiagnosticsStore,now=Date.now,behaviorAllowed=()=>true}={}) {
  let store,loading,enabled=true,revision=0,generation=0,tail=Promise.resolve(),mutating=false,available=false,dropped=0,lastWriteAt=null,pending=0;
  let captureKey='',captureAt=0;
  const behavior=kind=>/^(prediction\.(shown|opened)|completion\.(shown|adopted|saved)|checkpoint\.|focus\.|group\.)/.test(kind);
  const health=()=>({available,dropped,lastWriteAt,pending});
  const schedule=operation=>{const job=tail.then(operation);tail=job.catch(()=>{});return job;};
  async function load(){
    if(available)return;
    if(loading)return loading;
    loading=(async()=>{try{store||=await open();const control=await store.load(now());enabled=control.enabled;revision=control.revision;available=true;}catch{available=false;store?.close?.();store=null;}finally{loading=null;}})();
    return loading;
  }
  function scope(){
    const expected=generation,active=enabled&&!mutating;
    return (kind,fields={})=>{
      if(!active||expected!==generation||!enabled||mutating||behavior(kind)&&!behaviorAllowed())return Promise.resolve(false);
      const event=diagnosticEvent({...fields,id:crypto.randomUUID(),at:now(),kind},now());
      if(!event)return Promise.resolve(false);
      if(pending>=100){dropped++;return Promise.resolve(false);}pending++;
      return schedule(async()=>{
        if(expected!==generation||!enabled||mutating)return false;
        try{if(!available)await load();if(!available||expected!==generation){if(!available)dropped++;return false;}
          const written=await store.append(event,revision,now());if(written)lastWriteAt=event.at;else dropped++;return written;
        }catch{available=false;store?.close?.();store=null;dropped++;return false;}
      }).finally(()=>{pending--;});
    };
  }
  async function change(operation){
    generation++;mutating=true;
    try{return await schedule(async()=>{await load();if(!available)throw Error('本机运行日志暂不可用，请稍后重试。');
      const control=await operation(store);enabled=control.enabled;revision=control.revision;return{enabled,health:health()};});}
    finally{mutating=false;}
  }
  return {
    load,scope,
    record:(kind,fields)=>scope()(kind,fields),
    capture(key,fields){if(key===captureKey&&now()-captureAt<300000)return;captureKey=key;captureAt=now();return scope()('capture.state',fields);},
    async view(range='24h',full=false){await tail;await load();if(!available)return{enabled,health:health(),range,summary:null,recent:[],retentionDays:DIAGNOSTIC_DAYS,limit:DIAGNOSTIC_LIMIT};
      try{const snapshot=await store.snapshot(now()),summary=analyzeDiagnostics(snapshot.events,{now:now(),range});
        return{enabled:snapshot.control.enabled,health:health(),retentionDays:DIAGNOSTIC_DAYS,limit:DIAGNOSTIC_LIMIT,startedAt:snapshot.control.startedAt,
          capacityTrimmed:snapshot.control.capacityTrimmed,retained:snapshot.events.length,summary,recent:snapshot.events.filter(row=>row.at>=summary.since).slice(-50).reverse(),
          ...(full?{schemaVersion:1,exportedAt:new Date(now()).toISOString(),events:snapshot.events}: {})};
      }catch{available=false;store?.close?.();store=null;return{enabled,health:health(),summary:null,recent:[],retentionDays:DIAGNOSTIC_DAYS,limit:DIAGNOSTIC_LIMIT};}},
    async setEnabled(value){const result=await change(store=>store.configure(value,now()));if(value){captureKey='';captureAt=0;}return result;},
    async clear(options={}){const result=await change(store=>store.clear({...options,now:now()}));dropped=0;lastWriteAt=null;captureAt=now();return result;},
    async prune(){await tail;if(available)try{await store.load(now());}catch{available=false;}},
    flush:()=>tail,
    close:()=>store?.close(),
  };
}
