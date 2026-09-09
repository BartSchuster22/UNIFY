#!/usr/bin/env python3
"""Root-operator recovery through Keycloak; never creates a Core password."""
import argparse,json,os,secrets,subprocess,urllib.parse,urllib.request
from pathlib import Path
from install import Installer,TransactionError,sha

def inside(root,owner):
    root=Path(root)
    def request(path,method='GET',body=None,token=None,form=False):
        headers={}
        if token:headers['Authorization']='Bearer '+token
        if body is not None:
            headers['Content-Type']='application/x-www-form-urlencoded' if form else 'application/json'
            body=(urllib.parse.urlencode(body) if form else json.dumps(body)).encode()
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
        req=urllib.request.Request('http://127.0.0.1:8080/identity/'+path,method=method,data=body,headers=headers)
        with opener.open(req,timeout=10) as response:
            data=response.read(65537)
            if len(data)>65536:raise TransactionError('Oversized identity response')
            return json.loads(data) if data else None
    password=(root/'secrets/keycloak-admin-password').read_text().strip()
    auth=request('realms/master/protocol/openid-connect/token','POST',{'grant_type':'password','client_id':'admin-cli','username':'recovery-admin','password':password},form=True)
    token=auth['access_token'];users=request('admin/realms/alica/users?'+urllib.parse.urlencode({'username':owner,'exact':'true'}),token=token)
    if len(users)!=1 or users[0]['username']!=owner:raise TransactionError('Unique owner identity not found')
    value=secrets.token_urlsafe(48);target=root/'secrets/recovered-owner-password'
    if target.is_symlink():raise TransactionError('Unsafe recovery credential path')
    temp=target.with_suffix('.new');fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o400)
    with os.fdopen(fd,'w') as file:file.write(value+'\n');file.flush();os.fsync(file.fileno())
    os.replace(temp,target)
    path='admin/realms/alica/users/'+urllib.parse.quote(users[0]['id'],safe='')
    request(path+'/reset-password','PUT',{'type':'password','value':value,'temporary':True},token)
    request(path+'/logout','POST',token=token)
    print(json.dumps({'owner_recovery':True,'temporary_password_file':str(target),'existing_identity_sessions_revoked':True,'core_password_created':False}))

def main():
    if os.geteuid()!=0:raise TransactionError('Root operator required')
    p=argparse.ArgumentParser();p.add_argument('--bundle',required=True);p.add_argument('--release-sha256',required=True);p.add_argument('--root',required=True);p.add_argument('--request',required=True);p.add_argument('--inside',action='store_true');a=p.parse_args()
    req=json.loads(Path(a.request).read_text())
    if a.inside:inside(a.root,req['owner']);return
    i=Installer(a.bundle,a.release_sha256,a.root,req)
    if i.tx.inspect()['state']=='absent':raise TransactionError('Installation does not exist')
    with i.tx.locked():
        candidates=[c for c in i.owned() if c['Config']['Labels'].get('com.alica.component')=='keycloak' and c['State']['Running']]
        if len(candidates)!=1:raise TransactionError('Running candidate identity service required')
        cmd=['nsenter','--target',str(candidates[0]['State']['Pid']),'--net','python3',str(Path(__file__).resolve()),'--inside','--bundle',a.bundle,'--release-sha256',a.release_sha256,'--root',a.root,'--request',a.request]
        result=subprocess.run(cmd,capture_output=True,text=True,timeout=45)
        if result.returncode:raise TransactionError('Identity recovery failed; credential file may not yet be active')
        print(result.stdout.strip())
if __name__=='__main__':
    try:main()
    except Exception as error:raise SystemExit('Owner recovery failed: '+type(error).__name__)
