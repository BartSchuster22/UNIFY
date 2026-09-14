#!/usr/bin/env python3
"""Pinned dev3 engineering update: OIDC refresh code and chat assets only."""
import copy,hashlib,json,os,shutil,subprocess,sys,tarfile
from pathlib import Path
ROOT=Path('/opt/dsh2-internal-dev3')
OLD=Path('/var/lib/alica-dsh-internal/dev3-oauth-ui-v2/bundle')
PIN='4fbc13291e9ffc19effc6e0c60bbc5883ea640e29e67b53a170f79981fa466d4'
NEW=Path('/var/lib/alica-dsh-internal/dev3-session-feedback-2/bundle');SAVE=NEW.parent/'rollback'
REQUEST=Path('/var/lib/alica-dsh-internal/dev-tls-3/request.json');BASE='alica-dsh2-internal-dev3'
IMAGES={'unify-core':'sha256:053d5f48f2d8e24dbaf8556ada584001daa3dff3cbe04a6c07a33ac334f472a6','uniui':'sha256:9830542cd82284671a5c161ea05200ec834e31f85e8f5e449822c7e7953075d3'}
def run(args,check=True):
 p=subprocess.run(args,capture_output=True,text=True)
 if check and p.returncode:raise RuntimeError('Command failed: '+args[0]+' '+str(p.returncode))
 return p
def docker(*args):return json.loads(run(['docker',*args]).stdout)
def digest(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def write(p,data):
 p=Path(p);tmp=p.with_name(p.name+'.session-update');fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'wb') as f:f.write(data);f.flush();os.fsync(f.fileno())
 os.replace(tmp,p)
def identities():
 ids=run(['docker','ps','-q']).stdout.split(); rows=docker('inspect',*ids)
 return {r['Name']:{'id':r['Id'],'image':r['Image'],'started':r['State']['StartedAt']} for r in rows if r['Name'] not in ['/dsh2-internal-dev3-'+s+'-1' for s in IMAGES]}
