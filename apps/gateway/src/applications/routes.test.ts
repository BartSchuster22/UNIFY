import Fastify from 'fastify';
import {describe,it,expect,vi} from 'vitest';
import {applicationRoutes} from './routes.js';
import type {ApplicationService} from './service.js';
const id='11111111-1111-4111-8111-111111111111';
describe('application operator ownership (mock service, real HTTP routing)',()=>{
 for(const foreign of [false,true])for(const action of ['revoke','issue','revokeCredential'] as const)it(`${action}: ${foreign?'foreign owner denied':'registered owner allowed'}`,async()=>{
  const server=Fastify();const service={registration:vi.fn(async()=>({owner_id:foreign?'other-owner':'owner'})),revoke:vi.fn(async()=>undefined),store:{credential:vi.fn(async()=>({id:'fixture'})),revokeCredential:vi.fn(async()=>true)}};
  applicationRoutes(server,service as unknown as ApplicationService,async()=> 'owner',async()=>true);
  try{
   const response=await server.inject({method:action==='issue'?'POST':'DELETE',url:'/api/v1/applications/'+id+(action==='revoke'?'':action==='issue'?'/credentials':'/credentials/'+id),...(action==='issue'?{payload:{ttlSeconds:600}}:{})});
   expect(response.statusCode).toBe(foreign?404:action==='revoke'?202:action==='issue'?201:204);
   const mutation=action==='revoke'?service.revoke:action==='issue'?service.store.credential:service.store.revokeCredential;
   expect(mutation).toHaveBeenCalledTimes(foreign?0:1);
  }finally{await server.close();}
 });
});
