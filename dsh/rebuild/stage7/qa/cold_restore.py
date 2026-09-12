#!/usr/bin/env python3
"""QA3 cold backup/restore exercise; exact candidate, root-only, no automatic replay.
Backup and extraction are separate. Apply refuses unless the complete authenticated
staging matches the backup receipt. Original directories remain in quarantine.
"""
import argparse,hashlib,json,os,shutil,subprocess,sys,time
from pathlib import Path
from qa_host import assert_qa_host
import qa_common as q
import archive
sys.dont_write_bytecode=True
CELL=q.CELL;ROOT=q.ROOT;OUT=Path('/var/lib/alica-stage7-recovery-qa3');BUNDLE=Path('/srv/alica-stage7-2772d9c/bundle');CODE=Path('/usr/local/lib/alica-dsh-ops')/CELL
RELEASE='26ccaff3c5539288dda0a0e9b60fa7187fb64b70c772f104e1c0068efbed2b01'
sys.path.insert(0,str(CODE));from doghouse_dsh.broker import lock
from doghouse_dsh.engine import Engine
SERVICES=['postgresql','keycloak','hermes','memory-v4','unify-core','uniui','caddy']
NAMES=[CELL+'-'+s+'-1' for s in SERVICES];REFERENCE='dsh7-reference-qa3'
def run(args,timeout=300):
 p=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
 if p.returncode:raise RuntimeError(args[0]+' failed, exit '+str(p.returncode))
 return p.stdout.strip()
def save(p,value):
 temp=p.with_suffix('.new');fd=os.open(temp,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'w') as f:json.dump(value,f,indent=2);f.flush();os.fsync(f.fileno())
 os.replace(temp,p)
def guard():
 assert_qa_host();assert os.geteuid()==0 and CELL=='dsh2-stage7-qa3'
 assert archive.digest(BUNDLE/'release.json')==RELEASE
 assert json.loads((q.OUT/'clean-install.json').read_text())['passed']
def installer():
 sys.path.insert(0,str(BUNDLE));from install import Installer
 request=json.loads((ROOT/'operations/request.json').read_text())
 value=Installer(BUNDLE,RELEASE,ROOT,request);value.operator();assert value.tx.inspect()['state']=='installed'
 return value
def volumes():
 names=run(['docker','volume','ls','-q','--filter','label=com.alica.stage2='+CELL]).splitlines();rows=json.loads(run(['docker','volume','inspect',*names]))
 assert {v['Labels']['com.docker.compose.volume'] for v in rows}==set(json.loads((ROOT/'compose.json').read_text())['volumes'])
 for v in rows:assert v['Driver']=='local' and not v.get('Options') and v['Labels']['com.docker.compose.project']==CELL and v['Mountpoint']=='/var/lib/docker/volumes/'+v['Name']+'/_data'
 return rows
def native_tasks():
 code="import json;from hermes_cli import kanban_db;c=kanban_db.connect();v=c.execute('SELECT id,session_id,status FROM tasks ORDER BY id').fetchall();c.close();print(json.dumps([list(r) for r in v]))"
 return json.loads(run(['docker','exec','--user','10000:10001',CELL+'-hermes-1','env','HERMES_HOME=/opt/data','HOME=/opt/data','PYTHONPATH=/opt/hermes','/opt/hermes/.venv/bin/python','-c',code]))
def backup(recipient):
 guard();installer();assert not OUT.exists();OUT.mkdir(mode=0o700)
 import host_operations as h
 snapshot=h.snap();assert h.healthy(snapshot) and snapshot['snapshot']['nativeWork']['observed'] and snapshot['snapshot']['nativeWork']['active']==0
 before=json.loads(run(['docker','inspect',*NAMES,REFERENCE]));assert len(before)==8
 v=volumes();tasks=native_tasks();assert all(row[2] in ('done','cancelled','failed','archived') for row in tasks)
 # This invokes the published owner-aware CLI through the real cell unit.
 run(['systemctl','stop','alica-'+CELL+'-cell.service'])
 run(['docker','stop','--time','30',REFERENCE])
 assert not run(['docker','ps','-q'])
 with lock(ROOT/'operations/operation.lock'),lock(ROOT.parent/('.'+CELL+'.install.lock')):
  e=Engine(ROOT/'operations/ops.db');e.maintenance(True);e.db.close()
  paths={'root':ROOT,'operations-code':CODE,'qa-state':q.OUT}
  for vol in v:paths['volume-'+vol['Name']]=Path(vol['Mountpoint'])
  units=OUT/'units';units.mkdir(mode=0o700)
  for role in ('cell','broker','observer'):shutil.copy2(Path('/etc/systemd/system')/('alica-'+CELL+'-'+role+'.service'),units)
  paths['units']=units
  meta={'schema':'stage7-qa3-cold-restore/v1','cell':CELL,'releaseSha256':RELEASE,'volumes':v,'containerIdsBefore':{r['Name']:r['Id'] for r in before},'paths':{k:str(v) for k,v in paths.items()},'nativeWorkObservedIdle':True,'nativeTasks':tasks,'productionAccepted':False}
  spec={'quiesced':True,'sources':meta['paths'],'metadata':meta};save(OUT/'spec.json',spec)
  receipt=archive.create(OUT/'spec.json',recipient,OUT/'backup.age');save(OUT/'backup-receipt.json',receipt);print(json.dumps(receipt))
