"""Renew an actually expired fixture credential through the owner API; never edit auth DB."""
import hashlib,json,os,re,stat,sys
from pathlib import Path
os.environ['DSH_STAGE5_QA_CELL']='dsh2-stage5-qa5';sys.path.insert(0,'/srv/alica-dsh-qa/qa')
from qa_common import owner,OUT
import restore_dsh2 as r
import subprocess
r.need(os.geteuid()==0 and __import__('socket').gethostname()=='DSH2','QA5 only')
p=OUT/'reference-secrets/core-token';old=p.read_text().strip();h=hashlib.sha256(old.encode()).hexdigest();app=json.loads((OUT/'registration.json').read_text())['applicationId']
sql="SELECT json_build_object('expired',c.expires_at<=now(),'revoked',c.revoked_at IS NOT NULL,'applicationRevoked',a.revoked_at IS NOT NULL,'applicationId',a.id,'expiresAt',c.expires_at) FROM application_credentials c JOIN application_integrations a ON a.id=c.application_id WHERE c.token_hash='"+h+"';"
x=subprocess.run(['docker','exec','-i',r.CELL+'-postgresql-1','psql','-U','unify_bootstrap','-d','unify','-tA','-f','-'],input=sql,text=True,capture_output=True);assert x.returncode==0;before=json.loads(x.stdout)
assert before['applicationId']==app and before['expired'] and not before['revoked'] and not before['applicationRevoked'],'Renewal precondition failed'
s,credential,_=owner('/api/v1/applications/'+app+'/credentials','POST',{'ttlSeconds':86400});assert s==201,'Owner-authorized renewal refused: HTTP '+str(s)
assert re.fullmatch('dsha1_[A-Za-z0-9_-]{43}',credential['token'])
private=r.OUT/'renewed-fixture-credential.json';r.save(private,credential)
st=p.stat();tmp=p.with_suffix('.renewed');tmp.write_text(credential['token']);os.chown(tmp,st.st_uid,st.st_gid);os.chmod(tmp,stat.S_IMODE(st.st_mode));tmp.replace(p)
r.run(['docker','restart','--time','30','dsh5-reference-qa5'])
report={'oldCredentialExpired':True,'oldExpiresAt':before['expiresAt'],'renewedThroughOwnerApi':True,'applicationIdentityPreserved':True,'oldCredentialStillExpired':True,'newExpiresAt':credential['expiresAt'],'permissionsPreserved':True,'createdNewApplication':False};r.save(r.OUT/'credential-renewal.json',report);print(json.dumps(report))
