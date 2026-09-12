"""Verify the same settled QA4 receipts after removing an invalid ordering assertion."""
import hashlib,json,subprocess,uuid
from qa_common import *
first=json.loads((OUT/'reuse-regression-research-result.json').read_text());answer=json.loads((OUT/'reuse-regression-answer-result.json').read_text())
pw=json.loads((OUT/'customer-passwords.json').read_text());s,b,h=http(APP,'/api/login','POST',{'username':'bob','password':pw['bob']},{'Origin':APP});assert s==200
headers={'Origin':APP,'Cookie':h['Set-Cookie'].split(';')[0],'X-CSRF-Token':b['csrf']}
def native(rid):
 assert str(uuid.UUID(rid))==rid
 code="import json,hashlib;from hermes_cli import kanban_db;c=kanban_db.connect();r=c.execute('SELECT status,result FROM tasks WHERE session_id=?',('alica-app-"+rid+"',)).fetchone();assert r;raw=r['result'];print(json.dumps({'status':r['status'],'sha256':hashlib.sha256(raw.encode()).hexdigest(),'body':json.loads(raw)}));c.close()"
 return json.loads(subprocess.check_output(['docker','exec','--user','10000:10001',CELL+'-hermes-1','env','HERMES_HOME=/opt/data','HOME=/opt/data','PYTHONPATH=/opt/hermes','/opt/hermes/.venv/bin/python','-c',code]))
before={r['receiptId']:native(r['receiptId']) for r in (first,answer)}
for operation,saved in [('research',first),('answer',answer)]:
 fixture=json.loads((OUT/('reuse-regression-'+operation+'-input.json')).read_text());s,replay,_=http(APP,'/api/requests','POST',fixture['payload'],headers);assert s in (200,202) and replay['id']==saved['id']
 s,state,_=http(APP,'/api/state',headers=headers);assert s==200;row=next(x for x in state['requests'] if x['id']==saved['id']);assert row['state']=='result-ready' and row['receiptId']==saved['receiptId'] and row['result']==saved['result']
 assert not row['result']['uncertainty'] and len(row['result']['knowledge'])==4
 s,body,_=backend('/api/v1/application/requests/'+saved['receiptId']);assert s==200;receipt=body['receipt'];assert receipt['phase']=='result-ready' and receipt['result']==saved['result']
assert sorted(first['result']['knowledge'],key=lambda k:k['recordId'])==sorted(answer['result']['knowledge'],key=lambda k:k['recordId'])
assert len({k['recordId'] for k in first['result']['knowledge']})==4
for rid,n in before.items():assert n['status']=='done' and n['body']['state']=='completed' and native(rid)==n
observed=before[answer['receiptId']];evidence=observed['body']['result']['evidence'];assert len(evidence)==4
size=lambda x:len(json.dumps(x,separators=(',',':'),ensure_ascii=False).encode());lower=sum(size(e) for e in evidence)+sum(size(k['source']) for k in first['result']['knowledge']);assert lower>65536
report={'schema':'stage7-live-multifact-reuse/v1','passed':True,'researchReceiptId':first['receiptId'],'answerReceiptId':answer['receiptId'],'canonicalFacts':4,'nativeEvidenceEntries':4,'uncompactedPlanSourceBytesLowerBound':lower,'existingPlanLimitBytes':65536,'customerAndCoreResultsReady':True,'originalCompleteRecordsPreservedById':True,'applicationReplaySameRequests':True,'nativeOutcomesUnchangedAcrossReplay':True,'nativeResultSha256':observed['sha256'],'nativeOrBusinessOutcomeEdits':False,'resolves':'Original harness wrongly required record array ordering; no record fields differ','originalFailureRetained':True,'stage7Accepted':False}
(OUT/'multi-fact-reuse.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
