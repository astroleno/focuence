import {diagnosticEvent,DIAGNOSTIC_LIMIT,DIAGNOSTIC_AGE} from './diagnostics.js';
const request=value=>new Promise((resolve,reject)=>{value.onsuccess=()=>resolve(value.result);value.onerror=()=>reject(value.error);});
const initial=now=>({key:'control',enabled:true,revision:0,startedAt:now,capacityTrimmed:0});

/** Independent local database; never shares stores with tasks, history or backup. */
export async function openDiagnosticsStore({indexedDB=globalThis.indexedDB,IDBKeyRange=globalThis.IDBKeyRange,name='focuence-diagnostics-v1'}={}) {
  const db=await new Promise((resolve,reject)=>{
    let blocked=false;const opening=indexedDB.open(name,1);
    const timer=setTimeout(()=>{blocked=true;reject(Error('DIAGNOSTICS_TIMEOUT'));},2000);
    opening.onupgradeneeded=()=>{const db=opening.result;db.createObjectStore('meta',{keyPath:'key'});db.createObjectStore('events',{keyPath:'id'}).createIndex('at','at');};
    opening.onerror=()=>{clearTimeout(timer);reject(opening.error);};
    opening.onblocked=()=>{clearTimeout(timer);blocked=true;reject(Error('DIAGNOSTICS_BLOCKED'));};
    opening.onsuccess=()=>{clearTimeout(timer);if(blocked){opening.result.close();return;}opening.result.onversionchange=()=>opening.result.close();resolve(opening.result);};
  });
  function transaction(mode,operation){return new Promise((resolve,reject)=>{
    let value;const tx=db.transaction(['meta','events'],mode);
    const timer=setTimeout(()=>{try{tx.abort();}catch{}reject(Error('DIAGNOSTICS_TIMEOUT'));},2000);
    tx.oncomplete=()=>{clearTimeout(timer);resolve(value);};tx.onerror=()=>{clearTimeout(timer);reject(tx.error);};tx.onabort=()=>{clearTimeout(timer);reject(tx.error||Error('DIAGNOSTICS_ABORTED'));};
    Promise.resolve().then(()=>operation(tx.objectStore('meta'),tx.objectStore('events'))).then(result=>{value=result;}).catch(error=>{try{tx.abort();}catch{}reject(error);});
  });}
  async function prune(events,control,now){
    await new Promise((resolve,reject)=>{const cursor=events.index('at').openCursor(IDBKeyRange.upperBound(now-DIAGNOSTIC_AGE,true));
      cursor.onerror=()=>reject(cursor.error);cursor.onsuccess=()=>{const row=cursor.result;if(!row)return resolve();row.delete();row.continue();};});
    let excess=Math.max(0,await request(events.count())-DIAGNOSTIC_LIMIT);
    if(excess){control.capacityTrimmed+=excess;await new Promise((resolve,reject)=>{const cursor=events.index('at').openCursor();cursor.onerror=()=>reject(cursor.error);
      cursor.onsuccess=()=>{const row=cursor.result;if(!row||!excess)return resolve();row.delete();excess--;row.continue();};});}
  }
  return {
    load(now=Date.now()){return transaction('readwrite',async(meta,events)=>{const control=await request(meta.get('control'))||initial(now);await prune(events,control,now);meta.put(control);return control;});},
    append(value,revision,now=Date.now()){return transaction('readwrite',async(meta,events)=>{
      const control=await request(meta.get('control'))||initial(now),event=diagnosticEvent(value,now);
      if(!event||event.at<now-DIAGNOSTIC_AGE||!control.enabled||control.revision!==revision)return false;
      events.put(event);await prune(events,control,now);meta.put(control);return true;
    });},
    configure(enabled,now=Date.now()){return transaction('readwrite',async meta=>{const control=await request(meta.get('control'))||initial(now);control.enabled=enabled===true;control.revision++;meta.put(control);return control;});},
    clear({reset=false,now=Date.now()}={}){return transaction('readwrite',async(meta,events)=>{const old=await request(meta.get('control'))||initial(now);
      const control={...initial(now),enabled:reset?true:old.enabled,revision:old.revision+1};events.clear();meta.put(control);return control;});},
    snapshot(now=Date.now()){return transaction('readonly',async(meta,events)=>({control:await request(meta.get('control'))||initial(now),
      events:(await request(events.index('at').getAll())).map(row=>diagnosticEvent(row,now)).filter(row=>row&&row.at>=now-DIAGNOSTIC_AGE).slice(-DIAGNOSTIC_LIMIT)}));},
    close(){db.close();},
  };
}
