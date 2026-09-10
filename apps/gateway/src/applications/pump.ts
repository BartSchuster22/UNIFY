import type {ApplicationService} from './service.js';
/** Independent bounded transport/reconciliation lanes; never a native work scheduler. */
export function applicationPump(service:ApplicationService,onError:(lane:string)=>void,intervalMs=1000){
 if(!Number.isInteger(intervalMs)||intervalMs<250)throw new Error('Invalid application pump interval');
 let stopped=false;const active=new Map<string,Promise<unknown>>();
 const lanes:Record<string,()=>Promise<unknown>>={dispatch:()=>service.dispatchOne(),reconcile:()=>service.reconcileOne(),delivery:()=>service.deliverOne(),retention:()=>service.expireOne()};
 const tick=()=>{if(stopped)return;for(const [name,work] of Object.entries(lanes)){if(active.has(name))continue;const task=Promise.resolve().then(work).catch(()=>onError(name)).finally(()=>active.delete(name));active.set(name,task);}};
 const timer=setInterval(tick,intervalMs);timer.unref();tick();
 return async()=>{stopped=true;clearInterval(timer);await Promise.allSettled([...active.values()]);};
}
