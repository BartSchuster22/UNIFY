#!/usr/bin/env python3
"""Supported IdP API provisioning/deletion of one disposable DSH browser identity."""
import argparse,importlib.util,json,os,secrets,uuid
from pathlib import Path
s=importlib.util.spec_from_file_location('prepare',Path(__file__).with_name('prepare-dsh-maintenance.py'));assert s and s.loader
P=importlib.util.module_from_spec(s);s.loader.exec_module(P)
STATE=Path('/home/herman/.config/dsh-maintenance-recovery/qa-browser.json')
CODE=r'''import json,sys,subprocess,urllib.request,urllib.parse
from pathlib import Path
q=json.load(sys.stdin);r=json.loads(subprocess.check_output(['docker','inspect','dsh2-internal-onboarding1-keycloak-1']))[0]
assert r['Config']['Labels']['com.alica.stage2']=='dsh2-internal-onboarding1'
ip=next(n['IPAddress'] for n in r['NetworkSettings']['Networks'].values() if n.get('IPAddress'));base='http://'+ip+':8080/identity'
password=Path('/opt/dsh2-internal-onboarding1/secrets/keycloak-admin-password').read_text().strip()
body=urllib.parse.urlencode({'grant_type':'password','client_id':'admin-cli','username':'recovery-admin','password':password}).encode()
with urllib.request.urlopen(urllib.request.Request(base+'/realms/master/protocol/openid-connect/token',data=body),timeout=20) as response:token=json.load(response)['access_token']
def api(method,path,body=None):
 request=urllib.request.Request(base+'/admin/realms/alica'+path,data=json.dumps(body).encode() if body is not None else None,method=method,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
 with urllib.request.urlopen(request,timeout=20) as response:
  raw=response.read();return (json.loads(raw) if raw else None,response.headers.get('Location'))
assert q['username'].startswith('qa-maintenance-') and len(q['username'])==len('qa-maintenance-')+32
if q['action']=='create':
 assert not api('GET','/users?exact=true&username='+q['username'])[0]
 _,location=api('POST','/users',{'username':q['username'],'enabled':True,'firstName':'Disposable','lastName':'Maintenance QA','email':q['username']+'@example.invalid','emailVerified':True,'requiredActions':[],'credentials':[{'type':'password','value':q['password'],'temporary':False}]})
 uid=location.rsplit('/',1)[-1];client=api('GET','/clients?clientId=dsh-core')[0];assert len(client)==1;cid=client[0]['id']
 role=api('GET','/clients/'+cid+'/roles/dsh-owner')[0];api('POST','/users/'+uid+'/role-mappings/clients/'+cid,[role])
 print(json.dumps({'id':uid,'username':q['username'],'role':'dsh-owner','ownerModified':False}))
else:
 if not q.get('id'):
  users=api('GET','/users?exact=true&username='+q['username'])[0]
  if not users:print(json.dumps({'absent':True}));sys.exit(0)
  assert len(users)==1;q['id']=users[0]['id']
 user=api('GET','/users/'+q['id'])[0];assert user['username']==q['username'];api('POST','/users/'+q['id']+'/logout');api('DELETE','/users/'+q['id']);assert not api('GET','/users?exact=true&username='+q['username'])[0];print(json.dumps({'deleted':q['id'],'ownerModified':False}))
'''
def main():
 a=argparse.ArgumentParser();a.add_argument('action',choices=['create','delete']);args=a.parse_args();os.umask(0o077)
 if args.action=='create':
  assert not STATE.exists();q={'action':'create','username':'qa-maintenance-'+uuid.uuid4().hex,'password':secrets.token_urlsafe(36)}
  STATE.write_text(json.dumps(q))
  result=json.loads(P.remote('dsh',CODE,json.dumps(q)));q.update(result);STATE.write_text(json.dumps(q));print(json.dumps(result))
 else:
  q=json.loads(STATE.read_text());q['action']='delete';print(P.remote('dsh',CODE,json.dumps(q)));STATE.unlink()
if __name__=='__main__':main()
