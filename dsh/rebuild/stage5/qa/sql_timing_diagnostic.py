import datetime,hashlib,json,os,socket,subprocess,time
from pathlib import Path
assert os.geteuid()==0 and socket.gethostname()=='dsh-stage5-disposable'
name='dsh2-stage5-qa3-postgresql-1';root=Path('/opt/dsh2-stage5-qa3')
def run(a,t=45):return subprocess.run(a,capture_output=True,text=True,timeout=t)
def row():return json.loads(run(['docker','inspect',name]).stdout)[0]
before=row();assert before['Config']['Labels']['com.alica.stage2']==root.name
assert not run(['docker','ps','-q']).stdout.strip()
assert before['HostConfig']['NanoCpus']==250000000
files={p:hashlib.sha256(p.read_bytes()).hexdigest() for p in (root/'owner.json',root/'transaction.json',root/'compose.json')}
r={'schema':'stage5-sql-timing-diagnostic/v1','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'acceptance':False,'productProbeModified':False,'diagnosticConnectionTimeoutSeconds':20}
try:
 assert run(['docker','start',name],90).returncode==0
 end=time.monotonic()+60
 while time.monotonic()<end:
  if run(['docker','exec',name,'pg_isready','-q'],20).returncode==0:break
 else:raise AssertionError('listener-not-ready')
 # Deliberately diagnostic-only: retain identity/query/quota, allow longer client connection time.
 sql=before['Config']['Healthcheck']['Test'][1];assert 'PGCONNECT_TIMEOUT=2 ' in sql
 sql=sql.replace('PGCONNECT_TIMEOUT=2 ','PGCONNECT_TIMEOUT=20 ')
 start=time.monotonic()
 try:
  p=run(['docker','exec',name,'sh','-c',sql],60)
  r['diagnosticSql']={'exit':p.returncode,'seconds':round(time.monotonic()-start,3)}
 except subprocess.TimeoutExpired:r['diagnosticSql']={'deadlineExceeded':True}
 after=row();r['productConfigUnchanged']=before['Config']==after['Config'] and before['HostConfig']==after['HostConfig']
finally:
 r['candidateStopped']=run(['docker','stop','--time','30',name],90).returncode==0
 r['preservedFilesUnchanged']=all(hashlib.sha256(p.read_bytes()).hexdigest()==h for p,h in files.items())
 r['noRunningGuestContainers']=not run(['docker','ps','-q']).stdout.strip()
 p=Path('/var/lib/alica-stage5-qa3/sql-timing-diagnostic.json');p.write_text(json.dumps(r,indent=2)+'\n');p.chmod(0o600)
 print(json.dumps(r),flush=True)
