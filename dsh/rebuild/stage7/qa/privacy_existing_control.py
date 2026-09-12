#!/usr/bin/env python3
"""Installed native cancellation and scoped live-store erasure; no inferred backup erasure."""
import json,subprocess,time,uuid
from qa_common import *
checks={}
def save(k,v=True):
 checks[k]=v;(OUT/'privacy-acceptance.json').write_text(json.dumps(checks,indent=2));print(json.dumps({k:v}),flush=True)
name='dsh2-stage7-qa3-hermes-1'
meta=json.loads(subprocess.check_output(['docker','inspect',name]))[0];assert meta['Config']['Labels']['com.docker.compose.project']=='dsh2-stage7-qa3'
def native(rid):
 assert str(uuid.UUID(rid))==rid
 code="import json;from hermes_cli import kanban_db;from hermes_state import SessionDB;k=kanban_db.connect();rows=k.execute('SELECT id,status,body,result FROM tasks WHERE session_id=?',('alica-app-"+rid+"',)).fetchall();out=[]\nfor r in rows:\n m=json.loads(r['body']);o=json.loads(r['result']) if r['result'] else {};out.append({'status':r['status'],'resultState':o.get('state'),'ownerPid':m.get('owner',{}).get('pid'),'evidenceTimes':[e['retrievedAt'] for e in o.get('result',{}).get('evidence',[])]})\ndb=SessionDB();print(json.dumps({'tasks':out,'sessionExists':db.get_session('alica-app-"+rid+"') is not None}));db.close();k.close()"
 return json.loads(subprocess.check_output(['docker','exec','--user','10000:10001',name,'/opt/hermes/.venv/bin/python','-c',code]))
checks=json.loads((OUT/'privacy-acceptance.json').read_text())
assert all(checks.get(k) is True for k in ('nativeOwnerConfirmsKnowledgeReuse','actualNativeWorkerObservedRunning','runningCancellationSettledByNativeOwner','cancelledNativeAndCoreErasure'))
first=json.loads((OUT/'first-result.json').read_text())
pw=json.loads((OUT/'customer-passwords.json').read_text())
def login(name):
 s,d,h=http(APP,'/api/login','POST',{'username':name,'password':pw[name]},{'Origin':APP});assert s==200
 return {'Cookie':h['Set-Cookie'].split(';',1)[0],'X-CSRF-Token':d['csrf'],'Origin':APP}
a=login('alice');b=login('bob')
# Governed positive control created independently on this same candidate.
bob_id=json.loads((OUT/'research-positive-control.json').read_text())['receiptId']
status,bob_core,_=backend('/api/v1/application/requests/'+bob_id)
assert status==200 and bob_core['receipt']['payload']['subject']=='customer-b'
assert bob_core['receipt']['phase']=='result-ready' and bob_core['receipt']['result']['knowledge']
assert {k['recordId'] for k in bob_core['receipt']['result']['knowledge']}.isdisjoint(k['recordId'] for k in first['result']['knowledge'])
s,before,_=http(APP,'/api/state',headers=b);assert s==200
save('sameCandidateExistingGovernedControl');save('realOtherCustomerKnowledgeIsolated')
s,rows,_=http(APP,'/api/state',headers=a);assert s==200
ids=[r['receiptId'] for r in rows['requests']];assert all(ids)
s,e,_=http(APP,'/api/delete','POST',{},a);assert s==202 and e['complete'] is False
assert http(APP,'/api/requests','POST',{'key':str(uuid.uuid4()),'operation':'answer','question':'Should be blocked during account deletion'},a)[0]==409
save('newAdmissionsBlockedDuringAccountDeletion')
deadline=time.monotonic()+240
while time.monotonic()<deadline:
 s,d,_=http(APP,'/api/state',headers=a);assert s==200
 if d['deletionComplete']:break
 time.sleep(1)
assert d['deletionComplete'] and all(r['state']=='deleted' and r['result'] is None and r['question'] is None for r in d['requests'])
for id in ids:
 s,e,_=backend('/api/v1/application/requests/'+id);assert s==200 and e['receipt']['phase']=='deleted' and e['delivery'] is None
 assert e['receipt']['payload'] is None and e['receipt']['result'] is None and e['receipt']['native_reference'] is None
 assert native(id)=={'tasks':[],'sessionExists':False}
s,after,_=http(APP,'/api/state',headers=b);assert s==200 and after==before
assert backend('/api/v1/application/requests/'+bob_id)[1]==bob_core
save('coordinatedAppCoreMemoryNativeLiveStoreErasure');save('otherCustomerUnaffected')
s,export,_=http(APP,'/api/export',headers=a);assert s==200 and export['coreExports']==[] and export['backupExpiry']=='operator-managed, not verified'
save('postDeletionExportScrubbedAndBackupLimitsExplicit')
print(json.dumps({'passed':True,'checks':checks,'physicalBackupErasure':False,'elapsedDayRetentionTest':False}))
