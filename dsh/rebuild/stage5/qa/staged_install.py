#!/usr/bin/env python3
"""Explicit staged TCG QA install, NOT a cold one-shot installation pass.
Runs unchanged admission/prepare, lets official PostgreSQL initialize durably,
then invokes the normal checksummed installer with no forged checkpoints.
"""
import hashlib,importlib,json,os,socket,subprocess,sys,time
from typing import Any
from pathlib import Path
assert os.geteuid()==0 and socket.gethostname()=='dsh-stage5-disposable'
b=Path('/mnt/qa-share/stage5-package-qa3');root=Path('/opt/dsh2-stage5-qa3')
h='dc83fe85b6d768e186fa1c520558da82d096a0bf81724ecad99ea06250ffc4db'
assert hashlib.sha256((b/'release.json').read_bytes()).hexdigest()==h
resume=sys.argv[1:]==['--resume-prepared']
assert not root.exists() or (resume and json.loads((root/'transaction.json').read_text())=={'state':'prepared','completed':[]})
assert not subprocess.check_output(['docker','ps','-q']).strip()
os.umask(0o077);out=Path('/var/lib/alica-stage5-qa3');out.mkdir(mode=0o700,exist_ok=resume)
r={'cell':root.name,'origin':'https://stage5.qa.invalid','port':443,'bind':'0.0.0.0','owner':'stage5-owner'}
req=out/'request.json';req.write_text(json.dumps(r));report:dict[str,Any]={'coldOneShotPass':False,'stagedFixture':True,'wholeStage5Accepted':False}
if resume:report['priorAttempt']=json.loads((out/'staged-install.json').read_text())
def save(): (out/'staged-install.json').write_text(json.dumps(report,indent=2))
sys.path.insert(0,str(b));Installer=importlib.import_module('install').Installer
i=Installer(b,h,str(root),r);i.operator();i.plan();report['unchangedAdmissionPassed']=True;save()
try:
 with i.tx.locked():
  i.load_images()
  # Match the normal install invocation's mask; QA report files stay private.
  mask=os.umask(0o022)
  try:i.prepare()
  finally:os.umask(mask)
  i.compose('config','--quiet');i.compose('up','-d','postgresql')
 print(json.dumps({'stagedDatabaseStarted':True,'normalAdmissionPassed':True}),flush=True)
 end=time.monotonic()+1200
 while time.monotonic()<end:
  row=json.loads(subprocess.check_output(['docker','inspect',root.name+'-postgresql-1'],timeout=30))[0]
  assert row['Config']['Labels']['com.alica.stage2']==root.name
  assert row['State']['Running'] and not row['State']['OOMKilled'],'database stopped during staging'
  if row['State'].get('Health',{}).get('Status')=='healthy':break
  time.sleep(10)
 else:raise AssertionError('staged-database-readiness-deadline')
 assert json.loads((root/'transaction.json').read_text())=={'state':'prepared','completed':[]}
 report['officialDatabaseInitialized']=True;report['noCompletedCheckpointsInjected']=True;save()
 print(json.dumps({'stagedDatabaseHealthy':True,'normalInstallerStarting':True}),flush=True)
 with (out/'private-install.log').open('w') as log:
  mask=os.umask(0o022)
  try:p=subprocess.run(['python3',str(b/'ops.py'),'install','--bundle',str(b),'--release-sha256',h,'--root',str(root),'--request',str(req)],stdout=log,stderr=subprocess.STDOUT,timeout=1800)
  finally:os.umask(mask)
 report['installExit']=p.returncode;save();assert p.returncode==0,'native-install-failed; see private log'
 report['installed']=json.loads((root/'transaction.json').read_text())['state']=='installed';save();print(json.dumps(report),flush=True)
except BaseException:
 base=['docker','compose','--project-name',root.name,'--project-directory',str(root),'-f',str(root/'compose.json')]
 subprocess.run(base+['stop','--timeout','60'],capture_output=True,timeout=120,check=True)
 report['stoppedAfterFailure']=True;save();raise
