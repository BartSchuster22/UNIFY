#!/usr/bin/env python3
"""Installed admission/customer/runtime negatives. No new paid inference."""
import concurrent.futures,json,subprocess,uuid
from qa_common import *
checks={}
reg=json.loads((OUT/'registration.json').read_text());pw=json.loads((OUT/'customer-passwords.json').read_text());first=json.loads((OUT/'first-result.json').read_text())
def login(who):
 s,d,h=http(APP,'/api/login','POST',{'username':who,'password':pw[who]},{'Origin':APP});assert s==200
 return {'Cookie':h['Set-Cookie'].split(';',1)[0],'X-CSRF-Token':d['csrf'],'Origin':APP}
a=login('alice');b=login('bob')
assert http(APP,'/api/requests/'+first['id']+'/delete','POST',{},b)[0]==404
assert http(APP,'/api/requests/'+first['id']+'/retry','POST',{},b)[0]==404
assert http(APP,'/api/state',headers=b)[1]['requests']==[]
checks['crossCustomerAccessDenied']=True
payload={'contractVersion':'alica-application/v1','subject':'customer-a','operation':'research','question':'Which top-level domains does RFC 2606 reserve?'}
for key,value in {'projectId':'foreign','frameworkId':'foreign','model':'override','tools':['terminal'],'profile':'foreign','callbackUrl':'https://example.org','sourceUrls':['http://169.254.169.254/']}.items():
 s,_,_=backend('/api/v1/application/requests','POST',{**payload,key:value},'negative-'+str(uuid.uuid4()));assert s in (400,422),(key,s)
for sub in ['unregistered','customer-a/subject:customer-b']:
 s,_,_=backend('/api/v1/application/requests','POST',{**payload,'subject':sub},'negative-'+str(uuid.uuid4()));assert s in (400,403,422),(sub,s)
checks['projectFrameworkProviderToolCallbackAndSubjectOverridesDenied']=True
# Replay the EXACT existing customer-owned request over concurrent real HTTP.
original=json.loads((OUT/'first-core-receipt.json').read_text())['receipt']['payload']
key='reference:'+first['id']
def replay(_):return backend('/api/v1/application/requests','POST',original,key)
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:out=list(pool.map(replay,range(12)))
assert all(s in (200,202) and e['replayed'] and e['receipt']['id']==first['receiptId'] for s,e,_ in out)
s,e,_=backend('/api/v1/application/requests','POST',{**original,'question':'Changed idempotent payload'},key);assert s==409
checks['concurrentDurableReplayAndChangedPayloadDenied']=True
for name in ['hermes','unify-core','memory-v4']:
 d=json.loads(subprocess.check_output(['docker','inspect','dsh2-stage7-qa3-'+name+'-1']))[0]
 assert d['Config']['Labels']['com.docker.compose.project']=='dsh2-stage7-qa3'
 h=d['HostConfig'];assert h['ReadonlyRootfs'] and 'ALL' in h['CapDrop'] and any('no-new-privileges' in x for x in h['SecurityOpt'])
 assert h['Memory']>0 and h['PidsLimit']>0 and not h['Privileged']
checks['installedRuntimeIsolationGuards']=True
(OUT/'negative-acceptance.json').write_text(json.dumps(checks,indent=2));print(json.dumps(checks))
