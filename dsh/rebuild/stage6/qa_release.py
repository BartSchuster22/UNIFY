"""Exercise QA-only signing against real, hash-pinned QA5 artifacts on DSH2.
No installation, service start, update or migration is performed.
"""
import json,shlex,subprocess,time
from pathlib import Path
import release_trust as r
BASE=Path(__file__).parent;E=BASE/'evidence'
SSH=['ssh','-o','BatchMode=yes','-o','UserKnownHostsFile=/home/herman/.ssh/dsh2_known_hosts','-i','/home/herman/.ssh/alica_v1_deploy_ed25519','deploy@95.216.216.143']
SCP=['scp','-o','BatchMode=yes','-o','UserKnownHostsFile=/home/herman/.ssh/dsh2_known_hosts','-i','/home/herman/.ssh/alica_v1_deploy_ed25519']
REMOTE='/srv/alica-dsh-qa/stage6-release-inputs';CANDIDATE='/var/lib/alica-stage6-recovery/signed-qa5-artifacts'
def run(argv):return subprocess.check_output(argv,text=True,stderr=subprocess.PIPE).strip()
def main():
 assert run(SSH+['hostname'])=='DSH2'
 run(SSH+['mkdir -p '+REMOTE]);run(SCP+[str(BASE/'release_trust.py'),str(BASE/'test_release_trust.py'),'deploy@95.216.216.143:'+REMOTE+'/'])
 run(SSH+['sudo -n install -d -m 755 /usr/local/lib/alica-release-stage6; sudo -n install -m 644 '+REMOTE+'/release_trust.py '+REMOTE+'/test_release_trust.py /usr/local/lib/alica-release-stage6/'])
 # Only bytes bound by the previously accepted release manifest are copied.
 pinned=r.digest(BASE.parent/'stage5/qa/evidence/dsh2-qa5/candidate-release.json')
 code="import json,hashlib,shutil;from pathlib import Path;import sys;sys.path.insert(0,'/usr/local/lib/alica-release-stage6');import release_trust as r;src=Path('/srv/alica-dsh-qa/stage5-package-qa5');assert r.digest(src/'release.json')==%r;release=r.load(src/'release.json');dst=Path(%r);fresh=not dst.exists();dst.mkdir(mode=0o700,exist_ok=True)\nfor n,h in {**release['files'],'release.json':%r}.items():\n r.safe_name(n);p=src/n;assert not p.is_symlink() and p.is_file();assert r.digest(p)==h;target=dst/n\n if fresh:target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,target)\n assert r.digest(target)==h\nassert r.inventory(dst)=={**release['files'],'release.json':r.digest(src/'release.json')}\nprint(json.dumps(r.inventory(dst)))"%(pinned,CANDIDATE,pinned)
 files=json.loads(run(SSH+['sudo -n python3 -c '+shlex.quote(code)]));assert files['release.json']==pinned
 secret_dir=Path.home()/'.alica-release-signing';secret_dir.mkdir(mode=0o700,exist_ok=True);key=secret_dir/'stage6-qa.pem';trust=secret_dir/'stage6-qa-trust.json';r.keygen(key,trust,'qa')
 now=int(time.time());payload={'schema':'alica-release-admission/v1','scope':'qa','sequence':1,'issuedAt':now,'expiresAt':now+86400,'platform':'linux/amd64','acceptedPredecessors':[pinned],'artifacts':files,'releaseSha256':pinned}
 envelope=r.sign(payload,key);(E/'qa-release-envelope.json').write_text(json.dumps(envelope,indent=2)+'\n');(E/'qa-release-public-trust.json').write_text(trust.read_text()+'\n')
 run(SCP+[str(E/'qa-release-envelope.json'),str(E/'qa-release-public-trust.json'),'deploy@95.216.216.143:'+REMOTE+'/'])
 run(SSH+['sudo -n install -d -m 755 /etc/alica-release-trust; sudo -n install -m 644 '+REMOTE+'/qa-release-public-trust.json /etc/alica-release-trust/stage6-qa.json'])
 cli=['python3','/usr/local/lib/alica-release-stage6/release_trust.py','verify','--envelope',REMOTE+'/qa-release-envelope.json','--trust','/etc/alica-release-trust/stage6-qa.json','--bundle',CANDIDATE,'--current',pinned,'--installed-sequence','0','--scope','qa']
 receipt=json.loads(run(SSH+['sudo -n '+shlex.join(cli)]));assert receipt['signatureVerified']
 # Exercise denials against the real envelope and bundle, not invented receipts.
 code="import copy,json,sys;sys.path.insert(0,'/usr/local/lib/alica-release-stage6');import release_trust as r;e=r.load(%r);t=r.load('/etc/alica-release-trust/stage6-qa.json');root=%r;current=%r;passed=[]\nfor case in ['signature','revoked','predecessor','replay','scope','expired']:\n ee=copy.deepcopy(e);tt=copy.deepcopy(t);args=dict(current=current,sequence=0,scope='qa',now=e['payload']['issuedAt'])\n if case=='signature':ee['signature']='A'*88\n if case=='revoked':tt['revoked']=[e['keyId']]\n if case=='predecessor':args['current']='0'*64\n if case=='replay':args['sequence']=1\n if case=='scope':args['scope']='production'\n if case=='expired':args['now']=e['payload']['expiresAt']\n try:r.verify(ee,tt,root,**args)\n except r.Denied:passed.append(case)\n else:raise RuntimeError('Denial failed: '+case)\nprint(json.dumps(passed))"%(REMOTE+'/qa-release-envelope.json',CANDIDATE,pinned)
 receipt['realArtifactDenials']=json.loads(run(SSH+['sudo -n python3 -c '+shlex.quote(code)]));assert len(receipt['realArtifactDenials'])==6
 receipt['runningContainersAfter']=int(run(SSH+["sudo -n python3 -c \"import subprocess;print(len(subprocess.check_output(['docker','ps','-q'],text=True).split()))\""]))
 assert receipt['runningContainersAfter']==0
 (E/'qa-release-authentication.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt))
if __name__=='__main__':main()
