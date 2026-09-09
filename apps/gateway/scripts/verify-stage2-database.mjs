// Real PostgreSQL checks; run only with the disposable STAGE2_TEST_DATABASE_URL.
import assert from 'node:assert/strict';
import pg from 'pg';
import { PostgresOidcStore } from '../dist/auth/oidc-store.js';
import { PostgresProjectCredentialStore, ProjectCredentialService } from '../dist/auth/project-credentials.js';
const url=process.env.STAGE2_TEST_DATABASE_URL;
if(!url || new URL(url).hostname!=='127.0.0.1') throw Error('Disposable loopback test DB required');
const pool=new pg.Pool({connectionString:url,max:4});
const identity={issuer:'https://stage2.test/realms/test',subject:'fixture',displayName:'Stage 2 fixture',roles:['Administrator']};
let count=0;const check=(v)=>{assert.ok(v);count++;};
try{
 const store=new PostgresOidcStore(pool);
 const ids=await Promise.all(Array.from({length:8},()=>store.resolveIdentity(identity)));
 check(new Set(ids).size===1);
 const second=await store.resolveIdentity({...identity,issuer:'https://other.test/realms/test'});check(second!==ids[0]);
 check((await pool.query('SELECT count(*)::int n FROM oidc_identities')).rows[0].n===2);
 await store.putFlow('a'.repeat(64),'sealed-fixture',new Date(Date.now()+60000));
 const consumed=await Promise.all([store.consumeFlow('a'.repeat(64)),store.consumeFlow('a'.repeat(64))]);check(consumed.filter(x=>x==='sealed-fixture').length===1);
 await store.putFlow('b'.repeat(64),'expired-fixture',new Date(1));check(await store.consumeFlow('b'.repeat(64))===null);
 await pool.query("UPDATE users SET status='disabled' WHERE id=$1",[ids[0]]);
 await assert.rejects(()=>store.resolveIdentity(identity),{code:'OIDC_NOT_ADMITTED'});count++;
 await pool.query("UPDATE users SET status='active' WHERE id=$1",[ids[0]]);
 const user=await pool.query('SELECT password_hash FROM users WHERE id=$1',[ids[0]]);check(user.rows[0].password_hash==='!oidc:no-local-password');
 const roles=await pool.query('SELECT r.name FROM roles r JOIN user_roles u ON u.role_id=r.id WHERE u.user_id=$1',[ids[0]]);check(roles.rows[0].name==='Administrator');
 await store.resolveIdentity({...identity,roles:['Viewer']});check((await pool.query('SELECT r.name FROM roles r JOIN user_roles u ON u.role_id=r.id WHERE u.user_id=$1',[ids[0]])).rows[0].name==='Viewer');
 const svc=new ProjectCredentialService(new PostgresProjectCredentialStore(pool));
 const issued=await svc.create(ids[0],'DB fixture','hermes-alica','fixture-project',120);
 check((await svc.authorize('Bearer '+issued.token,'hermes-alica','fixture-project')).id===issued.grant.id);
 check(!JSON.stringify(await svc.store.list()).includes(issued.token));
 await assert.rejects(()=>svc.authorize('Bearer '+issued.token,'hermes-alica','wrong'),{code:'PROJECT_SCOPE_DENIED'});count++;
 check(await svc.store.revoke(issued.grant.id));await assert.rejects(()=>svc.authorize('Bearer '+issued.token,'hermes-alica','fixture-project'),{code:'SERVICE_AUTH_REQUIRED'});count++;
 const grants=await pool.query("SELECT table_name,privilege_type FROM information_schema.role_table_grants WHERE grantee='unify_hermes_adapter_runtime' AND table_name IN ('oidc_identities','oidc_flows','oidc_session_tokens','project_service_credentials')");check(grants.rowCount===0);
 console.log(JSON.stringify({schema:'dsh-stage2-database-tests/v1',passed:true,assertions:count,backend:'real PostgreSQL'}));
}finally{await pool.end();}
