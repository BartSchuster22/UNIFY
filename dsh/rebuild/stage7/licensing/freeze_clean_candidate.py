"""Write-once candidate content lock; verification rejects drift, never retags images."""
import argparse,hashlib,json,subprocess
from pathlib import Path
BASE=Path(__file__).resolve().parent
REVIEW=BASE/'clean-candidate-review'
OUT=REVIEW/'steps12'
SSH=['ssh','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile=/home/herman/.alica-provider-access/dsh2-stage7-known-hosts','-i','/home/herman/.ssh/alica_v1_deploy_ed25519','deploy@95.216.216.143']
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def encode(v):return (json.dumps(v,sort_keys=True,indent=2)+'\n').encode()
def derive():
    build=json.loads((REVIEW/'build-receipt.json').read_bytes());verify=json.loads((REVIEW/'build-verification.json').read_bytes());scan=json.loads((REVIEW/'scans/receipt.json').read_bytes())
    if not verify['buildComplete'] or verify['buildReceiptSha256']!=sha(REVIEW/'build-receipt.json'):raise ValueError('Unverified build')
    if not scan['completed'] or scan['buildReceiptSha256']!=sha(REVIEW/'build-receipt.json') or scan['queueSha256']!=sha(REVIEW/'scans/review-queue.json'):raise ValueError('Unverified inventory')
    images={}
    for role,r in build['images'].items():
        p=REVIEW/role/'transformation.json';t=json.loads(p.read_bytes())
        if sha(p)!=r['transformationSha256']:raise ValueError('Changed transformation')
        images[role]={'imageId':r['imageId'],'tagAtFreeze':r['tag'],'originalImageId':r['originalImageId'],'archiveSha256':r['archiveSha256'],'layerSha256':t['cleanLayerSha256'],'transformationSha256':r['transformationSha256']}
    if len(images)!=8:raise ValueError('Wrong image scope')
    return {'schema':'stage74-clean-candidate-lock/v1','candidate':'clean-candidate1-linux-amd64','remoteRoot':'/srv/alica-stage74-clean-candidate1','images':images,'inputs':{n:sha(REVIEW/n) for n in ['build-receipt.json','build-verification.json','scans/receipt.json','scans/review-queue.json','candidate-metadata-gaps.json']},'changePolicy':'Any changed image/archive/inventory requires a new candidate lock and affected evidence requalification; never rewrite this lock.','engineeringComplete':False,'legalApproval':False,'productionRelease':False}
REMOTE='''import hashlib,json,subprocess,sys
from pathlib import Path
sys.path.insert(0,'/home/deploy/stage74-clean-engineering')
import build_clean_candidate as b
lock=json.load(sys.stdin);root=Path(lock['remoteRoot'])
original=b.canonical_snapshot(json.loads((root/'original-containers.private.json').read_bytes()))
if b.container_snapshot()!=original:raise ValueError('QA changed')
for role,r in lock['images'].items():
 folder=root/role
 for name,h in [('image.tar',r['archiveSha256']),('clean-layer.tar',r['layerSha256']),('transformation.json',r['transformationSha256'])]:
  if b.sha(folder/name)!=h:raise ValueError('Changed candidate bytes: '+role+'/'+name)
 image=json.loads(b.cmd(['docker','image','inspect',r['tagAtFreeze']]))[0]
 old=json.loads(b.cmd(['docker','image','inspect',r['originalImageId']]))[0]
 if image['Id']!=r['imageId'] or image['RootFS']['Layers']!=['sha256:'+r['layerSha256']] or image['Config']!=old['Config']:raise ValueError('Changed image config or tag')
for name in ['build-receipt.json','build-verification.json','scans/receipt.json','scans/review-queue.json']:
 if b.sha(root/name)!=lock['inputs'][name]:raise ValueError('Changed remote evidence')
if b.container_snapshot()!=original:raise ValueError('QA changed during verification')
print(json.dumps({'liveCandidatePinsVerified':True,'images':len(lock['images']),'originalQAUnchanged':True}))
'''
def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--create',action='store_true');p.add_argument('--live',action='store_true');a=p.parse_args();data=encode(derive());OUT.mkdir(exist_ok=True);lock=OUT/'candidate-lock.json'
    if a.create:
        with lock.open('xb') as f:f.write(data)
    elif lock.read_bytes()!=data:raise ValueError('Frozen candidate drift')
    if a.live:
        import shlex
        result=subprocess.run(SSH+['sudo -n python3 -c '+shlex.quote(REMOTE)],input=lock.read_bytes(),capture_output=True,timeout=600)
        if result.returncode:raise RuntimeError(result.stderr.decode())
        live=json.loads(result.stdout);live['candidateLockSha256']=sha(lock)
        (OUT/'freeze-verification.json').write_bytes(encode(live));print(json.dumps(live))
    else:print(json.dumps({'candidateLockSha256':sha(lock),'localPinsVerified':True}))
if __name__=='__main__':main()
