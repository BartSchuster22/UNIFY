#!/usr/bin/env python3
"""Register the standalone app via owner OIDC and start only its exact QA container."""
import hashlib,importlib.util,json,os,secrets,shutil,subprocess,time
from qa_common import *
NAME='dsh3-reference-qa3';NETWORK='dsh2-stage3-qa3_application'
def command(args):return subprocess.check_output(args,stderr=subprocess.PIPE,text=True).strip()
assert json.loads(command(['docker','network','inspect',NETWORK]))[0]['Labels']['com.docker.compose.project']=='dsh2-stage3-qa3'
assert subprocess.run(['docker','inspect',NAME],capture_output=True).returncode!=0,'Reference fixture occupied'
manifest={'contractVersion':'alica-application/v1','name':'Independent customer notebook QA','frameworkId':'hermes-alica','projectId':'installed-app-qa','subjects':['customer-a','customer-b'],'operations':['answer','research','refresh','correction'],'sourceUrls':['https://www.rfc-editor.org/rfc/rfc2606.txt'],'callbackUrl':'https://notebook.dsh.invalid/callback','retentionDays':1,'promotionPolicy':'verified-extract-v1'}
# DNS pin validation requires a real DNS record before registration. A bounded
# no-service holder reserves only this fixture's address until the real app starts.
holder='dsh3-reference-dns-qa3'
found=subprocess.run(['docker','inspect',holder],capture_output=True)
if found.returncode:
 command(['docker','run','-d','--name',holder,'--label','com.alica.stage3.reference-dns=qa3','--network',NETWORK,'--network-alias','notebook.dsh.invalid','--ip','10.83.0.10','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','32m','--cpus','0.1','--pids-limit','16','--entrypoint','python','sha256:86f50ba3534018f43525f3b13c1afdf739b7f1e7b92c42bba35922e21903e729','-c','import time;time.sleep(600)'])
else:
 assert json.loads(found.stdout)[0]['Config']['Labels'].get('com.alica.stage3.reference-dns')=='qa3'
p=OUT/'registration.json'
if not p.exists():
 status,data,_=owner('/api/v1/applications','POST',manifest)
 assert status==201,(status,data)
 p.write_text(json.dumps(data));p.chmod(0o600)
registration=json.loads(p.read_text())
config=OUT/'reference-secrets';config.mkdir(mode=0o700,exist_ok=True)
passwords={n:secrets.token_urlsafe(24) for n in ['alice','bob']};p=OUT/'customer-passwords.json'
if p.exists():passwords=json.loads(p.read_text())
else:p.write_text(json.dumps(passwords));p.chmod(0o600)
spec=importlib.util.spec_from_file_location('reference_app','/srv/alica-dsh-development/repos/Alica-DSH/reference-app/app.py');app=importlib.util.module_from_spec(spec);spec.loader.exec_module(app)
customers={n:{'subject':'customer-a' if n=='alice' else 'customer-b','passwordHash':app.password_hash(pw)} for n,pw in passwords.items()}
(config/'customers.json').write_text(json.dumps(customers));(config/'core-token').write_text(registration['credential']['token']);(config/'callback-secret').write_text(registration['callbackSigningSecret']);shutil.copyfile(ROOT/'secrets/framework-ca.crt',config/'ca.crt')
(config/'tls.ext').write_text('basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:notebook.dsh.invalid\n')
command(['openssl','req','-new','-newkey','rsa:2048','-nodes','-subj','/CN=notebook.dsh.invalid','-keyout',str(config/'tls.key'),'-out',str(config/'tls.csr')])
command(['openssl','x509','-req','-in',str(config/'tls.csr'),'-CA',str(ROOT/'secrets/framework-ca.crt'),'-CAkey',str(ROOT/'secrets/framework-ca.key'),'-set_serial','8302','-days','7','-sha256','-extfile',str(config/'tls.ext'),'-out',str(config/'tls.crt')])
command(['openssl','verify','-x509_strict','-purpose','sslserver','-verify_hostname','notebook.dsh.invalid','-CAfile',str(config/'ca.crt'),str(config/'tls.crt')])
for f in config.iterdir():os.chown(f,65532,65532);f.chmod(0o400)
os.chown(config,65532,65532);config.chmod(0o500)
data=OUT/'reference-data';data.mkdir(mode=0o700,exist_ok=True);os.chown(data,65532,65532)
caddy=json.loads(command(['docker','inspect','dsh2-stage3-qa3-caddy-1']))[0]['NetworkSettings']['Networks'][NETWORK]['IPAddress']
env={'REFERENCE_ORIGIN':APP,'REFERENCE_CORE_URL':'https://stage3.dsh.invalid:8443','REFERENCE_CORE_TOKEN_FILE':'/run/reference/core-token','REFERENCE_CORE_CA_FILE':'/run/reference/ca.crt','REFERENCE_CALLBACK_SECRET_FILE':'/run/reference/callback-secret','REFERENCE_CUSTOMERS_FILE':'/run/reference/customers.json','REFERENCE_APPLICATION_ID':registration['applicationId'],'REFERENCE_BIND':'0.0.0.0','REFERENCE_PORT':'443','REFERENCE_TLS_CERT':'/run/reference/tls.crt','REFERENCE_TLS_KEY':'/run/reference/tls.key','REFERENCE_RETENTION_DAYS':'1'}
args=['docker','run','-d','--name',NAME,'--label','com.alica.stage3.reference=qa3','--network',NETWORK,'--network-alias','notebook.dsh.invalid','--ip','10.83.0.10','--add-host','stage3.dsh.invalid:'+caddy,'--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--sysctl','net.ipv4.ip_unprivileged_port_start=0','--memory','256m','--memory-swap','256m','--cpus','0.5','--pids-limit','64','--tmpfs','/tmp:rw,size=16m','--mount','type=bind,src='+str(config)+',dst=/run/reference,readonly','--mount','type=bind,src='+str(data)+',dst=/data']
for k,v in env.items():args+=['-e',k+'='+v]
args+=['sha256:86f50ba3534018f43525f3b13c1afdf739b7f1e7b92c42bba35922e21903e729']
holder_state=json.loads(command(['docker','inspect',holder]))[0];assert holder_state['Config']['Labels'].get('com.alica.stage3.reference-dns')=='qa3'
command(['docker','rm','-f',holder_state['Id']])
cid=command(args);(OUT/'reference-container-id').write_text(cid)
deadline=time.monotonic()+30
while True:
 try:
  status,body,_=http(APP,'/');assert status==200;break
 except Exception:
  if time.monotonic()>deadline:raise
  time.sleep(.5)
print(json.dumps({'registeredViaRealOidc':True,'applicationId':registration['applicationId'],'referenceContainer':cid,'verifiedTls':True,'publicPorts':False,'readOnly':True}))
