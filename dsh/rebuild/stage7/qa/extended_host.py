#!/usr/bin/env python3
"""Additional LIVE guest-only faults. No reboot, forged status or DB writes.
Storage case uses a real small tmpfs probe, NOT a filled production data filesystem.
"""
import json,threading,time
from pathlib import Path
import host_operations as q
q.OUT=q.OUT.with_name('extended-host.json')
q.RESULT={'schema':'stage7-extended-host/v1','cases':[],'complete':False}
OBSERVER='alica-'+q.CELL+'-observer.service';BROKER='alica-'+q.CELL+'-broker.service'
def ready(seconds=120):
 end=time.monotonic()+seconds
 while time.monotonic()<end:
  try:return q.snap()
  except (OSError,AssertionError):time.sleep(1)
 raise AssertionError('broker-not-ready-within-bound')
def dependency():
 q.until(q.healthy);before=q.actions();name=q.CELL+'-postgresql-1'
 try:
  q.cmd(['docker','stop','--time','15',name])
  r=q.until(lambda s:s['snapshot']['services']['unify-core']['state']!='healthy')
  assert r['decisions']['unify-core']=='dependency-unhealthy'
  assert q.request('recover',service='unify-core')['error']=='dependency-unhealthy'
  assert q.request('recover',service='postgresql')['error']=='target-denied'
  assert q.actions()==before
 finally:
  q.cmd(['docker','start',name]);q.until(q.healthy,360)
 return {'databaseNotAutoRestarted':True,'dependentRestartSuppressed':True,'noRecoveryIssued':True}
def daemon():
 q.until(q.healthy);before=q.actions()
 try:
  q.cmd(['systemctl','stop','docker.socket','docker.service'],90)
  r=q.snap();assert not r['snapshot']['dockerAvailable']
  assert all(s['state']=='unknown' for s in r['snapshot']['services'].values())
  assert q.request('recover',service='memory-v4')['error']=='docker-unavailable'
  assert q.actions()==before
 finally:
  q.cmd(['systemctl','start','docker.socket','docker.service'],90);q.until(q.healthy,420)
 return {'actualGuestDaemonStopped':True,'unknownNotHealthy':True,'noRecoveryIssued':True,'readinessReturned':True}
def storage():
 q.until(q.healthy);before=q.actions();cfg=q.ROOT/'operations/broker.json';original=cfg.read_bytes()
 value=json.loads(original);assert value['minimumFreeBytes']>16*1024**2
 probe=q.ROOT/'qa-storage-probe';assert not probe.exists();probe.mkdir(mode=0o700)
 mounted=False
 q.cmd(['systemctl','stop',OBSERVER]);q.cmd(['systemctl','stop',BROKER])
 try:
  q.cmd(['mount','-t','tmpfs','-o','size=16m,mode=0700,nodev,nosuid,noexec','stage7-qa-storage',str(probe)]);mounted=True
  value['storagePath']=str(probe);cfg.write_text(json.dumps(value))
  q.cmd(['systemctl','start',BROKER]);r=ready()
  assert r['snapshot']['storagePressure'] and r['snapshot']['storageAvailableBytes']<value['minimumFreeBytes']
  assert q.request('recover',service='memory-v4')['error']=='storage-pressure'
  assert q.actions()==before
 finally:
  q.cmd(['systemctl','stop',BROKER]);cfg.write_bytes(original)
  if mounted:q.cmd(['umount',str(probe)])
  probe.rmdir();q.cmd(['systemctl','start',BROKER]);ready();q.cmd(['systemctl','start',OBSERVER])
  q.until(q.healthy);assert cfg.read_bytes()==original
 return {'actualStatvfsPressure':True,'probe':'isolated-16MiB-tmpfs','originalThresholdUnchanged':True,'dataFilesystemNotFilled':True,'configurationRestoredExactly':True,'noRecoveryIssued':True}
def interrupted_broker():
 q.until(q.healthy);name=q.CELL+'-memory-v4-1';before=q.actions();response=[]
 q.cmd(['systemctl','stop',OBSERVER]);thread=None
 def issue():
  try:response.append(q.request('recover',service='memory-v4'))
  except (OSError,AssertionError):response.append({'connectionInterrupted':True})
 try:
  q.cmd(['docker','kill',name]);q.until(lambda r:r['decisions']['memory-v4']=='eligible',180)
  thread=threading.Thread(target=issue,daemon=True);thread.start()
  end=time.monotonic()+45;issued=None
  while time.monotonic()<end:
   new=q.actions()[len(before):]
   if new and new[-1]['state']=='issued':issued=new[-1]['id'];break
   if new and new[-1]['state']=='finished':raise AssertionError('fault-injection-window-missed')
   time.sleep(.02)
  assert issued is not None,'No genuinely issued action observed'
  q.cmd(['systemctl','kill','--signal=SIGKILL',BROKER]);ready()
  thread.join(60);assert not thread.is_alive()
  new=q.actions()[len(before):];assert len(new)==1 and new[0]['id']==issued
  assert new[0]['state']=='uncertain' and new[0]['outcome']=='broker-interrupted'
  row=json.loads(q.cmd(['docker','inspect',name]))[0]
  if row['State']['Running']:q.cmd(['docker','kill',name])
  q.until(lambda r:r['decisions']['memory-v4']=='uncertain-prior-effect',90)
  assert q.request('recover',service='memory-v4')['error']=='uncertain-prior-effect'
  assert q.actions()[len(before):]==new
 finally:
  ready();q.cmd(['docker','start',name]);q.until(q.healthy,360)
  assert q.request('ack',service='memory-v4')['ok']
  q.cmd(['systemctl','start',OBSERVER])
 return {'realIssuedActionInterrupted':True,'uncertainPersistedAcrossBrokerRestart':True,'blindReplayDenied':True,'explicitOperatorAcknowledgement':True,'noDatabaseRowsInjected':True}
if __name__=='__main__':
 q.case('database-dependency-failure',dependency)
 q.case('guest-docker-daemon-unavailable',daemon)
 q.case('real-storage-probe-pressure',storage)
 q.case('broker-interrupted-during-issued-action',interrupted_broker)
 q.RESULT['complete']=True;q.save();print(json.dumps({'extendedHostSuiteComplete':True,'wholeStage7Accepted':False}),flush=True)
