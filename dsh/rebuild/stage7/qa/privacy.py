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
reuse=json.loads((OUT/'reuse-result.json').read_text());times=native(reuse['receiptId'])['tasks'][0]['evidenceTimes'];first=json.loads((OUT/'first-result.json').read_text());assert times and set(times)=={e['source']['retrievedAt'] for e in first['result']['knowledge']};save('nativeOwnerConfirmsKnowledgeReuse')
p=OUT/'cancel-input.json'
if p.exists():payload=json.loads(p.read_text())
else:
 payload={'contractVersion':'alica-application/v1','subject':'customer-b','operation':'research','question':'Explain the full RFC 2606 rationale for reserving top-level DNS names and quote the complete reservation list exactly, including its introductory paragraph. Discuss the testing and documentation context.'};p.write_text(json.dumps(payload))
s,e,_=backend('/api/v1/application/requests','POST',payload,'stage7-native-cancel-once');assert s in (200,202)
rid=e['receipt']['id'];(OUT/'cancel-receipt-id').write_text(rid)
deadline=time.monotonic()+45
while time.monotonic()<deadline:
 n=native(rid)
 if n['tasks'] and n['tasks'][0]['status']=='blocked' and n['tasks'][0]['ownerPid']:break
 assert not n['tasks'] or n['tasks'][0]['status']!='done','Do not replay already-settled cancellation fixture';time.sleep(0.2)
assert n['tasks'] and n['tasks'][0]['status']=='blocked';save('actualNativeWorkerObservedRunning')
s,e,_=backend('/api/v1/application/requests/'+rid+'/cancel','POST',{});assert s in (200,202)
deadline=time.monotonic()+60
while time.monotonic()<deadline:
 s,e,_=backend('/api/v1/application/requests/'+rid);assert s==200
 if e['receipt']['phase']=='cancelled':break
 time.sleep(1)
assert e['receipt']['phase']=='cancelled' and e['receipt']['result'] is None
n=native(rid);assert n['tasks'][0]['resultState']=='cancelled';save('runningCancellationSettledByNativeOwner')
s,e,_=backend('/api/v1/application/requests/'+rid,'DELETE');assert s in (200,202)
deadline=time.monotonic()+60
while time.monotonic()<deadline:
 s,e,_=backend('/api/v1/application/requests/'+rid)
 if e['receipt']['phase']=='deleted':break
 time.sleep(1)
assert e['receipt']['phase']=='deleted' and e['receipt']['payload'] is None and e['receipt']['native_reference'] is None
assert native(rid)=={'tasks':[],'sessionExists':False};save('cancelledNativeAndCoreErasure')
pw=json.loads((OUT/'customer-passwords.json').read_text())
def login(name):
 s,d,h=http(APP,'/api/login','POST',{'username':name,'password':pw[name]},{'Origin':APP});assert s==200
 return {'Cookie':h['Set-Cookie'].split(';',1)[0],'X-CSRF-Token':d['csrf'],'Origin':APP}
a=login('alice');b=login('bob')
# A real other-customer result must survive Alice's entire account erasure.
p=OUT/'bob-survivor-input.json'
if p.exists():v=json.loads(p.read_text())
else:
 v={'key':str(uuid.uuid4()),'operation':'research','question':'Which four top-level domains does RFC 2606 reserve?'};p.write_text(json.dumps(v))
s,other,_=http(APP,'/api/requests','POST',v,b);assert s==202
deadline=time.monotonic()+220
while time.monotonic()<deadline:
 s,before,_=http(APP,'/api/state',headers=b);assert s==200
 other=next(r for r in before['requests'] if r['id']==other['id'])
 if other['state']=='result-ready':break
 assert other['state'] not in ('rejected','cancelled','deleted'),other;time.sleep(1)
assert other['state']=='result-ready' and other['result']['knowledge']
assert {k['recordId'] for k in other['result']['knowledge']}.isdisjoint(k['recordId'] for k in first['result']['knowledge'])
(OUT/'bob-survivor.json').write_text(json.dumps(other));save('realOtherCustomerKnowledgeIsolated')
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
save('coordinatedAppCoreMemoryNativeLiveStoreErasure');save('otherCustomerUnaffected')
s,export,_=http(APP,'/api/export',headers=a);assert s==200 and export['coreExports']==[] and export['backupExpiry']=='operator-managed, not verified'
save('postDeletionExportScrubbedAndBackupLimitsExplicit')
print(json.dumps({'passed':True,'checks':checks,'physicalBackupErasure':False,'elapsedDayRetentionTest':False}))
