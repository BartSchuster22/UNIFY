#!/usr/bin/env python3
"""Pre-Stage7 predecessor safeguard; exact QA5 scope plus Stage6 trust/counters.
Derived from Stage6 backup coordinator. No deletion or implicit restart.
"""
import argparse,contextlib,hashlib,json,os,shutil,subprocess,sys,time
from pathlib import Path
sys.path.insert(0,'/usr/local/lib/alica-recovery-stage6')
import archive
CELL='dsh2-stage5-qa5';CELLS=['dsh2-stage5-qa'+x for x in ('3','4','5')]
BUNDLE=Path('/srv/alica-dsh-qa/stage5-package-qa5');ROOT=Path('/opt')/CELL
EXPECTED='1fde4fdfeea219bbad1e61e6bcce8046b2a7f9d880218d95a660624be08cd4f6'
OUT=Path('/var/lib/alica-stage7-predecessor')
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
 # Read-only native baseline: never create/edit schedules for a backup.
 native="from cron import jobs;from hermes_cli import kanban_db;import json;alljobs=jobs.list_jobs(include_disabled=True);assert not jobs.list_jobs();c=kanban_db.connect();tasks=[dict(r) for r in c.execute('SELECT id,session_id,status FROM tasks ORDER BY id')];assert all(t['status'] in ('done','cancelled','failed','archived') for t in tasks);print(json.dumps({'tasks':tasks,'jobs':alljobs}))"
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
   for role in ('observer','broker'):
    unit='alica-'+cell+'-'+role+'.service'
    load=run(['systemctl','show',unit,'-p','LoadState','--value'])
    if cell==CELL:assert load=='loaded','Active cell unit missing'
    if load=='not-found':
     assert cell!=CELL and run(['systemctl','show',unit,'-p','ActiveState','--value'])=='inactive'
    else:
     assert load=='loaded';run(['systemctl','stop',unit])
     assert run(['systemctl','show',unit,'-p','ActiveState','--value'])=='inactive'
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
  # Preserve current trust, counter high-water mark and rollback snapshots too.
  control=Path('/var/lib/alica-stage6-recovery/update-control')
  state=json.loads((control/'state.json').read_text());assert state['sequence']==5 and state['highestAttempt']==6
  assert json.loads((control/'journal.json').read_text())['phase']=='rolled-back'
  sources['stage6-update-control']=str(control)
  sources['stage6-release-trust']='/etc/alica-release-trust'
  sources['stage6-recovery-code']='/usr/local/lib/alica-recovery-stage6'
  saved=OUT/'stage6-root-metadata';saved.mkdir(mode=0o700)
  for f in Path('/var/lib/alica-stage6-recovery').glob('*.json'):
   assert f.is_file() and not f.is_symlink();shutil.copy2(f,saved/f.name)
  sources['stage6-root-metadata']=str(saved)
  # Recovery metadata is encrypted alongside the data, not public receipts.
  metadata={'sourceHost':'DSH2','activeCell':CELL,'arch':run(['uname','-m']),'osRelease':Path('/etc/os-release').read_text(),'releaseSha256':EXPECTED,'roots':CELLS,'volumes':vols,'containers':rows,'nativeBefore':baseline,'consistency':'all application/database/native/observer writers stopped; lifecycle and operation locks held','quiescedAt':started,'automaticJobsEnabled':0,'sourceRetained':True,'recoveryScope':'ALICA installation and retained QA stores, not a full OS disk image'}
  spec={'quiesced':True,'sources':sources,'metadata':metadata};s=OUT/'backup-spec.json';s.write_text(json.dumps(spec));s.chmod(0o600)
  result=archive.create(s,a.recipient,a.output)
  assert all(not r['State']['Running'] for r in records())
  result.update({'sourceHost':'DSH2','cells':CELLS,'volumes':len(vols),'allWritersStopped':True,'elapsedSeconds':round(time.time()-started,3),'stage7Accepted':False,'installedSequencePreserved':state['sequence'],'highestAttemptPreserved':state['highestAttempt']})
  (OUT/'backup-result.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
if __name__=='__main__':main()

