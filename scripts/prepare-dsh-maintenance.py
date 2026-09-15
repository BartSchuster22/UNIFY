#!/usr/bin/env python3
"""Prepare (never deploy) the bounded DSH2 maintenance candidate.
Builds additive image layers on ALICA-v1, streams images to DSH2, verifies their
configs/layers, and signs through the existing publisher without exporting keys.
"""
import argparse,hashlib,json,os,shlex,shutil,subprocess,tarfile,tempfile
from pathlib import Path
REPO=Path(__file__).resolve().parents[1]
SRC=REPO/'dsh/rebuild/internal_install'
BUILD='/var/lib/alica-dsh-internal/maintenance1-build'
DEST='/var/lib/alica/dsh2-internal-maintenance1/candidate'
OLD='/var/lib/alica/dsh2-internal-onboarding1/candidate'
PUB='/var/lib/alica-dsh-internal/onboarding1-publisher'
KEY='/home/herman/.ssh/alica_v1_deploy_ed25519'
BASESHA='8fecaecb87f92a47a9ea427965f79525095f9b9567e92dedf6d03d403147b204'
TRUSTSHA='ac6d836bb5cd3efa6ab15832e574f1b5455aabff4273bc99331dfa7f43b5e1ac'
def require(x,m):
 if not x:raise RuntimeError(m)
def ssh(host):
 return ['ssh','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-i',KEY,*(['-o','UserKnownHostsFile=/home/herman/.ssh/dsh2_known_hosts'] if host=='dsh' else []),'deploy@'+('95.216.216.143' if host=='dsh' else '167.233.135.142')]
def remote(host,code,input=None,timeout=600):
 p=subprocess.run(ssh(host)+['sudo -n python3 -B -c '+shlex.quote(code)],input=input,text=True,capture_output=True,timeout=timeout)
 require(p.returncode==0,p.stderr[-4000:]);return p.stdout

