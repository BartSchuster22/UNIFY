#!/usr/bin/env python3
"""Live guest-only operations tests. Refuses shared hosts; never reboots anything.
This suite does NOT qualify provider/callback/business/reboot cases by itself.
"""
import hashlib,json,os,socket,subprocess,time,uuid
from pathlib import Path
CELL=os.environ.get('DSH_STAGE7_QA_CELL','dsh2-stage7-qa3')
assert CELL=='dsh2-stage7-qa3'
ROOT=Path('/opt')/CELL
OUT=Path('/var/lib/alica-stage7-'+CELL.rsplit('-',1)[-1]+'/host-operations.json')
from qa_host import assert_qa_host
assert_qa_host()
assert json.loads((ROOT/'transaction.json').read_text())['state']=='installed'
C=json.loads((ROOT/'operations/broker.json').read_text())
assert C['cell']==CELL and C['root']==str(ROOT)
RESULT={'schema':'stage7-live-host-qa/v1','bootId':Path('/proc/sys/kernel/random/boot_id').read_text().strip(),'cases':[],'complete':False}
OUT.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
def save():OUT.write_text(json.dumps(RESULT,indent=2))
def cmd(args,timeout=60):
 p=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
 if p.returncode:raise AssertionError('command-failed:'+args[0])
 return p.stdout

def request(op='snapshot',**kw):
 with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as s:
  s.settimeout(55);s.connect(C['socket']);s.sendall(json.dumps({'version':1,'op':op,**kw}).encode()+b'\n');data=b''
  while not data.endswith(b'\n'):
   part=s.recv(65536)
   if not part:raise AssertionError('short-broker-response')
   data+=part
   assert len(data)<1048576
  return json.loads(data)
def snap():
 r=request()
 if not r.get('ok') and r.get('error')=='BlockingIOError':
  raise BlockingIOError('lifecycle-transaction-lock-held')
 assert r['ok'];return r['status']
def healthy(r):return r['snapshot']['ownershipVerified'] and all(s['state']=='healthy' for s in r['snapshot']['services'].values())
def until(predicate,seconds=240):
 end=time.monotonic()+seconds
 while time.monotonic()<end:
  try:r=snap()
  except BlockingIOError:
   time.sleep(3);continue
  if predicate(r):return r
  time.sleep(3)
 raise AssertionError('bounded-observation-timeout')
def actions():
 # Read-only evidence, never inject or alter policy/owner rows.
 import sqlite3
 db=sqlite3.connect('file:'+str(ROOT/'operations/ops.db')+'?mode=ro',uri=True)
 try:return [dict(zip(['id','service','state','outcome'],r)) for r in db.execute('SELECT id,service,state,outcome FROM actions ORDER BY created')]
 finally:db.close()
def case(name,fn):
 start=time.monotonic()
 try:detail=fn()
 except BaseException as e:
  RESULT['cases'].append({'name':name,'passed':False,'errorType':type(e).__name__,'seconds':round(time.monotonic()-start,3)});save();raise
 RESULT['cases'].append({'name':name,'passed':True,'seconds':round(time.monotonic()-start,3),**(detail or {})});save()
 print(json.dumps(RESULT['cases'][-1]),flush=True)
def baseline():
 r=until(healthy);assert not r['maintenance']
 assert r['usageProvenance']['modelTokens'] is None and r['usageProvenance']['modelCost'] is None
 return {'services':list(r['snapshot']['services']),'ownershipVerified':True,'billingNotInferred':True}
def guardrails():
 before=actions();sentinel='stage7-private-sentinel-'+uuid.uuid4().hex
 assert request('exec')['error']=='operation-denied'
 assert request('recover',service='postgresql')['error']=='target-denied'
 assert request('recover',service='../../unrelated')['error']=='target-denied'
 assert request('snapshot',credential=sentinel)['error']=='invalid-request'
 assert actions()==before
 public=json.dumps(snap());assert sentinel not in public
 for p in (ROOT/'secrets').iterdir():
  if p.is_file() and not p.is_symlink() and p.stat().st_size<32768:
   value=p.read_text(errors='ignore').strip()
   if len(value)>20:assert value not in public
 return {'arbitraryCommandDenied':True,'foreignTargetDenied':True,'secretSentinelAbsent':True,'candidateSecretsAbsent':True,'noRecoveryIssued':True}
def maintenance():
 observer='alica-'+CELL+'-observer.service';service=CELL+'-memory-v4-1'
 cmd(['systemctl','stop',observer]);before=actions()
 try:
  assert request('maintenance',enabled=True)['ok']
  cmd(['docker','stop','--time','10',service])
  r=snap()
  for _ in range(2):r=snap()
  assert r['maintenance'] and r['decisions']['memory-v4']=='maintenance'
  assert request('recover',service='memory-v4')['error']=='maintenance'
  assert actions()==before
 finally:
  cmd(['docker','start',service]);until(healthy)
  assert request('maintenance',enabled=False)['ok'];cmd(['systemctl','start',observer])
 return {'manualStopNotResurrected':True,'noRecoveryIssued':True,'maintenanceClearedExplicitly':True}
def recover(service):
 before=actions();name=CELL+'-'+service+'-1'
 identity=json.loads(cmd(['docker','inspect',name]))[0]['Id']
 try:
  cmd(['docker','kill',name])
  r=until(lambda r:healthy(r) and len(actions())>len(before))
  new=actions()[len(before):]
  assert len(new)==1 and new[0]['service']==service and new[0]['outcome']=='command-returned'
  assert json.loads(cmd(['docker','inspect',name]))[0]['Id']==identity
  assert any(i['service']==service and i['state'].startswith('resolved:') for i in r['incidents'])
 finally:
  # Emergency fixture cleanup is not counted as broker recovery.
  row=json.loads(cmd(['docker','inspect',name]))[0]
  if not row['State']['Running']:cmd(['docker','start',name])
 return {'exactlyOneBrokerRecovery':True,'containerIdentityPreserved':True,'readinessObservedAfterCommand':True,'persistentIncidentResolved':True}
if __name__=='__main__':
 case('baseline',baseline)
 case('broker-denials-and-redaction',guardrails)
 case('maintenance-suppresses-recovery',maintenance)
 for service in ('unify-core','memory-v4','hermes'):
  case('unexpected-stop-'+service,lambda service=service:recover(service))
 RESULT['complete']=True;RESULT['remainingSuites']=['provider','callback','external-effect-deduplication','daemon','storage-pressure','broker-interruption','host-reboot','installed-browser'];save()
 print(json.dumps({'hostSuiteComplete':True,'wholeStage7Accepted':False}),flush=True)
