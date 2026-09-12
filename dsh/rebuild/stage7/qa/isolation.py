#!/usr/bin/env python3
"""Fresh live application/customer/project negative tests; no stored outcomes edited."""
import json,subprocess
from qa_common import *
checks={}
passwords=json.loads((OUT/'customer-passwords.json').read_text())
def login(user):
 s,b,h=http(APP,'/api/login','POST',{'username':user,'password':passwords[user]},{'Origin':APP});assert s==200
 return {'Origin':APP,'Cookie':h['Set-Cookie'].split(';')[0],'X-CSRF-Token':b['csrf']}
a,b=login('alice'),login('bob');first=json.loads((OUT/'first-result.json').read_text())
s,alice,_=http(APP,'/api/state',headers=a);assert s==200
s,bob,_=http(APP,'/api/state',headers=b);assert s==200
assert first['id'] in {r['id'] for r in alice['requests']}
assert first['id'] not in {r['id'] for r in bob['requests']}
checks['customerSessionIsolation']=True
s,_,_=http(APP,'/api/state');assert s==401;checks['anonymousDenied']=True
s,_,_=http(APP,'/api/requests','POST',{'operation':'answer','question':'unauthorized fixture','clientKey':'no-csrf-qa3'},{'Origin':APP,'Cookie':a['Cookie']});assert s in (401,403);checks['csrfRequired']=True
s,_,_=http(APP,'/callback','POST',{'receiptId':first['receiptId']});assert s in (400,401,403);checks['unsignedCallbackDenied']=True
s,_,_=backend('/api/v1/application/requests/'+first['receiptId'],token='invalid-qa3-token');assert s==401;checks['invalidBackendCapabilityDenied']=True
# Use the framework's own project authority, never fabricate receipt/result rows.
code="from hermes_cli import projects_db;import json;c=projects_db.connect();p=projects_db.get_project(c,'stage7-isolation-other') or projects_db.create_project(c,name='Stage7 isolated QA project',slug='stage7-isolation-other');c.close();print(json.dumps({'created':bool(p)}))"
p=subprocess.run(['docker','exec','--user','10000:10001',CELL+'-hermes-1','env','HERMES_HOME=/opt/data','HOME=/opt/data','PYTHONPATH=/opt/hermes','/opt/hermes/.venv/bin/python','-c',code],capture_output=True,text=True,timeout=30);assert p.returncode==0
manifest={'contractVersion':'alica-application/v1','name':'Stage7 isolation second project','frameworkId':'hermes-alica','projectId':'stage7-isolation-other','subjects':['customer-a'],'operations':['answer'],'sourceUrls':['https://www.rfc-editor.org/rfc/rfc2606.txt'],'callbackUrl':APP+'/callback','retentionDays':1,'promotionPolicy':'verified-extract-v1'}
registration=OUT/'isolation-registration.json'
if registration.exists():other=json.loads(registration.read_text())
else:
 s,other,_=owner('/api/v1/applications','POST',manifest);assert s==201,(s,{k:v for k,v in other.items() if k in ('error','message','code','details')})
 registration.write_text(json.dumps(other));registration.chmod(0o600)
s,_,_=backend('/api/v1/application/requests/'+first['receiptId'],token=other['credential']['token']);assert s in (403,404)
s,_,_=backend('/api/v1/application/requests/'+first['receiptId']);assert s==200;checks['separateProjectCapabilityCannotReadReceipt']=True
for field,value in [('sourceUrls',['http://127.0.0.1/private']),('callbackUrl','https://127.0.0.1/callback')]:
 s,error,_=owner('/api/v1/applications','POST',{**manifest,'name':'Invalid egress QA fixture',field:value})
 if field=='callbackUrl':assert s==403 and error['error']['code']=='APPLICATION_DESTINATION_DENIED',(s,error)
 else:assert s in (400,422) and error.get('error'),(s,error)
 checks[field+'Denial']={'status':s,'code':error['error']['code']}
checks['privateAddressRegistrationDenied']=True
report={'schema':'stage7-live-isolation/v1','candidateReleaseSha256':json.loads((OUT/'clean-install.json').read_text())['releaseSha256'],'checks':checks,'passed':all(checks.values()),'productionAccepted':False}
(OUT/'isolation.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
