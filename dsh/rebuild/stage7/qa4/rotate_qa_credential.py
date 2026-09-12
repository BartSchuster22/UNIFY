"""Rotate the QA application's credential via the supported owner API."""
import json,os,subprocess,time
from pathlib import Path
from qa_common import *
os.umask(0o077)
p=OUT/'registration.json';reg=json.loads(p.read_text());old=reg['credential'];rid=json.loads((OUT/'first-result.json').read_text())['receiptId']
assert backend('/api/v1/application/requests/'+rid)[0]==401,'Expected expired QA credential'
s,d,_=owner('/api/v1/applications/'+reg['applicationId']+'/credentials','POST',{'ttlSeconds':14400});assert s==201
assert backend('/api/v1/application/requests/'+rid,token=d['token'])[0]==200
archive=OUT/'registration-expired-qualification-attempt1.json';assert not archive.exists();archive.write_bytes(p.read_bytes())
reg['credential']=d;pending=OUT/'registration.new';pending.write_text(json.dumps(reg));os.replace(pending,p)
token=OUT/'reference-secrets/core-token';assert token.stat().st_uid==65532 and token.stat().st_mode&0o777==0o400
# Write the operator credential file, not any business/outcome store.
token.write_text(d['token']);os.chown(token,65532,65532);token.chmod(0o400)
row=json.loads(subprocess.check_output(['docker','inspect','dsh7-reference-qa4']))[0];assert row['Config']['Labels'].get('com.alica.stage7.reference')=='qa4'
subprocess.run(['docker','restart','dsh7-reference-qa4'],capture_output=True,check=True,timeout=60)
s,_,_=owner('/api/v1/applications/'+reg['applicationId']+'/credentials/'+old['id'],'DELETE');assert s==204
report={'supportedOwnerCredentialRotation':True,'expiredCredentialDenied':True,'newCredentialWorks':True,'oldCredentialRevoked':True,'ttlSeconds':14400,'businessOutcomeEdits':False,'failedRunNotAccepted':True}
(OUT/'qualification-credential-rotation.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
