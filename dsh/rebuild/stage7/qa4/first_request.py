#!/usr/bin/env python3
"""First real customer request through independent app -> Core -> Hermes -> MemoryV4."""
import json,time,uuid
from qa_common import *
checks={};passwords=json.loads((OUT/'customer-passwords.json').read_text())
def login(name):
 status,data,h=http(APP,'/api/login','POST',{'username':name,'password':passwords[name]},{'Origin':APP});assert status==200,(status,data)
 return {'Cookie':h['Set-Cookie'].split(';',1)[0],'X-CSRF-Token':data['csrf'],'Origin':APP}
alice=login('alice');bob=login('bob');checks['independentCustomerLogin']=True
assert http(APP,'/api/state')[0]==401
assert http(APP,'/api/requests','POST',{'key':str(uuid.uuid4()),'operation':'answer','question':'Test'},{'Cookie':alice['Cookie'],'Origin':APP})[0]==403
checks['anonymousAndMissingCsrfDenied']=True
request={'key':'a6f24287-22ed-4a30-96a5-fba18e27d985','operation':'research','question':'What does RFC 2606 say about .test, .example, .invalid and .localhost? Quote the full reservation list and its introductory sentence verbatim.'}
s,r,_=http(APP,'/api/requests','POST',request,alice);assert s==202,(s,r)
checks['localRequestId']=r['id'];(OUT/'first-request.json').write_text(json.dumps(r))
assert http(APP,'/api/requests','POST',request,alice)[1]['id']==r['id'];checks['appIdempotency']=True
assert not http(APP,'/api/state',headers=bob)[1]['requests'];checks['customerIsolation']=True
start=time.monotonic();last=None;row=None;receipt=None
while time.monotonic()-start<240:
 s,state,_=http(APP,'/api/state',headers=alice);assert s==200
 row=next(x for x in state['requests'] if x['id']==r['id'])
 if row['state']!=last:print(json.dumps({'state':row['state'],'error':row['error'],'receiptId':row['receiptId']}),flush=True);last=row['state']
 if row['receiptId']:
  rs,receipt,_=backend('/api/v1/application/requests/'+row['receiptId']);assert rs==200
  (OUT/'first-core-receipt.json').write_text(json.dumps(receipt,indent=2))
 if row['state'] in ('result-ready','rejected','cancelled'):break
 time.sleep(1)
assert row is not None and receipt is not None,'No native receipt observed'
(OUT/'first-result.json').write_text(json.dumps(row,indent=2));checks['finalState']=row['state'];checks['elapsedSeconds']=round(time.monotonic()-start,2)
assert row['state']=='result-ready',(row['state'],row['error'])
assert row['result'] and row['result']['answer'] and row['result']['knowledge'] and not row['result']['uncertainty'];checks['realEndToEndResult']=True
checks['result']=row['result'];checks['receiptId']=row['receiptId'];checks['delivery']=receipt['delivery']
(OUT/'first-acceptance.json').write_text(json.dumps(checks,indent=2));print(json.dumps({k:v for k,v in checks.items() if k!='result'}))