def main():
 a=argparse.ArgumentParser();a.add_argument('--revision',required=True);args=a.parse_args()
 require(subprocess.check_output(['git','rev-parse','HEAD'],cwd=REPO,text=True).strip()==args.revision,'Source revision changed')
 require(not subprocess.check_output(['git','status','--porcelain'],cwd=REPO,text=True).strip(),'Clean source required')
 for package in ['contracts','hermes-control-adapter','gateway','uniui']:
  subprocess.run(['pnpm','--filter','@aquiero/'+package,'build'],cwd=REPO,check=True)
 old=json.loads(remote('dsh',f"from pathlib import Path;import hashlib,json; p=Path({OLD!r})/'bundle/release.json'; assert hashlib.sha256(p.read_bytes()).hexdigest()=={BASESHA!r};print(p.read_text())"))
 remote('alica',f"from pathlib import Path;import socket;assert socket.gethostname()=='ALICA-v1';p=Path({BUILD!r});assert not p.exists(),'Build already exists';p.mkdir(mode=0o700)")
 remote('dsh',f"from pathlib import Path;import socket;assert socket.gethostname()=='DSH2';p=Path({DEST!r});assert not p.exists(),'Candidate already exists';p.mkdir(parents=True,mode=0o700);(p/'bundle').mkdir(mode=0o700)")
 with tempfile.TemporaryDirectory(prefix='dsh-maintenance-build-') as tmp:
  archive=Path(tmp)/'context.tar'
  with tarfile.open(archive,'w') as t:
   for source,target in [(REPO/'apps/gateway/dist','core'),(REPO/'apps/gateway/migrations','migrations'),(REPO/'apps/hermes-control-adapter/dist','hermes'),(REPO/'apps/uniui/dist','ui'),(REPO/'packages/contracts/dist','contracts'),(SRC/'Dockerfile.maintenance','Dockerfile')]:t.add(source,arcname=target)
  with archive.open('rb') as f:subprocess.run(ssh('alica')+['sudo -n tar -xf - -C '+BUILD],stdin=f,check=True)
  for name in ['maintenance.py','setup.py','package_onboarding.py']:
   remote('dsh',f"from pathlib import Path;import sys;p=Path({DEST!r})/'bundle'/{name!r};p.write_text(sys.stdin.read());p.chmod(0o600)",(SRC/name).read_text())
 buildcode=f'''import json,subprocess,hashlib
from pathlib import Path
p=Path({BUILD!r});old=json.loads({json.dumps(old)!r})
def state():
 ids=subprocess.check_output(['docker','ps','-aq'],text=True).split();rows=json.loads(subprocess.check_output(['docker','inspect',*ids]))
 return {{r['Id']:{{'name':r['Name'],'image':r['Image'],'running':r['State']['Running'],'started':r['State']['StartedAt'],'restartCount':r['RestartCount']}} for r in rows}}
before=state();(p/'protection-before.json').write_text(json.dumps(before))
ids={{s:r['id'] for s,r in old['images'].items()}}
for role,target in [('unify-core','core'),('hermes','hermes'),('uniui','ui')]:
 tag='alica-internal-maintenance1:'+target
 assert subprocess.run(['docker','image','inspect',tag],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode!=0,'Tag already exists'
 cmd=['docker','build','--network=none','--target',target,'-t',tag]
 for arg,key in [('BASE_CORE','unify-core'),('BASE_HERMES','hermes'),('BASE_UI','uniui')]:cmd+=['--build-arg',arg+'='+old['images'][key]['id']]
 subprocess.run(cmd+[str(p)],check=True,stdout=subprocess.DEVNULL)
 ids[role]=json.loads(subprocess.check_output(['docker','image','inspect',tag]))[0]['Id']
assert before==state(),'Existing container state changed'
(p/'images.json').write_text(json.dumps(ids));print(json.dumps(ids))
'''
 ids=json.loads(remote('alica',buildcode,timeout=600));print('Built immutable layers; existing ALICA containers unchanged',flush=True)
 producer=subprocess.Popen(ssh('alica')+['sudo -n docker save '+shlex.join(sorted(ids.values()))],stdout=subprocess.PIPE)
 writer=f'''from pathlib import Path
import sys,shutil
p=Path({DEST!r})/'bundle/images.tar';count=0
with p.open('xb') as f:
 for b in iter(lambda:sys.stdin.buffer.read(1024**2),b''):
  assert count+len(b)<=5*1024**3 and shutil.disk_usage(p.parent).free>12*1024**3,'Export capacity guard'
  f.write(b);count+=len(b)
print(count)
'''
 consumer=subprocess.run(ssh('dsh')+['sudo -n python3 -B -c '+shlex.quote(writer)],stdin=producer.stdout,capture_output=True,text=True,timeout=600)
 producer.stdout.close();require(producer.wait(timeout=30)==0 and consumer.returncode==0,'Image transfer failed: '+consumer.stderr)
 print('Image export transferred:',consumer.stdout.strip(),'bytes',flush=True)
 assemble=f'''import sys,json,hashlib,shutil,time
from pathlib import Path
p=Path({DEST!r});b=p/'bundle';base=Path({OLD!r})/'bundle';old=json.loads((base/'release.json').read_text());ids=json.loads({json.dumps(ids)!r})
sys.path.insert(0,str(b));from package_onboarding import inspect_export,digest,canonical
for n,h in old['files'].items():
 assert digest(base/n)==h,'Predecessor artifact changed'
 if n!='images.tar' and not n.endswith('.oci-manifest.json'):shutil.copyfile(base/n,b/n)
exported=inspect_export(b/'images.tar',ids);images={{}}
for role,item in exported.items():
 raw=canonical(item['manifest']);mh=hashlib.sha256(raw).hexdigest();(b/(role+'.oci-manifest.json')).write_bytes(raw)
 images[role]={{**old['images'][role],'id':ids[role],'reference':ids[role],'filesystem_diff_ids':item['diff_ids'],'oci_reference':'alica-maintenance/'+role+'@sha256:'+mh}}
 # Immutable source descriptors come from the verified export; no container data is packaged.
 images[role].pop('size_bytes',None)
release={{**old,'release':'internal-maintenance1-'+{args.revision!r}[:8],'images':images,'acceptance':'Internal engineering maintenance; not production/distribution qualification','maintenance':{{'schema':'dsh-internal-maintenance/v1','cell':'dsh2-internal-onboarding1','predecessorReleaseSha256':{BASESHA!r},'preserveIdentities':True,'licensingReviewResumed':False,'sourceRevision':{args.revision!r}}}}}
release['internalDevelopment']={{**old.get('internalDevelopment',{{}}),'sourceHead':{args.revision!r},'sourceDirty':False,'freshInstallArtifact':False,'scope':'Existing DSH2 signed maintenance only','baseReleaseSha256':{BASESHA!r}}}
release['source_revisions']={{**old.get('source_revisions',{{}}),'maintenance':{args.revision!r}}}
release['files']={{q.name:digest(q) for q in sorted(b.iterdir()) if q.name not in ['release.json','release.sha256']}}
(b/'release.json').write_text(json.dumps(release,sort_keys=True,indent=2)+'\\n');pin=digest(b/'release.json');(b/'release.sha256').write_text(pin+'  release.json\\n')
sys.path.insert(0,'/usr/local/lib/alica-setup-onboarding1');import release_trust as rt
now=int(time.time());payload={{'schema':'alica-release-admission/v1','scope':'qa','sequence':2,'issuedAt':now,'expiresAt':now+7*86400,'platform':'linux/amd64','acceptedPredecessors':[{BASESHA!r}],'artifacts':rt.inventory(b),'releaseSha256':pin}}
(p/'admission-payload.json').write_text(json.dumps(payload));print(json.dumps(payload))
'''
 payload=remote('dsh',assemble,timeout=600)
 signcode=f"import sys,json,hashlib;from pathlib import Path;p=Path({PUB!r});assert hashlib.sha256((p/'candidate-trust.json').read_bytes()).hexdigest()=={TRUSTSHA!r};sys.path.insert(0,str(p));import release_trust as rt;print(json.dumps(rt.sign(json.load(sys.stdin),p/'signing-key.pem')))"
 envelope=remote('alica',signcode,payload)
 finish=f'''from pathlib import Path
import json,sys,shutil
p=Path({DEST!r});envelope=json.load(sys.stdin);(p/'candidate-envelope.json').write_text(json.dumps(envelope,indent=2))
sys.path.insert(0,'/usr/local/lib/alica-setup-onboarding1');import release_trust as rt
verified=rt.verify(envelope,rt.load('/etc/alica/release-trust/onboarding1/candidate-trust.json'),p/'bundle',{BASESHA!r},1,'qa')
s=json.loads((Path({OLD!r})/'preparation.json').read_text());s.update(admission=verified,maintenanceAdmission={{'predecessorDestination':{OLD!r},'releaseSha256':{BASESHA!r},'sequence':1}},archive=None,archiveSha256=None,downloadedBytes=0)
(p/'preparation.json').write_text(json.dumps(s,indent=2));shutil.copyfile(Path({OLD!r})/'request.json',p/'request.json')
(p/'build-receipt.json').write_text(json.dumps({{'sourceRevision':{args.revision!r},'imageIds':{ids!r},'admission':verified,'allExportedConfigsAndLayersVerified':True,'existingALICAContainersUnchanged':True,'deployed':False}},indent=2));print(json.dumps(verified))
'''
 print(remote('dsh',finish,envelope,timeout=600),flush=True)
 print(remote('dsh',f"import subprocess;subprocess.run(['python3','-B',{DEST!r}+'/bundle/maintenance.py','plan','--candidate',{DEST!r}],check=True)",timeout=600),flush=True)
if __name__=='__main__':main()
