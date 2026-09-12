#!/usr/bin/env python3
"""Real elapsed native Cron acceptance. No clock, native outcome or app row rewrites."""
import hashlib,json,os,subprocess,time
from qa_common import *
CELL='dsh2-stage7-qa3';NATIVE=CELL+'-hermes-1';REFERENCE='dsh7-reference-qa3'
EXPECTED='sha256:96ed2f016fb159f48058f668a3baccd2d8154644dfd3519b9e683c4e7c636bd9'
row=json.loads(subprocess.check_output(['docker','inspect',NATIVE]))[0]
assert row['Config']['Labels']['com.docker.compose.project']==CELL and row['Image']==EXPECTED

def native(action,data):
 r=subprocess.run(['docker','exec','-i','--user','10000:10001',NATIVE,'/usr/bin/env','HERMES_HOME=/opt/data','HOME=/opt/data','PYTHONPATH=/opt/hermes','/opt/hermes/.venv/bin/python','/opt/unify-adapter/application-runtime/workflow.py',action],input=json.dumps(data).encode(),capture_output=True,timeout=40)
 assert r.returncode==0,'Native command failed; raw output suppressed'
 return json.loads(r.stdout)
def execute(code,body=None):
 r=subprocess.run(['docker','exec','-i','--user','10000:10001',NATIVE,'/usr/bin/env','HERMES_HOME=/opt/data','HOME=/opt/data','PYTHONPATH=/opt/hermes','/opt/hermes/.venv/bin/python','-c',code],input=json.dumps(body).encode() if body is not None else b'',capture_output=True,timeout=40)
 assert r.returncode==0,'Native helper failed; raw output suppressed'
 return json.loads(r.stdout) if r.stdout.strip() else None
passwords=json.loads((OUT/'customer-passwords.json').read_text())
s,b,h=http(APP,'/api/login','POST',{'username':'alice','password':passwords['alice']},{'Origin':APP});assert s==200
headers={'Origin':APP,'Cookie':h['Set-Cookie'].split(';')[0],'X-CSRF-Token':b['csrf']}
# This is the application operator's endpoint trust binding, not model-visible data.
policy={'origin':APP,'address':'10.84.0.10'}
execute("from pathlib import Path;import json,sys;d=json.load(sys.stdin);home=Path('/opt/data');\nfor name,value in d.items():\n p=home/name\n if p.exists():assert p.read_text()==value\n else:p.write_text(value);p.chmod(0o600)\nprint('{}')",{'workflow-policy.json':json.dumps(policy),'workflow-ca.crt':(ROOT/'secrets/framework-ca.crt').read_text()})
path=OUT/'recurring-grant.json';assert not path.exists(),'Fresh elapsed acceptance only'
s,grant,_=http(APP,'/api/recurring','POST',{'operation':'answer','question':'What does RFC 2606 say about example domain names?','maxRuns':4,'minIntervalSeconds':60,'expiresInSeconds':3600},headers);assert s==201,(s,grant)
path.write_text(json.dumps(grant));path.chmod(0o600)
spec={k:grant[k] for k in ('grantId','token')};spec.update(intervalSeconds=60,timezone='Europe/Madrid',maxRuns=4,estimatedUnitMicros=1000,maxEstimatedMicros=4000,noProgressSeconds=600)
start_wall=time.time();start_mono=time.monotonic();m=native('create',spec);id=m['id']
(OUT/'recurring-start.json').write_text(json.dumps({'id':id,'startedAt':start_wall,'cronId':m['cronId']}))
print(json.dumps({'nativeCronCreated':True,'id':id,'cronId':m['cronId'],'realElapsedRunStarted':True}),flush=True)
restarted=False;version=-1;deadline=time.monotonic()+1000
while time.monotonic()<deadline:
 m=native('status',{'id':id})
 if m['version']!=version:
  print(json.dumps({'elapsed':round(time.monotonic()-start_mono,2),'phase':m['phase'],'version':m['version'],'events':len(m['events']),'error':m.get('error')}),flush=True);version=m['version']
 if m['phase']=='exception':raise AssertionError('Real workflow exception: '+str(m.get('error')))
 if m['active'] and not restarted:
  s,state,_=http(APP,'/internal/recurring/'+id+'/events/'+m['active'],headers={'Authorization':'Bearer '+grant['token']});assert s==200
  if state['request'] and state['request']['state']=='result-ready':
   checkpoint={'version':m['version'],'active':m['active'],'requestId':state['request']['id'],'phase':m['phase']}
   subprocess.run(['docker','restart','--time','10',NATIVE],capture_output=True,check=True,timeout=60)
   recovered=native('status',{'id':id});assert recovered['active']==checkpoint['active'] and recovered['version']>=checkpoint['version']
   restarted=True;(OUT/'recurring-restart.json').write_text(json.dumps({'nativeRestartPreservedCheckpoint':True,'checkpoint':checkpoint,'afterVersion':recovered['version']}))
   print(json.dumps({'nativeRestartPreservedCheckpoint':True}),flush=True)
 if m['phase']=='completed':break
 time.sleep(5)