def extract():
 guard();receipt=json.loads((OUT/'backup-receipt.json').read_text())
 # The age identity arrives via SSH stdin and is never persisted on DSH2.
 result=archive.verify(OUT/'backup.age','/dev/stdin',receipt['ciphertextSha256'],OUT/'verified')
 assert result['manifestSha256']==receipt['manifestSha256'];save(OUT/'extraction-receipt.json',result);print(json.dumps(result))
def apply():
 guard();receipt=json.loads((OUT/'backup-receipt.json').read_text());stage=OUT/'verified';assert (stage/'VERIFIED').read_text().strip()==receipt['ciphertextSha256']
 assert archive.digest(stage/'manifest.json')==receipt['manifestSha256'];m=json.loads((stage/'manifest.json').read_text());archive.validate_manifest(m)
 md=m['metadata'];assert md['cell']==CELL and md['releaseSha256']==RELEASE
 assert not run(['docker','ps','-q'])
 # Revalidate every staged entry immediately before destructive QA actions.
 for row in m['entries']:assert archive.entry(stage/row['name'],row['name'])==row
 current=volumes();assert current==md['volumes'];admitted_installer=installer();quarantine=OUT/'pre-restore';quarantine.mkdir(mode=0o700)
 restore_keys=['root','operations-code','qa-state',*['volume-'+v['Name'] for v in current]]
 assert all(Path(md['paths'][key]).stat().st_dev==quarantine.stat().st_dev for key in restore_keys)
 assert shutil.disk_usage(OUT).free>sum(row['size'] for row in m['entries'])*2
 with lock(ROOT/'operations/operation.lock'),lock(ROOT.parent/('.'+CELL+'.install.lock')):
  rows=json.loads(run(['docker','inspect',*NAMES]));assert all(r['Id']==md['containerIdsBefore'][r['Name']] and not r['State']['Running'] and r['Config']['Labels']['com.alica.stage2']==CELL for r in rows)
  run(['docker','rm',*[r['Id'] for r in rows]])
  # Preserve original complete trees; restore into new directories/inodes.
  for key in restore_keys:
   dest=Path(md['paths'][key]);assert not dest.is_symlink();os.rename(dest,quarantine/key);run(['cp','-a',str(stage/key),str(dest)])
  for row in m['entries']:
   prefix,_,rel=row['name'].partition('/');dest=Path(md['paths'][prefix])/rel
   assert archive.entry(dest,row['name'])==row,'Cold restored content/metadata mismatch'
  save(OUT/'cold-verified.json',{'byteAndMetadataVerification':True,'entries':len(m['entries']),'releaseSha256':RELEASE,'quarantineRetained':True})
 # Existing signed v2 ownership must admit newly created runtime containers.
 admitted_installer.start()
 e=Engine(ROOT/'operations/ops.db');e.maintenance(False);e.db.close()
 run(['systemctl','start','alica-'+CELL+'-cell.service']);run(['docker','start',REFERENCE])
 import host_operations as h
 end=time.monotonic()+90
 while time.monotonic()<end:
  try:
   status=h.snap()
   if h.healthy(status):break
  except (FileNotFoundError,ConnectionRefusedError):pass
  time.sleep(2)
 else:raise RuntimeError('Restored operations did not become healthy')
 rows=json.loads(run(['docker','inspect',*NAMES]));assert all(r['Id']!=md['containerIdsBefore'][r['Name']] for r in rows)
 rid=json.loads((q.OUT/'first-result.json').read_text())['receiptId'];s,value,_=q.backend('/api/v1/application/requests/'+rid);assert s==200 and value['receipt']['phase']=='result-ready'
 assert status['snapshot']['nativeWork']['observed'] and status['snapshot']['nativeWork']['active']==0
 assert native_tasks()==md['nativeTasks'],'Native task/session/status changed or business work replayed'
 result={'schema':'stage7-qa3-cold-restore-result/v1','releaseSha256':RELEASE,'ciphertextSha256':receipt['ciphertextSha256'],'allStagedAndRestoredBytesAndMetadataVerified':True,'sevenContainersRecreated':True,'nativeTasksAndSessionLinksPreserved':True,'sevenServicesHealthy':True,'existingCompletedReceiptReadable':True,'nativeWorkObservedIdle':True,'quarantineRetained':True,'passed':True,'productionAccepted':False};save(OUT/'restore-result.json',result);print(json.dumps(result))
if __name__=='__main__':
 os.umask(0o077);p=argparse.ArgumentParser();p.add_argument('action',choices=['backup','extract','apply']);p.add_argument('--recipient');a=p.parse_args()
 if a.action=='backup':assert a.recipient;backup(a.recipient)
 elif a.action=='extract':extract()
 else:apply()
