#!/usr/bin/env python3
"""Real installed QA3 acceptance. Every request has a persisted key; reruns never resubmit inference."""
import hashlib,hmac,json,sqlite3,subprocess,time,uuid
from qa_common import *
REPORT=OUT/'extended-acceptance.json';checks=json.loads(REPORT.read_text()) if REPORT.exists() else {}
def passed(k,v=True):
 checks[k]=v;REPORT.write_text(json.dumps(checks,indent=2));print(json.dumps({k:v}),flush=True)
pw=json.loads((OUT/'customer-passwords.json').read_text())
s,d,h=http(APP,'/api/login','POST',{'username':'alice','password':pw['alice']},{'Origin':APP});assert s==200
headers={'Cookie':h['Set-Cookie'].split(';',1)[0],'X-CSRF-Token':d['csrf'],'Origin':APP}
def state(id):
 s,d,_=http(APP,'/api/state',headers=headers);assert s==200
 return next(r for r in d['requests'] if r['id']==id)
def submit(label,op,q,corrects=None):
 p=OUT/(label+'-input.json')
 if p.exists():v=json.loads(p.read_text());assert v['operation']==op and v['question']==q
 else:
  v={'key':str(uuid.uuid4()),'operation':op,'question':q,**({'corrects':corrects} if corrects else {})};p.write_text(json.dumps(v))
 s,r,_=http(APP,'/api/requests','POST',v,headers);assert s==202,(s,r)
 (OUT/(label+'-request.json')).write_text(json.dumps(r));return r

def wait(r,label,target='result-ready',timeout=240):
 until=time.monotonic()+timeout
 while time.monotonic()<until:
  row=state(r['id'])
  if row['state']==target:break
  assert row['state'] not in ('rejected','cancelled','deleted'),(label,row['state'],row['error'])
  time.sleep(1)
 assert row['state']==target,(label,row['state'],row['error'])
 (OUT/(label+'-result.json')).write_text(json.dumps(row,indent=2));return row
first=json.loads((OUT/'first-result.json').read_text());quote=first['result']['knowledge'][0]['quote']
s,envelope,_=backend('/api/v1/application/requests/'+first['receiptId']);assert s==200
reg=json.loads((OUT/'registration.json').read_text());delivery=envelope['delivery'];assert delivery['state']=='delivered'
body={'contractVersion':'alica-application/v1','deliveryId':delivery['id'],'applicationId':reg['applicationId'],'receiptId':first['receiptId'],'subject':envelope['receipt']['payload']['subject'],'result':envelope['receipt']['result']}
def callback(b,valid=True):
 raw=json.dumps(b,separators=(',',':'),ensure_ascii=False).encode();stamp=str(int(time.time()));sig=hmac.new(reg['callbackSigningSecret'].encode(),stamp.encode()+b'.'+b['deliveryId'].encode()+b'.'+raw,hashlib.sha256).hexdigest()
 return http(APP,'/callback','POST',headers={'Content-Type':'application/json','x-alica-delivery':b['deliveryId'],'x-alica-timestamp':stamp,'x-alica-signature':sig if valid else '0'*64},raw=raw)
assert callback(body,False)[0]==401
assert callback(body)[0]==200
changed=json.loads(json.dumps(body));changed['result']['answer']='Explicit adversarial callback fixture; must never replace a real answer.'
assert callback(changed)[0]==409
assert state(first['id'])['result']==first['result'];passed('realCallbackReplayAndTamperProtection')
q='Which four top-level domain names does RFC 2606 reserve? Return this complete reservation passage byte-for-byte, preserving all whitespace: '+quote
reuse=submit('reuse','answer',q)
# The first restart probe sampled this fast answer after delivery; it was
# inconclusive, not a product failure. Keep its receipt and never rerun it.
reuse=wait(reuse,'reuse');assert reuse['result']['knowledge'] and not reuse['result']['uncertainty']
assert {k['recordId'] for k in reuse['result']['knowledge']} <= {k['recordId'] for k in first['result']['knowledge']}
passed('canonicalKnowledgeReuse')
refresh=wait(submit('refresh','refresh',q),'refresh');assert refresh['result']['knowledge'] and not refresh['result']['uncertainty']
assert refresh['result']['knowledge'][0]['recordId'] != first['result']['knowledge'][0]['recordId']
assert refresh['result']['knowledge'][0]['source']['retrievedAt']>first['result']['knowledge'][0]['source']['retrievedAt'];passed('freshRetrievalAndCanonicalSupersession')
correction=wait(submit('correction','correction',q,refresh['id']),'correction');assert correction['result']['knowledge'] and not correction['result']['uncertainty']
assert correction['result']['knowledge'][0]['recordId']!=refresh['result']['knowledge'][0]['recordId'];passed('conservativeExactQuoteCorrectionSupersession')
if 'restartRecoveryAndDeliveryRetry' not in checks:
 fault=submit('callback-recovery','research',q)
 assert fault['state']=='pending','Fault fixture must be new; do not replay a settled request'
 ref=json.loads(subprocess.check_output(['docker','inspect','dsh3-reference-qa3']))[0]
 assert ref['Id']==(OUT/'reference-container-id').read_text() and ref['Config']['Labels']['com.alica.stage3.reference']=='qa3'
 try:
  subprocess.run(['docker','stop','--time','1',ref['Id']],check=True,capture_output=True)
  # Resolve admission uncertainty using the EXACT app-owned transport key and
  # payload. This is a real idempotent transport retry, never a new inference key.
  payload={'contractVersion':'alica-application/v1','subject':'customer-a','operation':'research','question':q}
  s,e,_=backend('/api/v1/application/requests','POST',payload,'reference:'+fault['id']);assert s in (200,202),(s,e)
  rid=e['receipt']['id'];deadline=time.monotonic()+220
  while time.monotonic()<deadline:
   s,e,_=backend('/api/v1/application/requests/'+rid);assert s==200
   if e['receipt']['phase']=='result-ready' and e['delivery']['attempt']>=1 and e['delivery']['state']=='pending':break
   assert e['receipt']['phase'] not in ('rejected','cancelled'),e['receipt']['phase'];time.sleep(1)
  assert e['receipt']['phase']=='result-ready' and e['delivery']['state']=='pending'
  original_ref=e['receipt']['native_reference'];original_delivery=e['delivery']['id']
 finally:subprocess.run(['docker','start',ref['Id']],check=True,capture_output=True)
 deadline=time.monotonic()+180
 while time.monotonic()<deadline:
  s,e,_=backend('/api/v1/application/requests/'+rid);assert s==200
  if e['delivery']['state']=='delivered':break
  time.sleep(1)
 assert e['delivery']['state']=='delivered' and e['delivery']['attempt']>=2 and e['delivery']['id']==original_delivery and e['receipt']['native_reference']==original_ref
 recovered=wait(fault,'callback-recovery');assert recovered['receiptId']==rid
 passed('restartRecoveryAndDeliveryRetry',{'attempts':e['delivery']['attempt'],'sameDeliveryId':True,'sameNativeReference':True,'sameAppOwnedAdmissionKey':True})
s,export,_=http(APP,'/api/export',headers=headers);assert s==200 and export['coreExports'] and export['backupExpiry']=='operator-managed, not verified'
(OUT/'customer-export.json').write_text(json.dumps(export,indent=2));passed('customerAndCoreExport')
print(json.dumps({'completed':list(checks),'privacyAndRunningCancellation':'separate acceptance; not claimed'}))