else:raise AssertionError('Real native recurrence did not complete within bounded deadline')
elapsed=time.monotonic()-start_mono
assert elapsed>=360,'Measured recurring execution was shorter than acceptance window'
assert restarted and len(m['events'])==4 and all(e.get('completedAt') for e in m['events'])
assert len({e['requestId'] for e in m['events']})==4 and len({e['receiptId'] for e in m['events']})==4
ledger=[]
for e in m['events']:
 s,r,_=http(APP,'/internal/recurring/'+id+'/events/'+e['key'],headers={'Authorization':'Bearer '+grant['token']});assert s==200 and r['request']['id']==e['requestId'] and r['request']['state']=='result-ready'
 s,r,_=backend('/api/v1/application/requests/'+e['receiptId']);assert s==200
 ledger.append(r)
# Read-only authoritative stores, not inferred from HTTP success alone.
authority=execute("import json,sys;from pathlib import Path;from cron import jobs;sys.path.insert(0,'/opt/unify-adapter/application-runtime');import workflow;c=workflow.Coordinator();m=json.loads(c.task(json.load(sys.stdin)['id']).body);j=jobs.get_job(m['cronId']);print(json.dumps({'nativeTaskDone':c.task(m['id']).status=='done','nativeCronPaused':not j['enabled'],'nativeCronRunCount':j['repeat']['completed'],'nativeCapabilityRemoved':not(Path('/opt/data/workflow-secrets')/m['id']).exists()}));c.close()",{'id':id})
assert authority['nativeTaskDone'] and authority['nativeCronPaused'] and authority['nativeCapabilityRemoved']
assert authority['nativeCronRunCount']>=3
(OUT/'recurring-native-final.json').write_text(json.dumps(m,indent=2));(OUT/'recurring-core-receipts.json').write_text(json.dumps(ledger,indent=2))
report={'passed':True,'clockOrOutcomeEdits':False,'elapsedSeconds':round(time.monotonic()-start_mono,3),'completionElapsedSeconds':round(elapsed,3),'wallElapsedSeconds':round(time.time()-start_wall,3),'successfulRecurringResults':4,'uniqueAppRequests':4,'uniqueCoreReceipts':4,'nativeRestartPreservedCheckpoint':restarted,'nativeAuthority':authority,'missedSlotsCoalesced':m['missedCoalesced'],'estimatedReservedMicros':m['estimatedReservedMicros'],'providerCost':m['providerCost'],'providerCostIsMeasured':False,'realModelInference':True,'dayOrWeekSoakClaim':False}
# Browser sessions can expire during the real elapsed-time run; reauthenticate for final reads.
s,d,h=http(APP,'/api/login','POST',{'username':'alice','password':json.loads((OUT/'customer-passwords.json').read_text())['alice']},{'Origin':APP});assert s==200
headers={'Origin':APP,'Cookie':h['Set-Cookie'].split(';')[0],'X-CSRF-Token':d['csrf']}
s,projection,_=http(APP,'/api/state',headers=headers);assert s==200
owned={r['id']:r for r in projection['requests']}
assert all(owned[e['requestId']]['state']=='result-ready' and not owned[e['requestId']]['result']['uncertainty'] and owned[e['requestId']]['result']['knowledge'] for e in m['events']),'Delivery alone is NOT governed learning acceptance'
report['allResultsCertainAndGoverned']=True
(OUT/'recurring-soak.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)
