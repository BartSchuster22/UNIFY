#!/usr/bin/env python3
"""Live Stage5 readiness regression; guest-only, no image imports or DB repairs."""
import hashlib,importlib.util,json,socket,subprocess,time
from pathlib import Path
assert socket.gethostname()=='dsh-stage5-disposable'
b=Path('/mnt/qa-share/stage5-package-qa1');root=Path('/opt/dsh2-stage5-qa1')
spec=importlib.util.spec_from_file_location('readiness_package','/mnt/qa-share/readiness-package.py');assert spec and spec.loader
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
def run(args,timeout=30):return subprocess.run(args,capture_output=True,text=True,timeout=timeout)
def cmd(args,timeout=30):
 r=run(args,timeout);assert r.returncode==0,('command-failed',args[:2],r.returncode);return r.stdout
release=json.loads((b/'release.json').read_text());ids=[v['id'] for v in release['images'].values()]
actual=json.loads(cmd(['docker','image','inspect',*ids]));assert {i['Id'] for i in actual}==set(ids)
result={'schema':'stage5-postgres-readiness-live/v1','imageImportRepeated':False,'allSevenPinsPresent':True,'wholeStage5Accepted':False,'cases':{}}
meta={n:hashlib.sha256((root/n).read_bytes()).hexdigest() for n in ('owner.json','transaction.json','compose.json')}
old=root.name+'-postgresql-1';fresh='stage5-readiness-probe'
row=json.loads(cmd(['docker','inspect',old]))[0];assert row['Config']['Labels']['com.alica.stage2']==root.name and not row['State']['Running']
assert run(['docker','inspect',fresh]).returncode!=0,'Probe namespace occupied'
created=False
try:
 cmd(['docker','start',old]);end=time.monotonic()+180
 while time.monotonic()<end:
  if run(['docker','exec',old,'pg_isready','-h','127.0.0.1','-U','unify_bootstrap','-d','unify']).returncode==0:break
  time.sleep(3)
 else:raise AssertionError('partial-cluster-listener-not-ready')
 new=run(['docker','exec',old,'sh','-c',p.POSTGRES_READINESS]);assert new.returncode!=0
 result['cases']['retainedPartialCluster']={'oldProbeExit':0,'newProbeExit':new.returncode,'falseGreenRejected':True}
 cmd(['docker','stop','--time','60',old],90)
 image=release['images']['postgresql']['id']
 args=['docker','run','-d','--name',fresh,'--label','com.alica.stage5.qa=readiness-regression','--pull','never','--network','none','--add-host','postgresql:127.0.0.1','--read-only','--memory','384m','--memory-swap','384m','--cpus','1','--pids-limit','128','--tmpfs','/var/lib/postgresql/data:rw,size=256m','--tmpfs','/var/run/postgresql:rw,size=8m','--tmpfs','/tmp:rw,size=1m','--mount','type=bind,src='+str(root/'secrets/postgres-password')+',dst=/run/secrets/postgres-password,readonly','-e','POSTGRES_PASSWORD_FILE=/run/secrets/postgres-password','-e','POSTGRES_USER=unify_bootstrap','-e','POSTGRES_DB=unify','-e','PGDATA=/var/lib/postgresql/data/pgdata','-e','POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256','--health-cmd',p.POSTGRES_READINESS,'--health-interval','5s','--health-timeout','3s','--health-retries','30',image]
 cmd(args);created=True;print(json.dumps({'freshProbeStarted':True,'partialClusterFalseGreenRejected':True}),flush=True)
 end=time.monotonic()+600
 while time.monotonic()<end:
  row=json.loads(cmd(['docker','inspect',fresh]))[0]
  assert row['State']['Running'],'Fresh probe exited'
  if row['State']['Health']['Status']=='healthy':break
  time.sleep(5)
 else:raise AssertionError('fresh-health-deadline')
 assert run(['docker','exec',fresh,'sh','-c',p.POSTGRES_READINESS]).returncode==0
 result['cases']['freshDatabase']={'dockerHealth':'healthy','queryExit':0,'originalHealthTimeout':'3s','authHost':'scram-sha-256'}
 missing=p.POSTGRES_READINESS.replace('-d unify','-d stage5_missing_database')
 oldexit=run(['docker','exec',fresh,'pg_isready','-h','postgresql','-U','unify_bootstrap','-d','stage5_missing_database']).returncode
 newexit=run(['docker','exec',fresh,'sh','-c',missing]).returncode
 assert oldexit==0 and newexit!=0
 result['cases']['missingDatabase']={'oldProbeExit':oldexit,'newProbeExit':newexit}
 cmd(['docker','exec',fresh,'sh','-c',"umask 077; printf '%s\\n' 'stage5-intentionally-wrong-password' > /tmp/wrong-password"])
 wrong=p.POSTGRES_READINESS.replace('/run/secrets/postgres-password','/tmp/wrong-password')
 bad=run(['docker','exec',fresh,'sh','-c',wrong]);assert bad.returncode!=0
 result['cases']['wrongPassword']={'queryExit':bad.returncode,'rejected':True}
 result['complete']=True
finally:
 cmd(['docker','stop','--time','60',old],90)
 if created:
  row=json.loads(cmd(['docker','inspect',fresh]))[0];assert row['Config']['Labels']['com.alica.stage5.qa']=='readiness-regression'
  cmd(['docker','stop','--time','60',fresh],90);cmd(['docker','rm',fresh])
 assert meta=={n:hashlib.sha256((root/n).read_bytes()).hexdigest() for n in meta}
 result['retainedOwnerTransactionComposeUnchanged']=True
 result['probeRemoved']=created and run(['docker','inspect',fresh]).returncode!=0
 result['retainedDatabaseStopped']=not json.loads(cmd(['docker','inspect',old]))[0]['State']['Running']
 out=Path('/var/lib/alica-stage5-qa');out.mkdir(mode=0o700,parents=True,exist_ok=True)
 (out/'readiness-live.json').write_text(json.dumps(result,indent=2));print(json.dumps(result),flush=True)
