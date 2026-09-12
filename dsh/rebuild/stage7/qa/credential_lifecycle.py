"""Fresh credentials only: real expiry/revocation; leave the active app credential untouched."""
import json,time
from qa_common import *
reg=json.loads((OUT/'registration.json').read_text());rid=json.loads((OUT/'first-result.json').read_text())['receiptId'];created=[];checks={};started=time.monotonic()
def mint(ttl):
 s,d,_=owner('/api/v1/applications/'+reg['applicationId']+'/credentials','POST',{'ttlSeconds':ttl});assert s==201;created.append(d['id']);return d
def use(token,extra=None):return http(CORE,'/api/v1/application/requests/'+rid,headers={'Authorization':'Bearer '+token,**(extra or {})})
try:
 short=mint(60);revocable=mint(600)
 assert use(short['token'])[0]==200 and use(revocable['token'])[0]==200;checks['twoFreshScopedCredentialsWork']=True
 assert use(revocable['token'],{'Origin':APP})[0]==403;assert use(revocable['token'],{'Cookie':'untrusted=1'})[0]==403;checks['BrowserUseDenied']=True
 s,_,_=owner('/api/v1/applications/'+reg['applicationId']+'/credentials/'+revocable['id'],'DELETE');assert s==204
 assert use(revocable['token'])[0]==401 and backend('/api/v1/application/requests/'+rid)[0]==200;checks['revocationEffectiveWithoutRevokingActiveCredential']=True
 deadline=time.monotonic()+80
 while time.monotonic()<deadline:
  s,_,_=use(short['token'])
  if s==401:break
  assert s==200;time.sleep(2)
 else:raise AssertionError('Actual expiry not enforced within bounded window')
 assert time.monotonic()-started>=55 and backend('/api/v1/application/requests/'+rid)[0]==200
 checks['realElapsedCredentialExpiry']=True;checks['elapsedSeconds']=round(time.monotonic()-started,3)
finally:
 for id in created:
  status,_,_=owner('/api/v1/applications/'+reg['applicationId']+'/credentials/'+id,'DELETE');assert status in (204,404)
checks['createdCredentialsRevoked']=True;checks['passed']=True
(OUT/'credential-lifecycle.json').write_text(json.dumps(checks,indent=2));print(json.dumps(checks))
