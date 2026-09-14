#!/usr/bin/env python3
"""ALICA-v1 dev3 ONLY: backed-up static UniUI image update, not a release upgrader.
Preserves all backend containers and data. New image must extend exactly the
current image with only /app/public files, retaining its complete image config.
Records new bundle/owner/broker pins; never leaves old integrity expectations.
"""
import copy,hashlib,json,os,shutil,socket,subprocess,sys,tarfile
from pathlib import Path
ROOT=Path('/opt/dsh2-internal-dev3');OLD=Path('/var/lib/alica-dsh-internal/dev-tls-3/bundle')
PIN='1a2718b01a1ae05f796a04334d2107121147fd0106cb6f0ae7c6bff57cb975e6'
NEW=Path('/var/lib/alica-dsh-internal/dev3-oauth-ui-v2/bundle');SAVE=NEW.parent/'rollback'
IMAGE='sha256:1aa3b3dfded9d88c2e567a988209a04c3a942c0e65f311b93ec4c82363836aef'
REQUEST=OLD.parent/'request.json';BASE='alica-dsh2-internal-dev3'

def run(args,timeout=180):
 p=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
 if p.returncode:raise RuntimeError('Command failed: '+args[0])
 return p.stdout.strip()
def digest(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def write(p,data):
 p=Path(p);tmp=p.with_name(p.name+'.oauth-new');fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb') as f:f.write(data);f.flush();os.fsync(f.fileno())
 os.replace(tmp,p)
 fd=os.open(p.parent,os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(fd)
 finally:os.close(fd)
def rows():
 ids=run(['docker','ps','-q']).split();return json.loads(run(['docker','inspect',*ids]))
def identities():return {r['Name']:[r['Id'],r['State']['StartedAt']] for r in rows() if r['Name']!='/dsh2-internal-dev3-uniui-1'}
def main():
 assert os.geteuid()==0 and socket.gethostname()=='ALICA-v1'
 sys.path.insert(0,str(OLD));from install import Installer
 from transaction import atomic_json,Transaction
 sys.path.insert(0,'/usr/local/lib/alica-dsh-ops/dsh2-internal-dev3')
 from doghouse_dsh.broker import lock
 from doghouse_dsh.identity import canonical_signature as signature
 assert json.loads((ROOT/'operations/broker.json').read_text())['signatureSchema']=='alica-runtime-identity/v2'
 from doghouse_dsh.observer import request
 from doghouse_dsh.engine import Engine
 req=json.loads(REQUEST.read_text());i=Installer(OLD,PIN,ROOT,req)
 assert i.tx.inspect()['state']=='installed';i.prepare()
 cfg=json.loads((ROOT/'operations/broker.json').read_text())
 snapshot=request(cfg['socket'],{'op':'snapshot'})
 assert snapshot['ok'] and snapshot['status']['snapshot']['ownershipVerified']
 prior=json.loads(run(['docker','image','inspect',i.release['images']['uniui']['id']]))[0]
 candidate=json.loads(run(['docker','image','inspect',IMAGE]))[0]
 assert candidate['Config']==prior['Config'],'Image runtime configuration changed'
 assert candidate['RootFS']['Layers'][:-1]==prior['RootFS']['Layers'],'Candidate not a single static overlay'
 assert not NEW.parent.exists(),'One-shot update already prepared; inspect receipt and rollback before retry'
 NEW.mkdir(parents=True,mode=0o700);SAVE.mkdir(mode=0o700)
 archive=NEW.parent/'uniui-image.tar';run(['docker','save','-o',str(archive),IMAGE])
 with tarfile.open(archive) as outer:
  manifest=json.load(outer.extractfile('manifest.json'));layers=manifest[0]['Layers']
  with tarfile.open(fileobj=outer.extractfile(layers[-1])) as layer:
   for member in layer:
    path=Path(member.name)
    assert '..' not in path.parts and not path.is_absolute()
    assert (member.isdir() and (str(path) in {'.','app','app/public'} or str(path).startswith('app/public/'))) or (member.isfile() and str(path).startswith('app/public/') and '.wh.' not in path.name),'Non-static image change'
 for p in OLD.iterdir():
  if p.is_file() and p.name!='release.json':os.link(p,NEW/p.name)
 os.link(archive,NEW/'uniui-update.tar')
 release=copy.deepcopy(i.release);release['images']['uniui']['id']=IMAGE
 release['files']['uniui-update.tar']=digest(archive)
 release['uiUpdate']={'baseReleaseSha256':PIN,'kind':'ALICA-v1-development-static-ui-only','freshInstallArtifact':False}
 atomic_json(NEW/'release.json',release);pin=digest(NEW/'release.json')
 j=Installer(NEW,pin,ROOT,req)
 assert {k:v for k,v in i.release['images'].items() if k!='uniui'}=={k:v for k,v in release['images'].items() if k!='uniui'}
 paths=[ROOT/'.env',ROOT/'owner.json',ROOT/'operations/broker.json']+[Path('/etc/systemd/system')/(BASE+s) for s in ['-cell.service','-tls.service']]
 backups=[]
 for n,p in enumerate(paths):
  assert not p.is_symlink();saved=SAVE/str(n);shutil.copy2(p,saved);backups.append({'path':str(p),'saved':str(saved)})
 before=identities();atomic_json(SAVE/'files.json',backups);atomic_json(SAVE/'non-ui-before.json',before)
 receipt={'state':'prepared','oldBundle':str(OLD),'oldPin':PIN,'newBundle':str(NEW),'newPin':pin,'image':IMAGE,'backups':backups}
 journal=NEW.parent/'update.json';atomic_json(journal,receipt)
 # No database/container volume writes: the UI container has zero mounts.
 oldrow=next(r for r in i.owned() if r['Config']['Labels'].get('com.docker.compose.service')=='uniui');assert oldrow['Mounts']==[]
 assert run(['systemctl','show',BASE+'-tls.service','--property=ActiveState','--value'])=='inactive'
 request(cfg['socket'],{'op':'maintenance','enabled':True})
 units=[BASE+'-observer.service',BASE+'-broker.service',BASE+'-tls.timer']
 run(['systemctl','stop',*units])
 success=False
 try:
  with i.tx.locked(),lock(ROOT/'operations/operation.lock'):
   receipt['state']='applying';atomic_json(journal,receipt)
   try:
    env=(ROOT/'.env').read_text();oldline='UNIUI_IMAGE='+prior['Id'];assert env.count(oldline)==1
    write(ROOT/'.env',env.replace(oldline,'UNIUI_IMAGE='+IMAGE).encode())
    atomic_json(ROOT/'owner.json',j.tx.identity)
    j.prepare()
    j.compose('rm','--stop','--force','uniui')
    j.compose('up','-d','--no-recreate','--wait','--wait-timeout','90','uniui')
    newrow=next(r for r in j.owned() if r['Config']['Labels'].get('com.docker.compose.service')=='uniui')
    assert newrow['Image']==IMAGE and newrow['Mounts']==[] and newrow['State']['Health']['Status']=='healthy'
    assert identities()==before,'Unrelated container changed'
    expected=copy.deepcopy(oldrow);expected['Image']=IMAGE;expected['Config']['Image']=IMAGE
    # Compose updates its config hash when the image pin changes; verify all
    # other security-significant runtime fields against the expected row.
    expected['Config']['Labels']['com.docker.compose.config-hash']=newrow['Config']['Labels']['com.docker.compose.config-hash']
    expected['Config']['Labels']['com.docker.compose.image']=IMAGE
    assert signature(newrow)==signature(expected),'Unexpected runtime identity drift'
    cfg['images']['uniui']=IMAGE;cfg['signatures']['uniui']=signature(expected);cfg['ownerSha256']=digest(ROOT/'owner.json')
    atomic_json(ROOT/'operations/broker.json',cfg)
    for p in paths[-2:]:
     text=p.read_text();assert str(OLD) in text and PIN in text
     write(p,text.replace(str(OLD),str(NEW)).replace(PIN,pin).encode())
    run(['systemctl','daemon-reload']);success=True
    receipt['state']='applied';atomic_json(journal,receipt)
   except BaseException:
    for item in backups:write(item['path'],Path(item['saved']).read_bytes())
    i.compose('rm','--stop','--force','uniui')
    i.compose('up','-d','--no-recreate','--wait','--wait-timeout','90','uniui')
    restored=next(r for r in i.owned() if r['Config']['Labels'].get('com.docker.compose.service')=='uniui')
    assert signature(restored)==json.loads((ROOT/'operations/broker.json').read_text())['signatures']['uniui'],'Rollback ownership mismatch'
    run(['systemctl','daemon-reload']);receipt['state']='rolled-back';atomic_json(journal,receipt)
    raise
   finally:
    if success or receipt['state']=='rolled-back':
     e=Engine(ROOT/'operations/ops.db');e.maintenance(False);e.db.close()
 finally:
  if success or receipt['state']=='rolled-back':run(['systemctl','start',*reversed(units)])
 if success:
  from doghouse_dsh.broker import Broker,SERVICES
  live={r['Config']['Labels']['com.docker.compose.service']:r for r in j.owned() if r['State']['Running']}
  Broker(ROOT/'operations/broker.json').verify_identity([live[s] for s in SERVICES])
  result=request(cfg['socket'],{'op':'snapshot'});assert result['ok']
  assert identities()==before
  receipt['state']='verified';atomic_json(journal,receipt)
  print(json.dumps({'update':'verified','onlyUniuiReplaced':True,'ownership':'verified','newBundle':str(NEW),'newReleaseSha256':pin,'rollback':str(SAVE)}))
if __name__=='__main__':main()
