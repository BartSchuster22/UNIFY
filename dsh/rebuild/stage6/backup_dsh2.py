#!/usr/bin/env python3
"""Explicit DSH2-only cold-backup coordinator. No deletion or implicit restart."""
import argparse,contextlib,hashlib,json,os,shutil,subprocess,sys,time
from pathlib import Path
import archive
CELL='dsh2-stage5-qa5';CELLS=['dsh2-stage5-qa'+x for x in ('3','4','5')]
BUNDLE=Path('/srv/alica-dsh-qa/stage5-package-qa5');ROOT=Path('/opt')/CELL
EXPECTED='1fde4fdfeea219bbad1e61e6bcce8046b2a7f9d880218d95a660624be08cd4f6'
OUT=Path('/var/lib/alica-stage6-recovery')
def run(args):
 p=subprocess.run(args,capture_output=True,text=True,timeout=1000)
 if p.returncode:raise RuntimeError('Bounded command failed: '+args[0])
 return p.stdout.strip()
def records():
 ids=run(['docker','ps','-aq']).split();return json.loads(run(['docker','inspect',*ids])) if ids else []
def volume_records():
 names=run(['docker','volume','ls','-q']).split();return json.loads(run(['docker','volume','inspect',*names])) if names else []
def main():
 p=argparse.ArgumentParser();p.add_argument('--recipient',required=True);p.add_argument('--output',required=True);a=p.parse_args()
 assert os.geteuid()==0 and run(['hostname'])=='DSH2'
 assert archive.digest(BUNDLE/'release.json')==EXPECTED
 assert not Path(a.output).exists()
 OUT.mkdir(mode=0o700,exist_ok=True)
 sys.path.insert(0,str(BUNDLE));from install import Installer
 request=json.loads((ROOT/'operations/request.json').read_text());i=Installer(BUNDLE,EXPECTED,ROOT,request);i.operator();i.owned()
 rows=records();vols=volume_records()
 for r in rows:
  labels=r['Config'].get('Labels') or {}
  assert labels.get('com.alica.stage2') in CELLS or (r['Name']=='/dsh5-reference-qa5' and labels.get('com.alica.stage5.reference')=='qa5'),'Unowned container'
 for v in vols:
  labels=v.get('Labels') or {};assert labels.get('com.alica.stage2') in CELLS and labels.get('com.docker.compose.project')==labels['com.alica.stage2'];assert v['Driver']=='local' and not v.get('Options')
 from transaction import Transaction
 for cell in CELLS:
  root=Path('/opt')/cell;req=json.loads((root/'operations/request.json').read_text());assert req['cell']==cell
  rel=json.loads((BUNDLE.parent/('stage5-package-'+cell.rsplit('-',1)[-1])/'release.json').read_text())
  Transaction(root,req,rel).inspect()
 # Create only an explicitly disabled, far-future native schedule fixture.
 native="from cron import jobs;from hermes_cli import kanban_db;import json;matches=[j for j in jobs.list_jobs(include_disabled=True) if j.get('name')=='Stage6 disabled restore fixture'];assert len(matches)<=1;j=matches[0] if matches else jobs.create_job(prompt='Inert Stage6 restore fixture; do not run.',schedule='2099-01-01T00:00:00',name='Stage6 disabled restore fixture',deliver='local');jobs.pause_job(j['id'],reason='Stage6 restoration fence');alljobs=jobs.list_jobs(include_disabled=True);assert not jobs.list_jobs();c=kanban_db.connect();tasks=[dict(r) for r in c.execute('SELECT id,session_id,status FROM tasks ORDER BY id')];assert all(t['status'] in ('done','cancelled','failed') for t in tasks);print(json.dumps({'tasks':tasks,'jobs':alljobs}))"
 if any(r['State']['Running'] for r in rows):
  baseline=json.loads(run(['docker','exec',CELL+'-hermes-1','/opt/hermes/.venv/bin/python','-c',native]))
  (OUT/'native-before.json').write_text(json.dumps(baseline,indent=2));(OUT/'native-before.json').chmod(0o600)
 else:
  baseline=json.loads((OUT/'native-before.json').read_text())
  assert baseline['tasks'] and baseline['jobs'],'No recorded quiescence baseline'
 code=Path('/usr/local/lib/alica-dsh-ops')/CELL;sys.path.insert(0,str(code));from doghouse_dsh.broker import lock;from doghouse_dsh.engine import Engine
 with contextlib.ExitStack() as stack:
  for cell in CELLS:
   cellroot=Path('/opt')/cell;stack.enter_context(lock(cellroot/'operations/operation.lock'))
   req=json.loads((cellroot/'operations/request.json').read_text());rel=json.loads((BUNDLE.parent/('stage5-package-'+cell.rsplit('-',1)[-1])/'release.json').read_text())
   stack.enter_context(Transaction(cellroot,req,rel).locked())
   e=Engine(cellroot/'operations/ops.db');e.maintenance(True);e.db.close()
  # Retired containers can still have host-level observers: fence ALL captured cells.
  for cell in CELLS:
   run(['systemctl','stop','alica-'+cell+'-observer.service','alica-'+cell+'-broker.service'])
  for r in rows:
   if r['State']['Running'] and r['Name']=='/dsh5-reference-qa5':run(['docker','stop','--time','30',r['Id']])
  i.stop()
  assert all(not r['State']['Running'] for r in records()),'A writer is still running'
  started=time.time();sources={};units=OUT/'units';units.mkdir(mode=0o700,exist_ok=True)
  for cell in CELLS:
   sources['root-'+cell]=str(Path('/opt')/cell)
   qa=Path('/var/lib')/('alica-stage5-'+cell.rsplit('-',1)[-1]);sources['qa-'+cell]=str(qa)
   for unit in Path('/etc/systemd/system').glob('alica-'+cell+'-*.service'):
    assert not unit.is_symlink();shutil.copy2(unit,units/unit.name)
  for v in vols:sources['volume-'+v['Name']]=v['Mountpoint']
  for bundle in Path('/srv/alica-dsh-qa').glob('stage5-package-qa*'):
   assert bundle.name in ['stage5-package-qa'+n for n in ('3','4','5')]
   sources[bundle.name]=str(bundle)
  sources['operations-code']='/usr/local/lib/alica-dsh-ops'
  sources['units']=str(units);sources['qa-code']='/srv/alica-dsh-qa/qa';sources['recovery-code']=str(Path(__file__).parent)
  # Recovery metadata is encrypted alongside the data, not public receipts.
  metadata={'sourceHost':'DSH2','activeCell':CELL,'arch':run(['uname','-m']),'osRelease':Path('/etc/os-release').read_text(),'releaseSha256':EXPECTED,'roots':CELLS,'volumes':vols,'containers':rows,'nativeBefore':baseline,'consistency':'all application/database/native/observer writers stopped; lifecycle and operation locks held','quiescedAt':started,'automaticJobsEnabled':0,'sourceRetained':True,'recoveryScope':'ALICA installation and retained QA stores, not a full OS disk image'}
  spec={'quiesced':True,'sources':sources,'metadata':metadata};s=OUT/'backup-spec.json';s.write_text(json.dumps(spec));s.chmod(0o600)
  result=archive.create(s,a.recipient,a.output)
  assert all(not r['State']['Running'] for r in records())
  result.update({'sourceHost':'DSH2','cells':CELLS,'volumes':len(vols),'allWritersStopped':True,'elapsedSeconds':round(time.time()-started,3),'wholeStage6Accepted':False})
  (OUT/'backup-result.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
if __name__=='__main__':main()
