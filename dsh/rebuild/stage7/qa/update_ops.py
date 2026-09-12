"""QA3-only transactional host-operations update; v2-to-v2 preservation only. Runtime image changes denied.
Candidate code is admitted before execution. Rollback restores cold data, not
merely binaries. Interrupted transactions remain fenced until explicit recover.
"""
import argparse,contextlib,hashlib,json,os,shutil,socket,subprocess,sys,time,uuid
from pathlib import Path
import release_trust as trust
import restore_context as r
import logical_state
CELL=r.CELL;ROOT=Path('/opt')/CELL;CODE=Path('/usr/local/lib/alica-dsh-ops')/CELL
CONTROL=r.OUT/'update-control';STATE=CONTROL/'state.json';JOURNAL=CONTROL/'journal.json';TRUST=Path('/srv/alica-stage7-2772d9c/candidate-trust.json')
sys.path.insert(0,str(CODE))
from doghouse_dsh.broker import lock
from doghouse_dsh.engine import Engine
SERVICES=['postgresql','keycloak','hermes','memory-v4','unify-core','uniui','caddy']
CONTAINERS=[CELL+'-'+s+'-1' for s in SERVICES]+['dsh7-reference-qa3']
UNITS=['alica-'+CELL+'-observer.service','alica-'+CELL+'-broker.service']

def guard():
 assert os.geteuid()==0 and socket.gethostname()=='DSH2'
 r.guard()
 assert trust.digest(r.OUT/'verified/manifest.json')==r.MANIFEST
 cfg=trust.load(ROOT/'operations/broker.json');assert cfg['ownerSha256']==trust.digest(ROOT/'owner.json')
 assert set(cfg['images'])==set(SERVICES)
 return cfg

def native_quiescent():
 script="from cron import jobs;from hermes_cli import kanban_db;c=kanban_db.connect();assert all(j.get('paused') is True or j.get('enabled') is False for j in jobs.list_jobs());assert all(r[0] in ('done','cancelled','failed','archived') for r in c.execute('SELECT status FROM tasks'));print('quiescent')"
 assert r.run(['docker','exec',CELL+'-hermes-1','/opt/hermes/.venv/bin/python','-c',script])=='quiescent'

def schema():
 value=logical_state.snapshot();raw=r.run(['docker','exec',CELL+'-postgresql-1','pg_dump','--schema-only','--no-owner','--no-privileges','-U','unify_bootstrap','-d','unify'])
 stable='\n'.join(s for s in raw.splitlines() if not s.startswith(('--','\\restrict','\\unrestrict')))
 value['postgresqlSchemaSha256']=hashlib.sha256(stable.encode()).hexdigest();return value

def maintenance(on):
 e=Engine(ROOT/'operations/ops.db');e.maintenance(on);e.db.close()

def stop():
 r.run(['systemctl','stop',*UNITS]);maintenance(True)
 r.run(['docker','stop','--time','30',*CONTAINERS])
 assert not r.run(['docker','ps','-q']),'Unexpected writer remains'

def start_services():
 r.run(['docker','start',*CONTAINERS[:-1]])
 end=time.monotonic()+240
 while time.monotonic()<end:
  rows=json.loads(r.run(['docker','inspect',*CONTAINERS[:-1]]))
  if all(x['State']['Running'] and x['State'].get('Health',{}).get('Status')=='healthy' for x in rows):return
  time.sleep(2)
 raise RuntimeError('Candidate health failed')

def finish():
 maintenance(False);r.run(['docker','start',CONTAINERS[-1]]);r.run(['systemctl','start',*reversed(UNITS)])

def sources():
 value={'operations':ROOT/'operations','code':CODE,'reference-data':Path('/var/lib/alica-stage7-qa3/reference-data')}
 cfg=guard()
 for suffix in ['alica-data','caddy-config','caddy-data','memory-data','postgresql-data']:
  name=CELL+'_'+suffix;v=json.loads(r.run(['docker','volume','inspect',name]))[0]
  assert v['Driver']=='local' and not v.get('Options') and v['Labels']['com.alica.stage2']==CELL
  value[suffix]=Path(v['Mountpoint'])
 return value

