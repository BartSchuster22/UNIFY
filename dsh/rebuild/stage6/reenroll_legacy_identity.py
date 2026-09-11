"""Re-enrol legacy order-sensitive pins only after matching authenticated semantics.
Does not change application images, commands, values, mounts, roles or ownership.
"""
import hashlib,json,os,socket,subprocess,sys,time
from pathlib import Path
from identity import canonical_signature,legacy_signature
import restore_dsh2 as r
sys.path.insert(0,'/usr/local/lib/alica-dsh-ops/dsh2-stage5-qa5')
from doghouse_dsh.broker import lock,trusted

def run():
 assert os.geteuid()==0 and socket.gethostname()=='DSH2'
 root=Path('/opt/dsh2-stage5-qa5');mf=trusted(r.OUT/'restored-manifest.json');assert r.archive.digest(mf)==r.MANIFEST
 m=json.loads(mf.read_text());old={x['Name']:x for x in m['metadata']['containers']};path=trusted(root/'operations/broker.json');receipt=r.OUT/'legacy-identity-reenrollment.json'
 with lock(root/'operations/operation.lock'),lock(root.parent/('.'+root.name+'.install.lock')):
  cfg=json.loads(path.read_text());assert cfg.get('signatureSchema') is None
  assert cfg['cell']==r.CELL and cfg['ownerSha256']==r.archive.digest(trusted(root/'owner.json'))
  source_pins={s:legacy_signature(old['/'+r.CELL+'-'+s+'-1']) for s in cfg['images']}
  before=r.archive.digest(path)
  assert cfg['signatures']==source_pins or (receipt.exists() and before==json.loads(receipt.read_text())['configAfterSha256']),'Unrecognized legacy pin authority'
  new={};canonical={}
  for s,image in cfg['images'].items():
   name=r.CELL+'-'+s+'-1';a=old['/'+name];b=json.loads(r.run(['docker','inspect',name]))[0]
   assert a['Image']==b['Image']==image and b['Name']==a['Name']
   assert canonical_signature(a)==canonical_signature(b),'Actual semantic runtime drift'
   mounts=lambda x:sorted([v['Type'],v['Source'],v['Destination'],v['RW']] for v in x['Mounts'])
   assert mounts(a)==mounts(b)==cfg['mounts'][s],'Actual mount drift'
   new[s]=legacy_signature(b);canonical[s]=canonical_signature(a)
  units=['alica-'+r.CELL+'-observer.service','alica-'+r.CELL+'-broker.service']
  r.run(['systemctl','stop',*units]);cfg['signatures']=new;r.save(path,cfg)
  report={'schema':'stage6-qualified-legacy-runtime-reenrollment/v1','manifestSha256':r.MANIFEST,'configBeforeSha256':before,'configAfterSha256':r.archive.digest(path),'authenticatedSourceCanonicalPins':canonical,'servicesVerified':len(new),'onlyOrderSensitivePinsReenrolled':True,'applicationConfigurationChanged':False,'checkedAt':time.time()}
  r.save(receipt,report)
 r.run(['systemctl','start',*reversed(units)]);return report
if __name__=='__main__':print(json.dumps(run()))
