#!/usr/bin/env python3
"""Read authoritative recurring outcomes; real negative/limited control fixtures, no data rewrites."""
import concurrent.futures,datetime as dt,hashlib,json,subprocess,time
from qa_common import *
NATIVE='dsh2-stage4-qa4-hermes-1';CHECKS={}
meta=json.loads(subprocess.check_output(['docker','inspect',NATIVE]))[0]
assert meta['Config']['Labels']['com.docker.compose.project']=='dsh2-stage4-qa4'
def native(action,data,expect=True):
 r=subprocess.run(['docker','exec','-i','--user','10000:10001',NATIVE,'/usr/bin/env','HERMES_HOME=/opt/data','HOME=/opt/data','PYTHONPATH=/opt/hermes','/opt/hermes/.venv/bin/python','/opt/unify-adapter/application-runtime/workflow.py',action],input=json.dumps(data).encode(),capture_output=True,timeout=35)
 assert (r.returncode==0)==expect,'Native helper contract failure; raw output suppressed'
 return json.loads(r.stdout)
def inspect_native(code,body):
 r=subprocess.run(['docker','exec','-i','--user','10000:10001',NATIVE,'/usr/bin/env','HERMES_HOME=/opt/data','HOME=/opt/data','PYTHONPATH=/opt/hermes','/opt/hermes/.venv/bin/python','-c',code],input=json.dumps(body).encode(),capture_output=True,timeout=35);assert r.returncode==0
 return json.loads(r.stdout)
def login(who):
 status,data,h=http(APP,'/api/login','POST',{'username':who,'password':json.loads((OUT/'customer-passwords.json').read_text())[who]},{'Origin':APP});assert status==200
 return {'Origin':APP,'Cookie':h['Set-Cookie'].split(';')[0],'X-CSRF-Token':data['csrf']}
a,b=login('alice'),login('bob');g=json.loads((OUT/'recurring-grant.json').read_text());id=g['grantId'];auth={'Authorization':'Bearer '+g['token']};flow=native('status',{'id':id});assert flow['phase']=='completed'
assert http(APP,'/internal/recurring/'+id,headers={'Authorization':'Bearer '+'x'*40})[0]==401
assert http(APP,'/api/recurring/'+id+'/revoke','POST',{},b)[0]==404
key=flow['events'][0]['key'];path='/internal/recurring/'+id+'/events/'+key
assert http(APP,path+'/cancel',headers=auth)[0]==405
assert http(APP,path,'POST',{'question':'rewrite scope'},auth)[0]==400
assert http(APP,'/internal/recurring/'+id+'/events/new-beyond-grant-budget','POST',{},auth)[0]==429
replays=[http(APP,path,'POST',{},auth)[1]['request']['id'] for _ in range(3)]
assert set(replays)=={flow['events'][0]['requestId']}
assert http(APP,'/internal/recurring/'+id,headers=auth)[1]['used']==4
assert native('event',{'id':id,'eventKey':'after-completion'})['version']==flow['version']
CHECKS.update(realCapabilityIsolation=True,foreignRevokeDenied=True,getCannotCancel=True,payloadRewriteDenied=True,serverBudgetIndependentlyEnforced=True,postCompletionReplayNoNewEffects=True)
first=json.loads((OUT/'first-result.json').read_text());expected_times={k['source']['retrievedAt'] for k in first['result']['knowledge']}
results=[]
for entry in flow['events']:
 s,r,_=http(APP,'/api/state',headers=a);assert s==200
 approw=next(x for x in r['requests'] if x['id']==entry['requestId']);assert approw['state']=='result-ready' and not approw['result']['uncertainty'] and approw['result']['knowledge']
 s,receipt,_=backend('/api/v1/application/requests/'+entry['receiptId']);assert s==200 and receipt['receipt']['phase']=='result-ready'
 n=inspect_native("import json,sys;from hermes_cli import kanban_db;k=kanban_db.connect();r=k.execute('SELECT status,result FROM tasks WHERE session_id=?',('alica-app-'+json.load(sys.stdin)['id'],)).fetchone();o=json.loads(r['result']);print(json.dumps({'done':r['status']=='done','state':o['state'],'retrievedAt':[e['retrievedAt'] for e in o['result']['evidence']]}));k.close()",{'id':entry['receiptId']})
 assert n['done'] and n['state']=='completed' and set(n['retrievedAt'])==expected_times
 results.append({'requestId':entry['requestId'],'receiptId':entry['receiptId'],'nativeEvidenceUsesGovernedKnowledge':True})
CHECKS.update(nativeOwnerConfirmsAllRecurringKnowledgeReuse=True,allRecurringResultsCertainAndGoverned=True,results=results)
# Real native dependency waiting and terminal cancellation before admission.
def create(dependency=None,future=False):
 s,g,_=http(APP,'/api/recurring','POST',{'operation':'research','question':'Quote the reservation list and introductory sentence in RFC 2606 exactly.','maxRuns':1,'minIntervalSeconds':60,'expiresInSeconds':1800},a);assert s==201
 spec={k:g[k] for k in ('grantId','token')};spec.update(intervalSeconds=60,timezone='UTC',maxRuns=1,estimatedUnitMicros=1000,maxEstimatedMicros=1000,noProgressSeconds=600)
 if dependency:spec['dependsOn']=dependency
 if future:spec['startAt']=(dt.datetime.now(dt.timezone.utc)+dt.timedelta(minutes=10)).isoformat()
 native('create',spec);return g
parent=create(future=True);child=create(parent['grantId'])
assert native('tick',{'id':child['grantId']})['phase']=='waiting_dependency'
assert not native('status',{'id':child['grantId']})['events']
assert native('cancel',{'id':parent['grantId']})['phase']=='cancelled'
assert native('tick',{'id':child['grantId']})['error']=='dependency_failed'
CHECKS.update(realNativeDependencyWaiting=True,dependencyFailureBoundedWithoutModelCall=True)
# A real event-backed child, duplicate arrival and draining cancellation.
event=create();eid=event['grantId'];payload={'id':eid,'eventKey':'stage4-replay-cancel'}
with concurrent.futures.ThreadPoolExecutor(2) as pool:list(pool.map(lambda _:native('event',payload),range(2)))
e=native('status',{'id':eid});assert len(e['events'])==1
native('event',payload);assert len(native('status',{'id':eid})['events'])==1
native('cancel',{'id':eid});deadline=time.monotonic()+120
while time.monotonic()<deadline:
 e=native('tick',{'id':eid})
 if e.get('phase') in ('cancelled','exception'):break
 time.sleep(2)
assert e['phase']=='cancelled' and e['active'] is None
CHECKS.update(realDuplicateEventHasSingleAdmission=True,realNativeCancellationSettled=True)
# Revoke consumed grants; no new effects are possible through leftover capabilities.
for grant in (g,parent,child,event):assert http(APP,'/api/recurring/'+grant['grantId']+'/revoke','POST',{},a)[0]==200
CHECKS['fixtureCapabilitiesRevoked']=True
(OUT/'recurring-closeout.json').write_text(json.dumps(CHECKS,indent=2));print(json.dumps(CHECKS))
