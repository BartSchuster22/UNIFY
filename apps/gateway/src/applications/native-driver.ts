import {canonicalHash} from '../governance/canonical.js';
import {createHash} from 'node:crypto';
import type {FrameworkRegistryService} from '../framework-registry/service.js';
import {AuthError} from '../auth/service.js';
import type {ApplicationManifest} from './contract.js';
import type {Registration,Receipt} from './store.js';
import type {ApplicationNativeBackend,NativeObservation} from './service.js';
export interface KnowledgeBoundary {
 prepare(app:Registration,receipt:Receipt):Promise<unknown>;
 finalize(app:Registration,receipt:Receipt,result:unknown):Promise<unknown>;
 erase(app:Registration,receipt:Receipt):Promise<boolean>;
}
/** A bounded application-to-native bridge, not an execution state owner. */
export class NativeApplicationDriver implements ApplicationNativeBackend {
 constructor(private readonly registry:FrameworkRegistryService,private readonly knowledge:KnowledgeBoundary,private readonly fetchImpl:typeof fetch=fetch){}
 async bind(manifest:ApplicationManifest){
  const c=await this.registry.connection(manifest.frameworkId,'control:execute');
  return {frameworkId:c.frameworkId,frameworkVersion:c.frameworkVersion,frameworkCommit:c.frameworkCommit,
   endpoint:c.baseUrl,authority:createHash('sha256').update(c.bearerToken).digest('hex')};
 }
 async available(app:Registration){try{
  const c=await this.connection(app);const response=await this.fetchImpl(c.baseUrl.replace(/\/$/,'')+'/control/v1/applications/capabilities',{redirect:'error',headers:{authorization:'Bearer '+c.bearerToken},signal:AbortSignal.timeout(5000)});
  if(!response.ok||Number(response.headers.get('content-length')??0)>4096)return false;
  const reader=response.body?.getReader();if(!reader)return false;let body='';const decoder=new TextDecoder();
  while(true){const x=await reader.read();if(x.done)break;body+=decoder.decode(x.value,{stream:true});if(Buffer.byteLength(body)>4096){await reader.cancel();return false;}}
  const v=JSON.parse(body);return v.contractVersion==='alica-native-application/v1'&&v.frameworkId===app.manifest.frameworkId&&v.frameworkCommit===c.frameworkCommit&&v.data?.supported===true;
 }catch{return false;}}
 async submit(app:Registration,r:Receipt){
  const prepared=await this.knowledge.prepare(app,r) as Array<{quote:string;source:{url:string;retrievedAt:string;sha256:string;excerpt:string}}>;
  const knowledge=prepared.map(k=>({quote:k.quote,validated:true,url:k.source.url,retrievedAt:k.source.retrievedAt,sha256:k.source.sha256,excerpt:k.source.excerpt}));
  const value=await this.call('execute',app,r,knowledge);if(!value)throw new Error('Native execution returned no durable reference');return value;}
 async lookup(app:Registration,r:Receipt){return this.call('lookup',app,r);}
 async cancel(app:Registration,r:Receipt){return this.call('cancel',app,r);}
 async finalize(app:Registration,r:Receipt,result:unknown){
  const n=result as {evidence:Array<{url:string;sha256:string}>};
  if(!n||!Array.isArray(n.evidence))throw new Error('Native evidence missing');
  return this.knowledge.finalize(app,r,{...n,evidence:n.evidence.map(s=>({...s,metadata:{runId:r.id,sourceId:createHash('sha256').update(s.url+':'+s.sha256).digest('hex'),toolName:'application-runtime.source-context/v1'}}))});
 }
 async verifyEvidence(app:Registration,r:Receipt,source:{url:string;sha256:string;retrievedAt:string;excerpt:string;metadata:{runId:string;sourceId:string;toolName:string}}){
  if(source.metadata.runId!==r.id||source.metadata.toolName!=='application-runtime.source-context/v1'||source.metadata.sourceId!==createHash('sha256').update(source.url+':'+source.sha256).digest('hex'))return false;
  const observed=await this.lookup(app,r);const native=observed?.result as {evidence?:Array<{url:string;sha256:string;retrievedAt:string;excerpt:string}>}|undefined;
  return observed?.state==='completed'&&Boolean(native?.evidence?.some(s=>s.url===source.url&&s.sha256===source.sha256&&s.retrievedAt===source.retrievedAt&&s.excerpt===source.excerpt));
 }
 async erase(app:Registration,r:Receipt){
  const observed=await this.call('erase',app,r);
  // Never scrub Core while native ownership is unresolved or still running.
  if(observed!==null&&observed.state!=='cancelled')return false;
  return this.knowledge.erase(app,r);
 }
 private async connection(app:Registration){
  const current=await this.bind(app.manifest);
  if(!app.native_binding||canonicalHash(current)!==canonicalHash(app.native_binding))throw new AuthError('APPLICATION_BINDING_CHANGED',409,'Native endpoint/authority changed; explicit operator reconciliation required');
  return this.registry.connection(app.manifest.frameworkId,'control:execute');
 }
 private async call(action:'execute'|'lookup'|'cancel'|'erase',app:Registration,r:Receipt,knowledge?:unknown):Promise<NativeObservation|null>{
  const c=await this.connection(app);const controller=new AbortController();const deadline=setTimeout(()=>controller.abort(),190000);deadline.unref();
  try{
   const response=await this.fetchImpl(c.baseUrl.replace(/\/$/,'')+'/control/v1/applications/'+action,{
    method:'POST',redirect:'error',signal:controller.signal,headers:{authorization:'Bearer '+c.bearerToken,'content-type':'application/json','x-request-id':r.id},
    body:JSON.stringify({receiptId:r.id,applicationId:app.id,projectId:app.manifest.projectId,subject:r.payload?.subject,payload:r.payload,sourceUrls:app.manifest.sourceUrls,...(knowledge===undefined?{}:{knowledge})}),
   });
   if(!response.ok)throw new AuthError('APPLICATION_NATIVE_UNAVAILABLE',502,'Native application operation failed');
   if(Number(response.headers.get('content-length')??0)>262144)throw new Error('Native response limit');
   const reader=response.body?.getReader();if(!reader)throw new Error('Native response missing');const chunks:Uint8Array[]=[];let size=0;
   while(true){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>262144){await reader.cancel();throw new Error('Native response limit');}chunks.push(item.value);}
   const envelope=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(envelope.contractVersion!=='alica-native-application/v1'||envelope.frameworkId!==app.manifest.frameworkId||envelope.frameworkCommit!==c.frameworkCommit)throw new Error('Native provenance mismatch');
   const result=envelope.data;
   if(result.state==='missing')return null;
   if(!['running','completed','failed','cancelled'].includes(result.state))throw new Error('Native state invalid');
   const ref=result.reference;
   if(!ref||ref.receiptId!==r.id||ref.applicationId!==app.id||ref.projectId!==app.manifest.projectId||ref.subject!==r.payload?.subject||typeof ref.taskId!=='string'||typeof ref.sessionId!=='string')throw new Error('Native scope mismatch');
   return result as NativeObservation;
  }finally{clearTimeout(deadline);}
 }
}
