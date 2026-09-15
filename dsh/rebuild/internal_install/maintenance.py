#!/usr/bin/env python3
"""Bounded signed maintenance for the existing DSH2 internal installation.

Not a licensing tool, fresh installer, or general root-adoption mechanism.
The cold checkpoint is kept fenced between backup and apply; recover restores
verified preimages. Existing installation, publisher and runtime identity are
verified before mutation. All previous artifacts remain in place.
"""
import argparse,fcntl,hashlib,importlib.util,json,os,re,shutil,socket,stat,subprocess,sys,time
from pathlib import Path
sys.dont_write_bytecode=True
CELL='dsh2-internal-onboarding1'
ROOT=Path('/opt')/CELL
ORIGIN=Path('/var/lib/alica/dsh2-internal-maintenance1/candidate3')
CONTROL=Path('/var/lib/alica/dsh2-internal-maintenance1/control4')
BOOT=Path('/usr/local/lib/alica-setup-onboarding1')
ANCHOR=Path('/etc/alica/release-trust/onboarding1/candidate-trust.json')
OLD_SHA='5a8a7f4cfa818172d637492da81a64a9fbfac3dd212c43ea5609713c5a772971'
PRIOR_PREDECESSOR_SHA='8fecaecb87f92a47a9ea427965f79525095f9b9567e92dedf6d03d403147b204'
TRUST_SHA='ac6d836bb5cd3efa6ab15832e574f1b5455aabff4273bc99331dfa7f43b5e1ac'
VERIFIER_SHA='62f39860a259a76721068b23140eca846def5acca5b728fbab26518576722547'
SERVICES={'hermes','unify-core','uniui','postgresql','keycloak','memory-v4','caddy'}
CHANGED={'hermes','unify-core','uniui'}
BASE='alica-'+CELL
UNITS=[BASE+'-observer.service',BASE+'-broker.service',BASE+'-tls.timer',BASE+'-tls.service']
CODE=Path('/usr/local/lib/alica-dsh-ops')/CELL
PLAN=Path('/var/lib/alica/dsh2-internal-onboarding1/installation-plan.json')

def require(ok,message):
 if not ok:raise RuntimeError(message)
def digest(path):
 h=hashlib.sha256()
 with Path(path).open('rb') as f:
  for b in iter(lambda:f.read(1024**2),b''):h.update(b)
 return h.hexdigest()
def load(path):return json.loads(Path(path).read_text())
def run(args,timeout=360):
 p=subprocess.run([str(a) for a in args],text=True,capture_output=True,timeout=timeout)
 if p.returncode:raise RuntimeError('Command failed: '+str(args[0])+' '+str(args[1])+': '+p.stderr[-1500:])
 return p.stdout.strip()
