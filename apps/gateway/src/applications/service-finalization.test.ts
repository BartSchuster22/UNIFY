import {describe,it,expect,vi} from 'vitest';
import {ApplicationService,type ApplicationNativeBackend} from './service.js';
import type {ApplicationStore} from './store.js';
// Labelled transport mocks: these are regression tests, not live qualification.
describe('governed result bound terminal handling',()=>{
 for(const mode of ['KNOWLEDGE_SIZE_LIMIT','output-limit','transient'] as const)it(mode,async()=>{
  const receipt={id:'receipt',application_id:'app',phase:'native-linked',payload:{subject:'subject'},native_reference:{taskId:'native-task'}};
  const owner={query:vi.fn(async(_sql:string,_params?:unknown[])=>({rows:[{held:true}]})),release:vi.fn()};
  const store={pool:{query:vi.fn(async(sql:string)=>({rows:sql.includes('application_integrations')?[{id:'app',revoked_at:null}]:sql.startsWith('SELECT')?[receipt]:[]})),connect:vi.fn(async()=>owner)},get:vi.fn(async()=>receipt),complete:vi.fn()};
  const native={lookup:vi.fn(async()=>({state:'completed',reference:receipt.native_reference,result:{}})),finalize:vi.fn(async()=>{if(mode==='output-limit')return {answer:'x'.repeat(65536)};throw new Error(mode);})};
  const service=new ApplicationService(store as unknown as ApplicationStore,native as unknown as ApplicationNativeBackend,'x'.repeat(32));
  if(mode==='transient')await expect(service.reconcileOne()).rejects.toThrow('transient');
  else await expect(service.reconcileOne()).resolves.toBe(true);
  const rejections=owner.query.mock.calls.filter(c=>String(c[0]).includes('GOVERNED_RESULT_LIMIT'));
  expect(rejections).toHaveLength(mode==='transient'?0:1);
  if(rejections.length)expect(String(rejections[0]![0])).toContain("phase='native-linked'");
  expect(store.complete).not.toHaveBeenCalled();
  expect(owner.release).toHaveBeenCalledOnce();
  expect(owner.query.mock.calls.some(c=>String(c[0]).includes('pg_advisory_unlock'))).toBe(true);
 });
});
