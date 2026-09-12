"""Preserve the post-privacy QA4 state on both backup hosts. No restore or deletion."""
import json,os,sys,subprocess,shlex
from pathlib import Path
os.umask(0o077)
REPO=Path('/home/herman/stage3-publication/repos/UNIFY');sys.path.insert(0,str(REPO/'dsh/rebuild/stage7'));import run_acceptance as q
q.OUT=REPO/'dsh/rebuild/stage7/evidence/candidates/72297c3/live'
q.REPORT=json.loads((q.OUT/'progress.json').read_text())
assert q.REPORT.get('runtimeRecoveryPrivacyGatesExecuted'), 'Remaining qualification gates must finish first'
key=Path('/home/herman/.config/alica-recovery/dsh2.agekey');recipient=subprocess.check_output(['age-keygen','-y',str(key)],text=True).strip()
rec='/var/lib/alica-stage7-qa4-final-safeguard';local=Path('/home/herman/.config/alica-recovery/stage7-qa4-final');assert not local.exists();local.mkdir(mode=0o700)
code="""import sys,json
from pathlib import Path
sys.path.insert(0,'/srv/alica-stage7-qa4')
import cold_restore as r
assert all(json.loads((r.q.OUT/'privacy-acceptance.json').read_text()).values())
assert json.loads((r.q.OUT/'update-suite.json').read_text())['complete']
extra=Path('/var/lib/alica-stage7-recovery-qa4')
assert json.loads((extra/'update-control/state.json').read_text())['highestAttempt']==5
assert json.loads((extra/'update-control/journal.json').read_text())['phase']=='committed'
original=r.archive.create
def complete_archive(spec_path,recipient,out):
 spec=json.loads(Path(spec_path).read_text())
 spec['sources']['recovery-state']=str(extra)
 spec['metadata']['paths']['recovery-state']=str(extra)
 r.save(spec_path,spec)
 return original(spec_path,recipient,out)
r.archive.create=complete_archive
r.OUT=Path("""+repr(rec)+")\nr.backup("+repr(recipient)+")"
q.stage('post_privacy_safeguard','sudo -n python3 -B -c '+shlex.quote(code),timeout=1000)
def remote(code):return subprocess.check_output(q.SSH+['sudo -n python3 -c '+shlex.quote(code)],timeout=60)
receipt=json.loads(remote("from pathlib import Path;print(Path('"+rec+"/backup-receipt.json').read_text())"));(local/'receipt.json').write_text(json.dumps(receipt))
import shutil
assert shutil.disk_usage(local).free>receipt['encryptedBytes']+1024**3,'Insufficient backup-destination headroom'
cipher=local/'backup.age'
with cipher.open('xb') as f:subprocess.run(q.SSH+['sudo -n python3 -c '+shlex.quote("import sys,shutil;shutil.copyfileobj(open('"+rec+"/backup.age','rb'),sys.stdout.buffer)")],stdout=f,check=True,timeout=300)
sys.path.insert(0,str(REPO/'dsh/rebuild/stage7/qa'));import archive
v=archive.verify(cipher,key,receipt['ciphertextSha256']);assert v['manifestSha256']==receipt['manifestSha256']
dev='/srv/alica-dsh-development/stage7-qa4-final-safeguard';ssh=['ssh','-o','BatchMode=yes','-i','/home/herman/.ssh/alica_v1_deploy_ed25519','deploy@167.233.135.142']
free=int(subprocess.check_output(ssh+['python3 -c '+shlex.quote("import shutil;print(shutil.disk_usage('/srv/alica-dsh-development').free)")],text=True));assert free>receipt['encryptedBytes']+1024**3,'Insufficient second-destination headroom'
subprocess.run(ssh+['mkdir -m 700 '+dev],check=True)
subprocess.run(['scp','-i','/home/herman/.ssh/alica_v1_deploy_ed25519',str(cipher),str(REPO/'dsh/rebuild/stage7/qa/archive.py'),'deploy@167.233.135.142:'+dev+'/'],check=True)
code="import sys,json;sys.path.insert(0,"+repr(dev)+");import archive;print(json.dumps(archive.verify("+repr(dev+'/backup.age')+",'/dev/stdin',"+repr(receipt['ciphertextSha256'])+")))"
p=subprocess.run(ssh+['python3 -c '+shlex.quote(code)],input=key.read_bytes(),capture_output=True,check=True,timeout=300);v2=json.loads(p.stdout);assert v2['manifestSha256']==receipt['manifestSha256']
report={'schema':'stage7-post-privacy-safeguard/v1','receipt':receipt,'elioVerification':v,'developmentVerification':v2,'sourceLeftQuiesced':True,'doesNotRestoreDeletedCustomers':True}
(q.OUT/'post-privacy-safeguard.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
