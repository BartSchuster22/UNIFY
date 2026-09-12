#!/usr/bin/env python3
"""Remove only encrypted-and-offhost-verified QA2 Docker objects. Keep roots/archive."""
import hashlib,json,os,subprocess
from pathlib import Path
CELL='dsh2-stage7-qa2';BACKUP=Path('/var/lib/alica-stage7-qa2-safeguard')
def run(args):return subprocess.check_output(args,text=True,stderr=subprocess.PIPE).strip()
def main():
 assert os.geteuid()==0 and run(['hostname'])=='DSH2'
 h=hashlib.sha256()
 with (BACKUP/'failed-trial.age').open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 assert h.hexdigest()=='d549d60851f0e7cafd63f6f69a06153dcfbce28afe16dc41ccd9481032d923b2'
 spec=json.loads((BACKUP/'spec.json').read_text());assert spec['quiesced']
 meta=spec['metadata'];assert not run(['docker','ps','-q'])
 ids=run(['docker','ps','-aq']).split();rows=json.loads(run(['docker','inspect',*ids]));assert {r['Id'] for r in rows}=={r['Id'] for r in meta['containers']}
 assert all(r['Config']['Labels'].get('com.alica.stage2')==CELL and not r['State']['Running'] for r in rows)
 names=run(['docker','volume','ls','-q']).split();assert set(names)=={v['Name'] for v in meta['volumes']}
 vols=json.loads(run(['docker','volume','inspect',*names]));assert all(v['Labels'].get('com.alica.stage2')==CELL for v in vols)
 release=json.loads(Path('/srv/alica-stage7-ed2f09b/bundle/release.json').read_text())
 images=set(run(['docker','image','ls','-aq','--no-trunc']).split());assert images<={v['id'] for v in release['images'].values()}
 units=['alica-'+CELL+'-'+role+'.service' for role in ('cell','broker','observer')]
 run(['systemctl','stop',*units]);run(['systemctl','disable',*units])
 run(['docker','rm',*ids]);run(['docker','volume','rm',*names])
 networks=run(['docker','network','ls','-q','--filter','label=com.docker.compose.project='+CELL]).split()
 if networks:run(['docker','network','rm',*networks])
 for image in images:run(['docker','image','rm',image])
 for args in [('ps','-aq'),('volume','ls','-q'),('image','ls','-aq')]:assert not run(['docker',*args])
 print(json.dumps({'cleanDockerVerified':True,'onlyArchivedQa2ObjectsRemoved':True,'failedRootsAndEncryptedArchiveRetained':True}))
if __name__=='__main__':main()
