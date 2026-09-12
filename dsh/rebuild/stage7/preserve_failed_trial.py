#!/usr/bin/env python3
"""Cold encrypted safeguard of QA2 diagnostics/data before a clean QA3 trial.
DSH2-only; locks and owner labels required. Does not delete or restart anything.
"""
import contextlib,json,os,shutil,subprocess,sys
from pathlib import Path
CELL='dsh2-stage7-qa2';ROOT=Path('/opt')/CELL;BUNDLE=Path('/srv/alica-stage7-ed2f09b/bundle');OUT=Path('/var/lib/alica-stage7-qa2-safeguard')
def run(args):return subprocess.check_output(args,text=True,stderr=subprocess.PIPE).strip()
def main():
 assert os.geteuid()==0 and run(['hostname'])=='DSH2';os.umask(0o077)
 import archive
 assert archive.digest(BUNDLE/'release.json')=='f3ce059a6e2c1b575ead2fb6e6dbededa4420505285ac9220d5a9ea2b13a9da3'
 OUT.mkdir(mode=0o700,exist_ok=True);assert not any(OUT.iterdir())
 sys.path.insert(0,str(BUNDLE));from install import Installer
 req=json.loads((ROOT/'operations/request.json').read_text());i=Installer(BUNDLE,archive.digest(BUNDLE/'release.json'),ROOT,req);i.operator();i.owned()
 ids=run(['docker','ps','-aq']).split();rows=json.loads(run(['docker','inspect',*ids]));assert len(rows)==7
 assert all(r['Config']['Labels'].get('com.alica.stage2')==CELL for r in rows)
 names=run(['docker','volume','ls','-q']).split();vols=json.loads(run(['docker','volume','inspect',*names]));assert {v['Labels'].get('com.docker.compose.volume') for v in vols}==set(json.loads((ROOT/'compose.json').read_text())['volumes'])
 assert all(v['Labels'].get('com.alica.stage2')==CELL and v['Labels'].get('com.docker.compose.project')==CELL and v['Driver']=='local' and not v.get('Options') for v in vols)
 sys.path.insert(0,'/usr/local/lib/alica-dsh-ops/'+CELL);from doghouse_dsh.broker import lock;from doghouse_dsh.engine import Engine
 from transaction import Transaction
 with lock(ROOT/'operations/operation.lock'),Transaction(ROOT,req,i.release).locked():
  e=Engine(ROOT/'operations/ops.db');e.maintenance(True);e.db.close()
  for role in ('observer','broker'):run(['systemctl','stop','alica-'+CELL+'-'+role+'.service'])
  i.stop();assert not run(['docker','ps','-q'])
  units=OUT/'units';units.mkdir(mode=0o700)
  for p in Path('/etc/systemd/system').glob('alica-'+CELL+'-*.service'):assert not p.is_symlink();shutil.copy2(p,units/p.name)
  sources={'root-qa2':str(ROOT),'root-qa1':'/opt/dsh2-stage7-qa1','evidence-qa1':'/var/lib/alica-stage7-qa1','evidence-qa2':'/var/lib/alica-stage7-qa2','operations-code':'/usr/local/lib/alica-dsh-ops','units':str(units)}
  sources.update({'volume-'+v['Name']:v['Mountpoint'] for v in vols})
  spec={'quiesced':True,'sources':sources,'metadata':{'scope':'failed Stage7 QA trials only','containers':rows,'volumes':vols,'releaseSha256':archive.digest(BUNDLE/'release.json'),'artifactDownload':'https://github.com/BartSchuster22/Alica-DSH/releases/download/dsh-stage7-qa1-ed2f09b/dsh-stage7-qa1-ed2f09b-linux-amd64.tar.gz','noBusinessMilestoneExecuted':True}}
  path=OUT/'spec.json';path.write_text(json.dumps(spec))
  run(['python3',str(Path(archive.__file__)),'create','--spec',str(path),'--recipient',sys.argv[1],'--output',str(OUT/'failed-trial.age')])
  print(json.dumps({'archive':str(OUT/'failed-trial.age'),'sha256':archive.digest(OUT/'failed-trial.age'),'bytes':(OUT/'failed-trial.age').stat().st_size,'writersStopped':True,'deleted':False}))
if __name__=='__main__':main()