def main():
 assert os.geteuid()==0 and not NEW.parent.exists()
 sys.path.insert(0,str(OLD));from install import Installer;from transaction import atomic_json,Transaction
 sys.path.insert(0,'/usr/local/lib/alica-dsh-ops/dsh2-internal-dev3')
 from doghouse_dsh.broker import Broker,SERVICES,lock
 from doghouse_dsh.identity import canonical_signature as signature
 from doghouse_dsh.observer import request
 from doghouse_dsh.engine import Engine
 req=json.loads(REQUEST.read_text());i=Installer(OLD,PIN,ROOT,req);assert i.plan()['state']=='installed'
 cfg=json.loads((ROOT/'operations/broker.json').read_text());assert cfg['signatureSchema']=='alica-runtime-identity/v2'
 oldrows={r['Config']['Labels']['com.docker.compose.service']:r for r in i.owned() if r['State']['Running']}
 Broker(ROOT/'operations/broker.json').verify_identity([oldrows[s] for s in SERVICES])
 assert all(r['State']['Health']['Status']=='healthy' for r in oldrows.values())
 assert run(['systemctl','is-active',BASE+'-tls.service'],False).returncode!=0
 for s,image in IMAGES.items():
  before=docker('image','inspect',oldrows[s]['Image'])[0];after=docker('image','inspect',image)[0]
  assert before['Config']==after['Config'],'Image runtime config changed'
  assert after['RootFS']['Layers'][:-1]==before['RootFS']['Layers'],'Not a single-layer extension'
 NEW.mkdir(parents=True,mode=0o700);SAVE.mkdir(mode=0o700)
 archive=NEW/'session-update.tar';run(['docker','save','--output',str(archive),*IMAGES.values()])
 with tarfile.open(archive) as tar:
  entries=json.load(tar.extractfile('manifest.json'));assert len(entries)==2
  for entry in entries:
   image='sha256:'+hashlib.sha256(tar.extractfile(entry['Config']).read()).hexdigest()
   assert image in IMAGES.values()
   allowed='app/public/' if image==IMAGES['uniui'] else 'app/dist/auth/'
   with tarfile.open(fileobj=tar.extractfile(entry['Layers'][-1])) as layer:
    for m in layer:
     path=Path(m.name);assert not path.is_absolute() and '..' not in path.parts and not m.issym() and not m.islnk()
     assert (m.isdir() and (str(path) in ['app','app/public','app/dist','app/dist/auth'] or str(path).startswith(allowed))) or (m.isfile() and str(path).startswith(allowed) and '.wh.' not in path.name)
     if image==IMAGES['unify-core'] and m.isfile():assert str(path) in ['app/dist/auth/oidc.js','app/dist/auth/oidc-store.js']
 for p in OLD.rglob('*'):
  if p.is_file() and p.name not in ['release.json','release.sha256']:
   target=NEW/p.relative_to(OLD);target.parent.mkdir(parents=True,exist_ok=True);os.link(p,target)
 release=copy.deepcopy(i.release)
 for s,image in IMAGES.items():release['images'][s]['id']=image
 release['runtimeUpdate']={'kind':'dev3-session-feedback-only','baseManifest':PIN,'images':IMAGES,'archiveSha256':digest(archive)}
 atomic_json(NEW/'release.json',release);pin=digest(NEW/'release.json');write(NEW/'release.sha256',(pin+'\n').encode())
 j=Installer(NEW,pin,ROOT,req)
 paths=[ROOT/'.env',ROOT/'owner.json',ROOT/'operations/broker.json',Path('/etc/systemd/system')/(BASE+'-cell.service'),Path('/etc/systemd/system')/(BASE+'-tls.service')]
 backups=[]
 for n,p in enumerate(paths):dst=SAVE/str(n);shutil.copy2(p,dst);backups.append({'path':str(p),'saved':str(dst)})
 atomic_json(SAVE/'files.json',backups);untouched=identities();atomic_json(SAVE/'untouched.json',untouched)
 receipt={'state':'prepared','oldPin':PIN,'newPin':pin,'images':IMAGES};journal=NEW.parent/'update.json';atomic_json(journal,receipt)
 units=[BASE+'-tls.timer',BASE+'-observer.service',BASE+'-broker.service']
 request(cfg['socket'],{'op':'maintenance','enabled':True});run(['systemctl','stop',*units]);success=False
 try:
  with i.tx.locked(),lock(ROOT/'operations/operation.lock'):
   try:
    env=(ROOT/'.env').read_text()
    for s,image in IMAGES.items():
     name='UNIFY_CORE_IMAGE' if s=='unify-core' else 'UNIUI_IMAGE';oldline=name+'='+oldrows[s]['Image'];assert oldline in env
     env=env.replace(oldline,name+'='+image)
    write(ROOT/'.env',env.encode());atomic_json(ROOT/'owner.json',j.tx.identity);j.prepare()
    for s in IMAGES:
     j.compose('rm','--stop','--force',s);j.compose('up','-d','--no-recreate','--wait','--wait-timeout','120',s)
    rows={r['Config']['Labels']['com.docker.compose.service']:r for r in j.owned() if r['State']['Running']}
    assert identities()==untouched
    for s,image in IMAGES.items():
     row=rows[s];assert row['Image']==image and row['State']['Health']['Status']=='healthy'
     assert sorted((m['Type'],m['Source'],m['Destination'],m['RW']) for m in row['Mounts'])==sorted((m['Type'],m['Source'],m['Destination'],m['RW']) for m in oldrows[s]['Mounts'])
     expected=copy.deepcopy(oldrows[s]);expected['Image']=image;expected['Config']['Image']=image
     expected['Config']['Labels']['com.docker.compose.image']=image
     expected['Config']['Labels']['com.docker.compose.config-hash']=row['Config']['Labels']['com.docker.compose.config-hash']
     assert signature(expected)==signature(row),'Runtime config drift'
     cfg['images'][s]=image;cfg['signatures'][s]=signature(expected)
    cfg['ownerSha256']=digest(ROOT/'owner.json');atomic_json(ROOT/'operations/broker.json',cfg)
    for p in paths[-2:]:write(p,p.read_text().replace(str(OLD),str(NEW)).replace(PIN,pin).encode())
    run(['systemctl','daemon-reload']);Broker(ROOT/'operations/broker.json').verify_identity([rows[s] for s in SERVICES])
    receipt['state']='verified';atomic_json(journal,receipt);success=True
   except BaseException:
    for item in backups:write(item['path'],Path(item['saved']).read_bytes())
    for s in IMAGES:
     i.compose('rm','--stop','--force',s);i.compose('up','-d','--no-recreate','--wait','--wait-timeout','120',s)
    rows={r['Config']['Labels']['com.docker.compose.service']:r for r in i.owned() if r['State']['Running']}
    Broker(ROOT/'operations/broker.json').verify_identity([rows[s] for s in SERVICES])
    run(['systemctl','daemon-reload']);receipt['state']='rolled-back';atomic_json(journal,receipt);raise
   finally:
    if success or receipt['state']=='rolled-back':Engine(ROOT/'operations/ops.db').maintenance(False)
 finally:
  if success or receipt['state']=='rolled-back':run(['systemctl','start',*reversed(units)])
 print(json.dumps({'update':receipt['state'],'newPin':pin,'onlyCoreAndUiChanged':identities()==untouched}))
if __name__=='__main__':main()
