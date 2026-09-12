"""Bounded QA4 continuation. Stops at first failed gate; never grants inferred PASS."""
import json,os,sys,time,subprocess,hashlib,shlex
from pathlib import Path
os.umask(0o077)
REPO=Path('/home/herman/stage3-publication/repos/UNIFY');os.chdir(REPO);sys.path.insert(0,str(REPO/'dsh/rebuild/stage7'));import run_acceptance as q
q.OUT=REPO/'dsh/rebuild/stage7/evidence/candidates/72297c3/fresh-os-live'
SSH=['ssh','-o','BatchMode=yes','-o','ConnectTimeout=5','-o','UserKnownHostsFile=/home/herman/.alica-provider-access/dsh2-stage7-known-hosts','-i','/home/herman/.ssh/alica_v1_deploy_ed25519','deploy@95.216.216.143']
DEV=['ssh','-o','BatchMode=yes','-i','/home/herman/.ssh/alica_v1_deploy_ed25519','deploy@167.233.135.142']
ROOT='/opt/dsh2-stage7-qa4';BUNDLE='/srv/alica-stage7-72297c3/bundle';REC='/var/lib/alica-stage7-recovery-qa4';QA='/var/lib/alica-stage7-qa4'
def remote(cmd,data=None,timeout=120):
 p=subprocess.run(SSH+[cmd],input=data,capture_output=True,timeout=timeout)
 if p.returncode:raise RuntimeError('Remote operation failed: '+cmd+'; '+p.stderr.decode()[-1800:])
 return p.stdout
end=time.monotonic()+7500
while time.monotonic()<end:
 current=json.loads((q.OUT/'progress.json').read_text());last={r['name']:r for r in current['stages']}
 qualified=last.get('recurring_soak')
 if qualified:
  assert qualified['exitCode']==0,'Qualified recurrence failed; later gates not run'
  if current.get('qa4RecurrenceExecuted'):break
 time.sleep(15)
else:raise RuntimeError('Qualified recurrence prerequisite deadline')
q.REPORT=current
for name in ['host_operations','extended_host','business_faults','hostile_boundary']:
 if last.get(name,{}).get('exitCode')==0:continue
 if name=='business_faults':
  q.stage('external_reference_start_after_daemon','sudo -n docker start dsh7-reference-qa4',timeout=60)
 q.stage(name,'sudo -n python3 -B /srv/alica-stage7-qa4/'+name+'.py',timeout=1200)
q.stage('owner_recovery',f'sudo -n python3 -B {BUNDLE}/recover_owner.py --bundle {BUNDLE} --release-sha256 1486b3aa2dccb7a21941140508280b5125d816452e708e13c7640ea120a2e66c --root {ROOT} --request {ROOT}/operations/request.json',timeout=300)
q.stage('owner_recovery_oidc','sudo -n python3 -B /srv/alica-stage7-qa4/oidc.py --recovered-owner',timeout=120)
q.stage('pre_reboot','sudo -n python3 -B /srv/alica-stage7-qa4/reboot_check.py snapshot',timeout=480)
bootcmd='python3 -c '+shlex.quote("from pathlib import Path;print(Path('/proc/sys/kernel/random/boot_id').read_text().strip())")
oldboot=remote(bootcmd).strip()
p=subprocess.run(SSH+['sudo -n systemctl reboot'],capture_output=True,timeout=30);assert p.returncode in (0,255)
end=time.monotonic()+300
while time.monotonic()<end:
 p=subprocess.run(SSH+[bootcmd],capture_output=True,timeout=12)
 if p.returncode==0 and p.stdout.strip()!=oldboot:break
 time.sleep(3)
else:raise RuntimeError('SSH did not return after reboot')
q.stage('real_reboot','sudo -n python3 -B /srv/alica-stage7-qa4/reboot_check.py verify',timeout=600)
remote('sudo -n docker start dsh7-reference-qa4')
key=Path('/home/herman/.config/alica-recovery/dsh2.agekey');recipient=subprocess.check_output(['age-keygen','-y',str(key)],text=True).strip()
q.stage('cold_backup','sudo -n python3 -B /srv/alica-stage7-qa4/cold_restore.py backup --recipient '+recipient,timeout=1000)
receipt=json.loads(remote('sudo -n python3 -c '+shlex.quote(f"from pathlib import Path;print(Path('{REC}/backup-receipt.json').read_text())")))
local=Path('/home/herman/.config/alica-recovery/stage7-qa4-fresh');local.mkdir(mode=0o700);cipher=local/'backup.age'
with cipher.open('xb') as f:
 p=subprocess.run(SSH+[f"sudo -n python3 -c 'import sys,shutil;shutil.copyfileobj(open(\"{REC}/backup.age\",\"rb\"),sys.stdout.buffer)'"],stdout=f,stderr=subprocess.PIPE,timeout=300);assert p.returncode==0
sys.path.insert(0,str(REPO/'dsh/rebuild/stage7/qa4'));import archive
assert archive.digest(cipher)==receipt['ciphertextSha256'];verified=archive.verify(cipher,key,receipt['ciphertextSha256']);assert verified['manifestSha256']==receipt['manifestSha256']
(q.OUT/'cold-offhost-verification.json').write_text(json.dumps(verified,indent=2))
devdir='/srv/alica-dsh-development/stage7-recovery-qa4-fresh'
subprocess.run(DEV+['install -d -m 700 '+devdir],check=True)
subprocess.run(['scp','-i','/home/herman/.ssh/alica_v1_deploy_ed25519',str(cipher),str(REPO/'dsh/rebuild/stage7/qa4/archive.py'),'deploy@167.233.135.142:'+devdir+'/'],check=True)
code=f"import sys,json;sys.path.insert(0,{devdir!r});import archive;print(json.dumps(archive.verify({(devdir+'/backup.age')!r},'/dev/stdin',{receipt['ciphertextSha256']!r})))"
import shlex
p=subprocess.run(DEV+['python3 -c '+shlex.quote(code)],input=key.read_bytes(),capture_output=True,timeout=300);assert p.returncode==0,p.stderr.decode();devverified=json.loads(p.stdout);assert devverified['manifestSha256']==receipt['manifestSha256']
(q.OUT/'cold-second-offhost-verification.json').write_text(json.dumps(devverified,indent=2))
extracted=json.loads(remote('sudo -n python3 -B /srv/alica-stage7-qa4/cold_restore.py extract',key.read_bytes(),timeout=600));assert extracted['manifestSha256']==receipt['manifestSha256']
(q.OUT/'cold-extraction-receipt.json').write_text(json.dumps(extracted,indent=2))
q.stage('cold_restore','sudo -n python3 -B /srv/alica-stage7-qa4/cold_restore.py apply',timeout=1000)
q.stage('signed_base_admission','sudo -n python3 -B /srv/alica-stage7-qa4/initialize_update.py',timeout=600)
q.stage('signed_update_suite','sudo -n python3 -B /srv/alica-stage7-qa4/update_suite.py',timeout=4000)
q.stage('privacy','sudo -n python3 -B /srv/alica-stage7-qa4/privacy.py',timeout=900)
q.REPORT['remaining']=['final-evidence-review-and-publication'];q.REPORT['runtimeRecoveryPrivacyGatesExecuted']=True;q.save()
print('All continuation gates executed; final independent evidence review required',flush=True)
