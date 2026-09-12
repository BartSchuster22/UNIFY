"""Bounded clean-OS requalification of the SAME signed QA4 artifact. Fail closed."""
import json,os,subprocess,sys,time,socket,shlex,hashlib
from pathlib import Path
os.umask(0o077)
REPO=Path('/home/herman/stage3-publication/repos/UNIFY');S=REPO/'dsh/rebuild/stage7';E=S/'evidence/candidates/72297c3';sys.path.insert(0,str(S));import run_acceptance as q
q.OUT=E/'live'
def run(args,timeout=1800):
 p=subprocess.run(args,cwd=REPO,timeout=timeout);assert p.returncode==0,'Command failed: '+str(args[0])
end=time.monotonic()+7200
while time.monotonic()<end:
 current=json.loads((q.OUT/'progress.json').read_text())
 if current.get('runtimeRecoveryPrivacyGatesExecuted'):break
 p=Path('/proc/1675010/cmdline');assert p.exists() and b'stage7-finish-qa4.py' in p.read_bytes(),'Current qualification stopped; no rebuild permitted'
 time.sleep(10)
else:raise RuntimeError('Current qualification deadline exceeded; no rebuild permitted')
# Preserve all public reports before the safeguard quiesces the system.
p=subprocess.run(q.SSH+['sudo -n python3 -B /srv/alica-stage7-qa4/export_public_evidence.py'],capture_output=True,text=True,timeout=300);assert p.returncode==0,'Evidence export failed';data=json.loads(p.stdout)
(q.OUT/'exported-evidence.json').write_text(json.dumps(data,indent=2)+'\n')
run(['python3','-B','/home/herman/stage7-preserve-qa4-final.py'],2400)
# Re-verifies both encrypted backup destinations BEFORE each provider action.
run(['python3','-B',str(S/'provider_rebuild_qa4.py'),'prepare'],1800)
run(['python3','-B',str(S/'provider_rebuild_qa4.py'),'rebuild'],2400)
base=Path('/home/herman/.alica-provider-access');known=base/'dsh2-stage7-known-hosts';retained=base/'stage7-qa4-fresh-os/previous-known-hosts';assert not retained.exists();retained.write_bytes(known.read_bytes());retained.chmod(0o600)
known.write_bytes((base/'stage7-qa4-fresh-os/dsh2-stage7-known-hosts').read_bytes());known.chmod(0o600)
run(['python3','-B','/home/herman/stage7-qa4-fresh-bootstrap.py'],12000)
q.OUT=E/'fresh-os-live';q.REPORT=json.loads((q.OUT/'progress.json').read_text());assert q.REPORT['qa4RecurrenceExecuted']
# Bounded browser fixture: owns and terminates its SSH tunnel subprocess.
args=q.SSH[:-1]+['-N','-o','ExitOnForwardFailure=yes','-L','127.0.0.1:20443:127.0.0.1:443','-L','127.0.0.1:20444:10.84.0.10:443',q.SSH[-1]]
with (q.OUT/'browser-tunnel.private.log').open('wb') as log:
 tunnel=subprocess.Popen(args,stdout=log,stderr=log)
 try:
  deadline=time.monotonic()+30
  while time.monotonic()<deadline:
   assert tunnel.poll() is None,'Browser tunnel failed'
   try:
    with socket.create_connection(('127.0.0.1',20443),timeout=1):break
   except OSError:time.sleep(.2)
  else:raise RuntimeError('Browser tunnel readiness deadline exceeded')
  with (q.OUT/'browser.private.log').open('wb') as out:
   p=subprocess.run(['/home/herman/stage7-browser-venv/bin/python',str(S/'browser_check_qa4_fresh.py')],stdout=out,stderr=subprocess.STDOUT,timeout=180);assert p.returncode==0,'Fresh browser check failed'
 finally:
  tunnel.terminate();tunnel.wait(timeout=15)
browser=Path('/home/herman/stage7-browser-artifacts-qa4-fresh/browser-result.json');assert all(json.loads(browser.read_text()).values())
scp=['scp','-o','UserKnownHostsFile='+str(known),'-i','/home/herman/.ssh/alica_v1_deploy_ed25519']
run(scp+[str(browser),'/home/herman/stage7-operations-update-qa4.tar','deploy@95.216.216.143:/home/deploy/'])
q.stage('stage_browser_evidence_and_signed_update','sudo -n install -m 600 /home/deploy/browser-result.json /var/lib/alica-stage7-qa4/browser-result.json && sudo -n mkdir -m 700 /srv/alica-stage7-operations-update-qa4 && sudo -n tar -xf /home/deploy/stage7-operations-update-qa4.tar -C /srv/alica-stage7-operations-update-qa4')
q.stage('credential_lifecycle','sudo -n python3 -B /srv/alica-stage7-qa4/credential_lifecycle.py',timeout=180)
run(['python3','-B','/home/herman/stage7-finish-qa4-fresh.py'],12000)
p=subprocess.run(q.SSH+['sudo -n python3 -B /srv/alica-stage7-qa4/export_public_evidence.py'],capture_output=True,text=True,timeout=300);assert p.returncode==0,'Fresh evidence export failed';data=json.loads(p.stdout)
(q.OUT/'exported-evidence.json').write_text(json.dumps(data,indent=2)+'\n')
print(json.dumps({'freshOsQualificationExecuted':True,'finalReconciliationAndPublicationRequired':True}),flush=True)
