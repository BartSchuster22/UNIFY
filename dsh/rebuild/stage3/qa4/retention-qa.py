#!/usr/bin/env python3
"""Installed retention with explicitly expired timestamp fixtures, NOT elapsed-day claims.
Only expires_at/created inputs change; state, payloads, results and owner cleanup
are produced by the installed services. No direct writes to Memory or native DBs.
"""
import json,sqlite3,subprocess,time,uuid
from qa_common import *
reg=json.loads((OUT/'registration.json').read_text());r=json.loads((OUT/'bob-survivor.json').read_text());rid=str(uuid.UUID(r['receiptId']));aid=str(uuid.UUID(reg['applicationId']))
name='dsh2-stage3-qa4-postgresql-1';meta=json.loads(subprocess.check_output(['docker','inspect',name]))[0];assert meta['Config']['Labels']['com.docker.compose.project']=='dsh2-stage3-qa4'
s,e,_=backend('/api/v1/application/requests/'+rid);assert s==200 and e['receipt']['phase']=='result-ready'
# Explicit timestamp-only fixture, bounded by BOTH actual application and receipt.
sql=f"WITH prior AS MATERIALIZED (SELECT to_jsonb(r)-'expires_at' AS v FROM application_receipts r WHERE id='{rid}' AND application_id='{aid}' AND phase='result-ready') UPDATE application_receipts r SET expires_at=now()-interval '1 second' FROM prior WHERE id='{rid}' AND application_id='{aid}' RETURNING (to_jsonb(r)-'expires_at'=prior.v);"
x=subprocess.check_output(['docker','exec','-i',name,'psql','-X','-A','-t','-v','ON_ERROR_STOP=1','-U','unify_bootstrap','-d','unify'],input=sql.encode()).decode();assert x.splitlines()[0]=='t',x
report={'fixture':'timestamp-only expiration; wall clock and outcomes were not rewritten','elapsedDayClaim':False,'onlyCoreExpiryInputChanged':True}
(OUT/'retention-acceptance.json').write_text(json.dumps(report,indent=2))
deadline=time.monotonic()+180
while time.monotonic()<deadline:
 s,e,_=backend('/api/v1/application/requests/'+rid);assert s==200
 if e['receipt']['phase']=='deleted':break
 time.sleep(1)
assert e['receipt']['phase']=='deleted' and e['receipt']['payload'] is None and e['receipt']['result'] is None and e['delivery'] is None
report['automaticCoreRetentionAndOwnerErasure']=True
# Application-owned timestamp fixture; never insert a deleted state or blank result.
path=OUT/'reference-data/reference.sqlite3'
assert path.is_file(),list((OUT/'reference-data').iterdir())
with sqlite3.connect(path) as db:
 db.row_factory=sqlite3.Row
 before=dict(db.execute('SELECT * FROM requests WHERE id=? AND customer=?',(r['id'],'bob')).fetchone());assert before['state']=='result-ready'
 db.execute('UPDATE requests SET created=? WHERE id=? AND customer=?',(time.time()-86401,r['id'],'bob'))
 after=dict(db.execute('SELECT * FROM requests WHERE id=? AND customer=?',(r['id'],'bob')).fetchone())
 assert {k:v for k,v in before.items() if k!='created'}=={k:v for k,v in after.items() if k!='created'}
pw=json.loads((OUT/'customer-passwords.json').read_text());s,d,h=http(APP,'/api/login','POST',{'username':'bob','password':pw['bob']},{'Origin':APP});assert s==200
headers={'Cookie':h['Set-Cookie'].split(';',1)[0],'Origin':APP,'X-CSRF-Token':d['csrf']}
deadline=time.monotonic()+120
while time.monotonic()<deadline:
 s,d,_=http(APP,'/api/state',headers=headers);assert s==200
 row=next(z for z in d['requests'] if z['id']==r['id'])
 if row['state']=='deleted':break
 time.sleep(1)
assert row['state']=='deleted' and row['question'] is None and row['result'] is None
v=json.loads((OUT/'bob-survivor-input.json').read_text());s,replayed,_=http(APP,'/api/requests','POST',v,headers);assert s==202 and replayed['id']==r['id'] and replayed['state']=='deleted'
report.update({'automaticAppRetention':True,'sameKeyCannotResurrectErasedRequest':True,'logicalLiveStoreOnly':True,'physicalBackupErasure':False})
(OUT/'retention-acceptance.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