def module(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def private(path):
 p=Path(path);require(p.is_absolute() and not any(x.is_symlink() for x in [p,*p.parents]),'Unsafe maintenance path')
 s=p.stat();require(s.st_uid==0 and not s.st_mode&0o022,'Maintenance inputs must be root-owned and not writable by others');return p

def tree(path):
 out={};path=Path(path)
 for p in [path,*sorted(path.rglob('*'))]:
  s=p.lstat();row=[s.st_mode,s.st_uid,s.st_gid]
  if p.is_symlink():row+=['link',os.readlink(p)]
  elif p.is_file():row+=['file',digest(p)]
  elif not p.is_dir():raise RuntimeError('Nonportable file in cold checkpoint: '+str(p))
  out[str(p.relative_to(path))]=row
 return hashlib.sha256(json.dumps(out,sort_keys=True,separators=(',',':')).encode()).hexdigest()

def validate_transition(old,new,owner,request_fingerprint):
 require(new.get('schema')==old.get('schema')=='dsh-stage2-bundle/v1','Unsupported release schema')
 require(set(old['images'])==set(new['images'])==SERVICES,'Service inventory differs')
 actual={s for s in SERVICES if old['images'][s]['id']!=new['images'][s]['id']}
 require(actual==CHANGED,'Only Hermes adapter, Core and UI images may change')
 m=new.get('maintenance',{})
 require(m.get('schema')=='dsh-internal-maintenance/v1' and m.get('predecessorReleaseSha256')==OLD_SHA and m.get('cell')==CELL,'Maintenance predecessor/cell mismatch')
 require(m.get('preserveIdentities') is True and m.get('licensingReviewResumed') is False,'Identity/licensing boundary missing')
 require(re.fullmatch(r'[a-f0-9]{40}',m.get('sourceRevision','')) is not None,'Clean source revision missing')
 old_id=hashlib.sha256(json.dumps(old,sort_keys=True,separators=(',',':')).encode()).hexdigest()
 require(owner=={'schema':'dsh-stage2-owner/v1','request':request_fingerprint,'release':old_id},'Existing owner/request/release mismatch')
 for f in ['install.py','transaction.py','ops.py','render.py','frameworks.json','compose.template.json','doghouse-dsh.tar','tls_lifecycle.py','recover_owner.py']:
  require(old['files'][f]==new['files'][f],'Maintenance cannot change installer/runtime ownership code: '+f)

def upgrade_caddy(text, fenced=False):
 pattern=r'request_body\s*\{\s*max_size 1MB\s*\}'
 replacement='@workspaceUploads path /api/frameworks/*/work/files /api/v1/frameworks/*/work/files\n request_body @workspaceUploads {\n  max_size 12MB\n }\n @otherRequests not path /api/frameworks/*/work/files /api/v1/frameworks/*/work/files\n request_body @otherRequests {\n  max_size 1MB\n }'
 updated,count=re.subn(pattern,replacement,text)
 if count==0 and text.count(replacement)==1:updated=text;count=1
 require(count==1 and ' route {' in updated,'Unexpected ingress configuration; no broad body-limit change')
 if fenced:updated=updated.replace(' route {',' route {\n respond "DSH maintenance; retry shortly" 503',1)
 return updated

def final_ingress_signature(before,after,fingerprint):
 # Compose recreations can change these two bookkeeping labels only. All
 # execution fields, the actual image, container name and mounts remain pinned.
 projected=json.loads(json.dumps(after))
 for key in ['com.docker.compose.depends_on','com.docker.compose.replace']:
  prior=before['Config']['Labels']
  if key in prior:projected['Config']['Labels'][key]=prior[key]
  else:projected['Config']['Labels'].pop(key,None)
 require(fingerprint(projected)==fingerprint(before),'Final ingress execution configuration changed')
 require(before['Image']==after['Image'] and before['Name']==after['Name'],'Final ingress identity changed')
 mounts=lambda r:sorted((m['Type'],m['Source'],m['Destination'],m['RW']) for m in r['Mounts'])
 require(mounts(before)==mounts(after),'Final ingress mounts changed')
 return fingerprint(after)

def context(candidate):
 require(os.geteuid()==0 and socket.gethostname()=='DSH2','Designated DSH2 root operator required')
 candidate=private(candidate);private(ROOT);private(ANCHOR);private(BOOT/'release_trust.py')
 require(digest(ANCHOR)==TRUST_SHA and digest(BOOT/'release_trust.py')==VERIFIER_SHA,'External trust/verifier pin mismatch')
 rt=module('maintenance_release_trust',BOOT/'release_trust.py')
 prior=rt.verify(load(ORIGIN/'candidate-envelope.json'),load(ANCHOR),ORIGIN/'bundle',PRIOR_PREDECESSOR_SHA,2,'qa')
 require(prior['releaseSha256']==OLD_SHA and prior['sequence']==3,'Unexpected installed admission')
 CONTROL.mkdir(parents=True,exist_ok=True,mode=0o700)
 state=load(private(CONTROL/'authority.json'))
 require(state['highestAttempt']>=3,'Previous attempt authority must be retained')
 env=load(candidate/'candidate-envelope.json')
 # Read-only re-verification uses the installed predecessor; apply additionally consumes the sequence.
 admitted=rt.verify(env,load(ANCHOR),candidate/'bundle',OLD_SHA,3,'qa')
 old=load(ORIGIN/'bundle/release.json');new=load(candidate/'bundle/release.json')
 sys.path.insert(0,str(ORIGIN/'bundle'));from install import Installer
 old_i=Installer(ORIGIN/'bundle',OLD_SHA,ROOT,load(ROOT/'operations/request.json'))
 new_i=Installer(candidate/'bundle',admitted['releaseSha256'],ROOT,old_i.r)
 sys.path.insert(0,str(CODE));from doghouse_dsh.broker import Broker,lock
 from doghouse_dsh.engine import Engine
 from transaction import atomic_json
 return locals()

def collect(c):
 from doghouse_dsh.broker import Broker
 b=Broker(ROOT/'operations/broker.json')
 try:return b.collect()
 finally:b.e.db.close()
def verified_runtime(c):
 s=collect(c)
 require(s['ownershipVerified'] and set(s['services'])==SERVICES and all(x['state']=='healthy' for x in s['services'].values()),'Runtime ownership/health verification failed')
 return s

def maintenance(on):
 from doghouse_dsh.engine import Engine
 e=Engine(ROOT/'operations/ops.db');e.maintenance(on);e.db.close()
def checkpoint(j,phase):
 from transaction import atomic_json
 j['phase']=phase;j['updatedAt']=time.time();atomic_json(CONTROL/'journal.json',j)
def healthy(i):
 i.deadline=time.monotonic()+600
 rows=i.owned()
 require({r['Config']['Labels']['com.docker.compose.service']:r['Image'] for r in rows}=={s:x['id'] for s,x in i.release['images'].items()},'Running image inventory differs')
 require(all(r['State']['Running'] and r['State'].get('Health',{}).get('Status')=='healthy' for r in rows),'Runtime health not verified')
def paths():
 result={'root':ROOT,'bootstrap':BOOT,'plan':PLAN}
 for suffix in ['alica-data','caddy-config','caddy-data','memory-data','postgresql-data']:
  name=CELL+'_'+suffix;v=json.loads(run(['docker','volume','inspect',name]))[0]
  require(v['Driver']=='local' and not v.get('Options') and v['Labels'].get('com.alica.stage2')==CELL,'Unowned volume')
  result[suffix]=Path(v['Mountpoint'])
 for suffix in ['cell.service','tls.service']:
  p=Path('/etc/systemd/system')/(BASE+'-'+suffix);private(p);result['unit-'+suffix]=p
 return result

def stop(i):
 run(['systemctl','stop',*UNITS]);maintenance(True)
 i.compose('stop','--timeout','40')
 require(not any(r['State']['Running'] for r in i.owned()),'Installation writer remains')
def finish():
 maintenance(False);run(['systemctl','daemon-reload']);run(['systemctl','start',BASE+'-broker.service',BASE+'-observer.service',BASE+'-tls.timer'])

def backup(c):
 require(not (CONTROL/'journal.json').exists(),'Existing maintenance transaction: recover or inspect it first')
 require(c['state']['releaseSha256']==OLD_SHA and c['admitted']['sequence']>c['state']['highestAttempt'],'Release replay or foreign installed state')
 c['old_i'].tx.inspect();validate_transition(c['old'],c['new'],load(ROOT/'owner.json'),c['old_i'].tx.identity['request'])
 s=collect(c);require(s['ownershipVerified'] and all(x['state']=='healthy' for x in s['services'].values()),'Healthy owned cell required')
 require(s['nativeWork']['observed'] and s['nativeWork']['active']==0,'Native work must be observed idle before maintenance')
 require(shutil.disk_usage('/').free>12*1024**3,'At least 12 GiB free before maintenance backup')
 run(['docker','load','-i',c['candidate']/'bundle/images.tar'],timeout=600)
 job=CONTROL/'checkpoint';job.mkdir(mode=0o700)
 j={'schema':'dsh-maintenance-transaction/v1','phase':'admitted','candidate':str(c['candidate']),'before':c['state'],'admission':c['admitted'],'paths':{k:str(v) for k,v in paths().items()},'snapshot':str(job),'startedAt':time.time()}
 c['atomic_json'](CONTROL/'authority.json',{**c['state'],'highestAttempt':c['admitted']['sequence']});checkpoint(j,'admitted')
 try:
  stop(c['old_i']);checkpoint(j,'quiesced');hashes={}
  for name,path in paths().items():
   before=tree(path);run(['cp','-a','--reflink=auto',path,job/name]);require(tree(job/name)==before,'Cold checkpoint verification failed');hashes[name]=before
  j['coldHashes']=hashes;checkpoint(j,'snapshotted')
 except BaseException:
  # No configuration/schema was changed by backup. Restart the original installation.
  c['old_i'].deadline=time.monotonic()+600;c['old_i'].compose('up','-d','--wait','--wait-timeout','240');finish();checkpoint(j,'backup-failed-old-running');raise
 return {'phase':j['phase'],'checkpoint':str(job),'coldTreesVerified':len(hashes),'servicesFenced':True}

def apply(c):
 j=load(CONTROL/'journal.json');require(j['phase']=='snapshotted' and j['candidate']==str(c['candidate']),'Verified fenced checkpoint required')
 require(j['admission']['releaseSha256']==c['admitted']['releaseSha256'] and j['admission']['sequence']==c['admitted']['sequence'],'Candidate admission changed after backup')
 require(c['state']['releaseSha256']==OLD_SHA and c['state']['highestAttempt']==j['admission']['sequence'],'Maintenance authority changed after backup')
 require(not any(r['State']['Running'] for r in c['old_i'].owned()),'Writer restarted after checkpoint')
 for name,h in j['coldHashes'].items():
  require(tree(Path(j['snapshot'])/name)==h,'Checkpoint changed')
  require(tree(Path(j['paths'][name]))==h,'Installation changed after the fenced checkpoint')
 require((CONTROL/'offhost-backup-verified.json').is_file(),'Verified encrypted off-host backup receipt required')
 receipt=load(CONTROL/'offhost-backup-verified.json');require(receipt.get('checkpointHashes')==j['coldHashes'] and receipt.get('decryptionVerified') is True,'Off-host backup receipt mismatch')
 try:
  validate_transition(c['old'],c['new'],load(ROOT/'owner.json'),c['old_i'].tx.identity['request'])
  ingress=upgrade_caddy((ROOT/'Caddyfile').read_text())
  write(ROOT/'Caddyfile',upgrade_caddy((ROOT/'Caddyfile').read_text(),True).encode(),0o644)
  env=dict(line.split('=',1) for line in (ROOT/'.env').read_text().splitlines())
  keys=__import__('install').KEYS
  for role in CHANGED:env[keys[role]]=c['new']['images'][role]['id']
  env['ALICA_RELEASE_ID']=c['new']['release'];env['DSH_HERMES_OCI_REF']=c['new']['images']['hermes']['oci_reference']
  write(ROOT/'.env',''.join(k+'='+v+'\n' for k,v in env.items()).encode(),0o600)
  c['atomic_json'](ROOT/'owner.json',c['new_i'].tx.identity);c['new_i'].tx.inspect();checkpoint(j,'identity-transitioned')
  # Candidate contains the full, immutable migration inventory. Only 020 is new.
  c['new_i'].deadline=time.monotonic()+600
  c['new_i'].compose('up','-d','--wait','--wait-timeout','120','postgresql')
  c['new_i'].compose('--profile','jobs','run','--rm','--no-deps','migrate')
  run(['docker','exec',CELL+'-postgresql-1','psql','-v','ON_ERROR_STOP=1','-U','unify_bootstrap','-d','unify','-c','GRANT SELECT, INSERT, UPDATE, DELETE ON user_time_preferences TO unify;'])
  checkpoint(j,'migrated')
  c['new_i'].compose('up','-d','--wait','--wait-timeout','240')
  c['new_i'].compose('--profile','jobs','run','--rm','--no-deps','reconcile-frameworks')
  healthy(c['new_i'])
  from doghouse_dsh.identity import canonical_signature,SCHEMA
  cfg=load(ROOT/'operations/broker.json');rows={r['Config']['Labels']['com.docker.compose.service']:r for r in c['new_i'].owned()}
  cfg.update(ownerSha256=digest(ROOT/'owner.json'),images={s:r['Image'] for s,r in rows.items()},signatures={s:canonical_signature(r) for s,r in rows.items()},signatureSchema=SCHEMA)
  require(cfg['mounts']=={s:[list(x) for x in sorted((m['Type'],m['Source'],m['Destination'],m['RW']) for m in r['Mounts'])] for s,r in rows.items()},'Mounted identity changed')
  c['atomic_json'](ROOT/'operations/broker.json',cfg)
  for suffix in ['cell.service','tls.service']:
   p=Path('/etc/systemd/system')/(BASE+'-'+suffix);text=p.read_text();require(str(ORIGIN/'bundle') in text and OLD_SHA in text,'Lifecycle pin differs')
   write(p,text.replace(str(ORIGIN/'bundle'),str(c['candidate']/'bundle')).replace(OLD_SHA,c['admitted']['releaseSha256']).encode(),0o644)
  write(BOOT/'setup.py',(c['candidate']/'bundle/setup.py').read_bytes(),0o644)
  plan=load(PLAN);plan.update(destination=str(c['candidate']),runtimeRelease=c['admitted']['releaseSha256'],bootstrapSha256=digest(BOOT/'setup.py'),maintenanceSourceRevision=c['new']['maintenance']['sourceRevision'],maintenanceJournal=str(CONTROL/'journal.json'))
  c['atomic_json'](PLAN,plan)
  s=collect(c);require(s['ownershipVerified'] and all(x['state']=='healthy' for x in s['services'].values()),'New runtime ownership/health failed')
  require(tree(ROOT/'secrets')==tree(Path(j['snapshot'])/'root/secrets'),'Owner/transport secrets changed')
  require(digest(ORIGIN/'bundle/release.json')==OLD_SHA,'Predecessor artifact changed')
  c['atomic_json'](CONTROL/'authority.json',{'releaseSha256':c['admitted']['releaseSha256'],'sequence':c['admitted']['sequence'],'highestAttempt':c['admitted']['sequence']})
  checkpoint(j,'committed')
  write(ROOT/'Caddyfile',ingress.encode(),0o644)
  c['new_i'].compose('up','-d','--no-deps','--force-recreate','--wait','--wait-timeout','120','caddy')
  final_rows={r['Config']['Labels']['com.docker.compose.service']:r for r in c['new_i'].owned()}
  for service in SERVICES-{'caddy'}:
   require(canonical_signature(final_rows[service])==cfg['signatures'][service] and final_rows[service]['Image']==cfg['images'][service],'Non-ingress identity changed during ingress recreation')
  cfg['signatures']['caddy']=final_ingress_signature(rows['caddy'],final_rows['caddy'],canonical_signature)
  c['atomic_json'](ROOT/'operations/broker.json',cfg)
  s=collect(c);require(s['ownershipVerified'] and all(x['state']=='healthy' for x in s['services'].values()),'Final ingress ownership/health failed')
  finish();healthy(c['new_i'])
  return {'phase':'committed','releaseSha256':c['admitted']['releaseSha256'],'images':cfg['images'],'ownerTransportSecretsPreserved':True,'mountsPreserved':True,'licensingReviewResumed':False}
 except BaseException:
  recover(c);raise

def write(path,content,mode):
 p=Path(path);tmp=p.with_name(p.name+'.maintenance-new')
 fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
 try:
  with os.fdopen(fd,'wb') as f:f.write(content);f.flush();os.fsync(f.fileno())
  os.replace(tmp,p)
  d=os.open(p.parent,os.O_RDONLY|os.O_DIRECTORY)
  try:os.fsync(d)
  finally:os.close(d)
 finally:
  if tmp.exists():tmp.unlink()

def recover(c):
 j=load(CONTROL/'journal.json')
 if j['phase'] in ['committed','rolled-back','backup-failed-old-running']:return {'phase':j['phase'],'changed':False}
 if j['phase'] in ['admitted','quiesced'] and not j.get('coldHashes'):
  c['old_i'].tx.inspect()
  c['old_i'].deadline=time.monotonic()+600;c['old_i'].compose('up','-d','--wait','--wait-timeout','240');healthy(c['old_i']);finish()
  checkpoint(j,'backup-failed-old-running')
  return {'phase':'backup-failed-old-running','dataRestored':False}
 require(j.get('coldHashes'),'Incomplete checkpoint: original installation must be inspected; no destructive restore')
 saved=Path(j['snapshot']);require(saved==CONTROL/'checkpoint','Unexpected checkpoint path')
 expected=paths();require(j['paths']=={k:str(v) for k,v in expected.items()},'Restore destination changed')
 for name,h in j['coldHashes'].items():require(tree(saved/name)==h,'Restore preimage changed')
 require(load(ROOT/'owner.json') in [c['old_i'].tx.identity,c['new_i'].tx.identity],'Cannot restore over a foreign owner')
 stop(c['old_i']);checkpoint(j,'rolling-back')
 # Retain failed candidate state alongside each restored tree; no blanket deletion.
 for name,dest in expected.items():
  if tree(dest)==j['coldHashes'][name]:continue
  rejected=dest.with_name(dest.name+'.maintenance-rejected');require(not rejected.exists(),'Previous failed restore needs operator inspection')
  os.rename(dest,rejected);run(['cp','-a',saved/name,dest]);require(tree(dest)==j['coldHashes'][name],'Restored tree differs')
 c['old_i'].deadline=time.monotonic()+600;c['old_i'].compose('up','-d','--wait','--wait-timeout','240');healthy(c['old_i'])
 c['atomic_json'](CONTROL/'authority.json',{**j['before'],'highestAttempt':j['admission']['sequence']});checkpoint(j,'rolled-back');finish()
 return {'phase':'rolled-back','coldDataRestored':True}

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('action',choices=['plan','backup','apply','recover','verify']);p.add_argument('--candidate',required=True);a=p.parse_args();c=context(a.candidate)
 from doghouse_dsh.broker import lock
 with lock(CONTROL/'writer.lock'),lock(ROOT/'operations/operation.lock'),lock(ROOT.parent/('.'+CELL+'.install.lock')):
  if a.action=='plan':
   c['old_i'].tx.inspect();validate_transition(c['old'],c['new'],load(ROOT/'owner.json'),c['old_i'].tx.identity['request']);result={'signedAdmission':c['admitted'],'runtimeMutations':False,'controlDirectoryCreatedIfAbsent':True,'changedServices':sorted(CHANGED),'runtime':collect(c)}
  elif a.action=='verify':
   c['new_i'].tx.inspect();healthy(c['new_i']);result={'authority':load(CONTROL/'authority.json'),'runtime':verified_runtime(c)}
  else:result=globals()[a.action](c)
 print(json.dumps(result,sort_keys=True,indent=2))
if __name__=='__main__':main()
