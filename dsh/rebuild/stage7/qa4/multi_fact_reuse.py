"""Real four-fact customer reuse regression. No injected native/store outcomes."""
import hashlib,json,subprocess,time,uuid
from qa_common import *
pw=json.loads((OUT/'customer-passwords.json').read_text());s,b,h=http(APP,'/api/login','POST',{'username':'bob','password':pw['bob']},{'Origin':APP});assert s==200
headers={'Origin':APP,'Cookie':h['Set-Cookie'].split(';')[0],'X-CSRF-Token':b['csrf']}
def ask(operation,question):
 payload={'key':str(uuid.uuid4()),'operation':operation,'question':question};s,r,_=http(APP,'/api/requests','POST',payload,headers);assert s==202
 (OUT/('reuse-regression-'+operation+'-input.json')).write_text(json.dumps({'payload':payload,'request':r}))
 end=time.monotonic()+600;row=None
 while time.monotonic()<end:
  s,state,_=http(APP,'/api/state',headers=headers);assert s==200;row=next(x for x in state['requests'] if x['id']==r['id'])
  if row['state'] in ('result-ready','rejected','cancelled'):break
  time.sleep(2)
 assert row is not None
 (OUT/('reuse-regression-'+operation+'-result.json')).write_text(json.dumps(row,indent=2))
 assert row['state']=='result-ready' and row['result']['knowledge'] and not row['result']['uncertainty'],(row['state'],row['error'])
 s,replay,_=http(APP,'/api/requests','POST',payload,headers);assert s in (200,202) and replay['id']==r['id']
 return row
def native(rid):
 assert str(uuid.UUID(rid))==rid
 code="import json,hashlib;from hermes_cli import kanban_db;c=kanban_db.connect();r=c.execute('SELECT status,result FROM tasks WHERE session_id=?',('alica-app-"+rid+"',)).fetchone();assert r;raw=r['result'];print(json.dumps({'status':r['status'],'sha256':hashlib.sha256(raw.encode()).hexdigest(),'body':json.loads(raw)}));c.close()"
 return json.loads(subprocess.check_output(['docker','exec','--user','10000:10001',CELL+'-hermes-1','env','HERMES_HOME=/opt/data','HOME=/opt/data','PYTHONPATH=/opt/hermes','/opt/hermes/.venv/bin/python','-c',code]))
first=ask('research','Find four distinct factual statements in RFC 2606: one explaining .test, one .example, one .invalid, and one .localhost. Return exactly four findings, one per domain, each with a verbatim quote from its explanatory paragraph. Do not combine these into a single finding.')
assert len(first['result']['knowledge'])==4,'Four independently governed facts required; do not manufacture the regression fixture'
control=native(first['receiptId']);assert control['status']=='done' and control['body']['state']=='completed'
(OUT/'research-positive-control.json').write_text(json.dumps({'passed':True,'receiptId':first['receiptId'],'localRequestId':first['id'],'canonicalRecordIds':[k['recordId'] for k in first['result']['knowledge']]}))
answer=ask('answer','Using the four previously learned RFC 2606 findings, explain the separate purposes of .test, .example, .invalid, and .localhost. Reuse the existing knowledge and do not fetch new evidence.')
observed=native(answer['receiptId']);assert observed['status']=='done' and observed['body']['state']=='completed'
evidence=observed['body']['result']['evidence'];assert len(evidence)==4
size=lambda x:len(json.dumps(x,separators=(',',':'),ensure_ascii=False).encode())
lower=sum(size(e) for e in evidence)+sum(size(k['source']) for k in first['result']['knowledge'])
assert lower>65536,'Must exercise the formerly oversized plan, not a smaller substitute'
assert sorted(answer['result']['knowledge'],key=lambda k:k['recordId'])==sorted(first['result']['knowledge'],key=lambda k:k['recordId']),'Original canonical identity and full provenance must survive reuse; ordering is not a contract'
assert native(first['receiptId'])==control and native(answer['receiptId'])==observed,'No native outcome rewrites'
report={'schema':'stage7-live-multifact-reuse/v1','passed':True,'researchReceiptId':first['receiptId'],'answerReceiptId':answer['receiptId'],'canonicalFacts':4,'nativeEvidenceEntries':len(evidence),'uncompactedPlanSourceBytesLowerBound':lower,'existingPlanLimitBytes':65536,'customerResultReady':True,'originalProvenanceAndRecordIdentitiesPreserved':True,'applicationReplaySameRequest':True,'nativeOutcomesUnchanged':True,'nativeResultSha256':observed['sha256'],'syntheticNativeOutcomes':False,'stage7Accepted':False}
(OUT/'multi-fact-reuse.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
