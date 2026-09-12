"""Explicit dedicated-QA enrollment bound to the successful provider rebuild receipt."""
import json,shlex,subprocess
from pathlib import Path
BASE=Path('/home/herman/.alica-provider-access')
p=json.loads((BASE/'stage7-qa4-fresh-os/stage7-rebuild-plan.json').read_text())
assert p['phase']=='fresh-os-ready' and p['serverId']==165497729 and p['ip']=='95.216.216.143' and p['previousQa4StateAbsent'] and p['emptyDockerVerified']
code="""import json,os,socket
from pathlib import Path
expected="""+repr(p['after'])+"""
assert os.geteuid()==0 and socket.gethostname()=='DSH2'
assert Path('/etc/machine-id').read_text().strip()==expected['machineId'] and Path('/proc/sys/kernel/random/boot_id').read_text().strip()==expected['bootId']
v={'purpose':'alica-stage7-dedicated-qa','hostname':'DSH2','machineId':expected['machineId']}
marker=Path('/etc/alica-stage7-qa.json')
if marker.exists():
 assert not marker.is_symlink() and json.loads(marker.read_text())==v
else:
 fd=os.open(marker,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'w') as f:json.dump(v,f)
import sys;sys.path.insert(0,'/srv/alica-stage7-qa4');from qa_host import assert_qa_host;assert_qa_host()
print(json.dumps({'providerIdentityVerified':True,'dedicatedQaEnrollmentVerified':True}))
"""
r=subprocess.run(['ssh','-o','BatchMode=yes','-o','UserKnownHostsFile='+str(BASE/'dsh2-stage7-known-hosts'),'-i','/home/herman/.ssh/alica_v1_deploy_ed25519','deploy@95.216.216.143','sudo -n python3 -c '+shlex.quote(code)],capture_output=True,text=True,timeout=40)
assert r.returncode==0,'Dedicated QA enrollment failed'
e=json.loads(r.stdout);out=Path(__file__).parent/'evidence/candidates/72297c3/fresh-os-live/qa-enrollment.json';out.write_text(json.dumps(e,indent=2)+'\n');print(json.dumps(e))