def tree(path):
 out={}
 for p in [path,*sorted(path.rglob('*'))]:
  s=p.lstat();key=str(p.relative_to(path));row=[s.st_mode,s.st_uid,s.st_gid]
  if p.is_symlink():row+=['link',os.readlink(p)]
  elif p.is_file():row+=['file',trust.digest(p)]
  elif not p.is_dir():raise RuntimeError('Nonportable file in cold snapshot')
  out[key]=row
 return hashlib.sha256(trust.canonical(out)).hexdigest()

def save(j,phase):j['phase']=phase;j['updatedAt']=time.time();r.save(JOURNAL,j)

def apply(bundle,envelope,fault):
 cfg=guard();CONTROL.mkdir(mode=0o700,exist_ok=True)
 with lock(ROOT/'operations/operation.lock'),lock(ROOT.parent/('.'+CELL+'.install.lock')),lock(CONTROL/'writer.lock'):
  if JOURNAL.exists():assert trust.load(JOURNAL)['phase'] in ('committed','rolled-back'),'Recover incomplete transaction first'
  state=trust.load(STATE)
  anchor=trust.owned(TRUST);assert Path(bundle).resolve() not in anchor.resolve().parents
  admitted=trust.verify(trust.load(envelope),trust.load(anchor),bundle,state['releaseSha256'],state['highestAttempt'],'qa')
  desc=trust.load(Path(bundle)/'release.json')
  assert set(desc)=={'schema','sourceRevision','baseReleaseSha256','runtimeImages','mapping','targetSignatureSchema','platform'}
  assert desc['schema']=='alica-qa3-host-operations-release/v1' and desc['baseReleaseSha256']==r.RELEASE
  assert desc['runtimeImages']==cfg['images'] and desc['mapping']=={'identities':'preserve','channels':'preserve','schedules':'preserve'}
  assert desc['targetSignatureSchema']=='alica-runtime-identity/v2' and desc['platform']=='ubuntu-26.04/docker-29.1.3/overlay2/linux-amd64'
  import compatibility
  compatibility.inspect()
  assert STATE.exists() and cfg.get('signatureSchema')=='alica-runtime-identity/v2','Initialized v2 authority required'
  from doghouse_dsh.broker import Broker
  broker=Broker(ROOT/'operations/broker.json')
  broker.verify_identity(json.loads(r.run(['docker','inspect',*[CELL+'-'+s+'-1' for s in SERVICES]])));broker.e.db.close()
  native_quiescent();before=schema();paths=sources();job=CONTROL/('tx-'+uuid.uuid4().hex);job.mkdir(mode=0o700)
  j={'id':job.name,'phase':'admitted','before':state,'admission':admitted,'snapshot':str(job),'paths':{k:str(v) for k,v in paths.items()},'logicalBefore':before,'startedAt':time.time(),'fault':fault,'wholeStage7Accepted':False}
  state={**state,'highestAttempt':admitted['sequence']};r.save(STATE,state);save(j,'admitted')
  try:
   stop();save(j,'quiesced');hashes={}
   for name,p in paths.items():
    h=tree(p);r.run(['cp','-a','--reflink=auto',str(p),str(job/name)]);assert tree(job/name)==h;hashes[name]=h
   j['coldHashes']=hashes;save(j,'snapshotted')
   # Private verified copy; candidate files cannot change underneath activation.
   candidate=job/'candidate';shutil.copytree(bundle,candidate)
   assert trust.inventory(candidate)==trust.load(envelope)['payload']['artifacts']
   shutil.rmtree(CODE/'doghouse_dsh');shutil.copytree(candidate/'doghouse_dsh',CODE/'doghouse_dsh')
   # Load only the now-authenticated identity module in an isolated subprocess.
   script="import json,sys;from pathlib import Path;sys.path.insert(0,"+repr(str(CODE))+");from doghouse_dsh.identity import canonical_signature,SCHEMA;import subprocess;p=Path("+repr(str(ROOT/'operations/broker.json'))+");c=json.loads(p.read_text());rows=json.loads(subprocess.check_output(['docker','inspect',*['"+CELL+"-'+s+'-1' for s in c['images']]],text=True));c['signatures']={s:canonical_signature(row) for s,row in zip(c['images'],rows)};c['signatureSchema']=SCHEMA;print(json.dumps(c))"
   new=json.loads(r.run(['python3','-B','-I','-c',script]));r.save(ROOT/'operations/broker.json',new);save(j,'candidate-installed')
   if fault=='interrupt':os._exit(99)
   if fault=='schema':
    import sqlite3
    p=paths['memory-data']/logical_state.SPECS['memory-v4'][1];assert p.is_file()
    c=sqlite3.connect(p);c.execute('CREATE TABLE stage7_failed_migration_probe(id INTEGER)');c.commit();c.close()
    j['schemaFaultAppliedToExistingDatabase']=True;save(j,'candidate-installed')
   start_services();save(j,'health-checking')
   if fault=='health':
    r.run(['docker','stop','--time','10',CELL+'-caddy-1'])
    j['healthFaultContainerStopped']=True;save(j,'health-checking')
   assert schema()==before,'Schema or durable logical data changed'
   probe="import sys,json;sys.path.insert(0,"+repr(str(CODE))+");from doghouse_dsh.broker import Broker;b=Broker("+repr(str(ROOT/'operations/broker.json'))+");s=b.collect();assert s['ownershipVerified'] and all(x['state']=='healthy' for x in s['services'].values());assert s['nativeWork']['observed'] and s['nativeWork']['active']==0;b.e.db.close();print('verified')"
   assert r.run(['python3','-B','-I','-c',probe])=='verified'
   finish()
   r.save(STATE,{'releaseSha256':admitted['releaseSha256'],'sequence':admitted['sequence'],'highestAttempt':admitted['sequence']})
   save(j,'committed')
  except Exception as exc:
   j['failureType']=type(exc).__name__;save(j,j['phase']);rollback_locked(j);finish();raise
 return trust.load(JOURNAL)

def rollback_locked(j):
 # No destructive rollback until the complete cold preimage is verified.
 assert j.get('coldHashes'),'No complete snapshot: remain fenced for operator recovery'
 job=Path(j['snapshot']);assert job.parent==CONTROL and job.name.startswith('tx-')
 for name,h in j['coldHashes'].items():assert tree(job/name)==h,'Rollback preimage modified'
 stop();save(j,'rolling-back')
 for name,dest in j['paths'].items():
  p=Path(dest);assert p==sources()[name],'Rollback destination changed'
  shutil.rmtree(p);r.run(['cp','-a',str(job/name),str(p)]);assert tree(p)==j['coldHashes'][name]
 j['coldDataRestoredByteForByte']=True
 previous={**j['before'],'highestAttempt':max(j['admission']['sequence'],j['before']['highestAttempt'])};r.save(STATE,previous)
 start_services();assert schema()==j['logicalBefore'],'Rollback logical/schema check failed';save(j,'rolled-back')

def recover():
 guard()
 with lock(ROOT/'operations/operation.lock'),lock(ROOT.parent/('.'+CELL+'.install.lock')),lock(CONTROL/'writer.lock'):
  j=trust.load(JOURNAL);assert j['phase'] not in ('committed','rolled-back')
  rollback_locked(j);finish()
 return trust.load(JOURNAL)

def main():
 p=argparse.ArgumentParser();p.add_argument('action',choices=['apply','recover']);p.add_argument('--bundle');p.add_argument('--envelope');p.add_argument('--fault',choices=['none','interrupt','health','schema'],default='none');a=p.parse_args()
 result=apply(a.bundle,a.envelope,a.fault) if a.action=='apply' else recover();print(json.dumps({k:result[k] for k in ('id','phase','wholeStage7Accepted')}))
if __name__=='__main__':main()
