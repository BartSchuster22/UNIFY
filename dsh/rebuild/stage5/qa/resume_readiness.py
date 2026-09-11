"""Bounded retained-QA3 readiness check; no product-limit changes or DB writes."""
import datetime,hashlib,json,os,socket,subprocess,time
from pathlib import Path
assert os.geteuid()==0 and socket.gethostname()=='dsh-stage5-disposable'
root=Path('/opt/dsh2-stage5-qa3');cell=root.name;name=cell+'-postgresql-1'
out=Path('/var/lib/alica-stage5-qa3/resume-readiness.json')
def run(args,timeout=45):return subprocess.run(args,capture_output=True,text=True,timeout=timeout)
def inspect():
 p=run(['docker','inspect',name]);assert p.returncode==0
 return json.loads(p.stdout)[0]
def preserved():
 return {str(p):hashlib.sha256(p.read_bytes()).hexdigest() for r in Path('/opt').glob('dsh2-stage5-qa*') for n in ('owner.json','transaction.json','compose.json') if (p:=r/n).is_file()}
before=preserved();row=inspect();assert row['Config']['Labels']['com.alica.stage2']==cell
assert json.loads((root/'transaction.json').read_text())=={'state':'prepared','completed':[]}
assert not run(['docker','ps','-q']).stdout.strip(),'Unexpected running guest containers'
assert row['HostConfig']['NanoCpus']==250000000
health=row['Config']['Healthcheck'];assert health['Timeout']==3000000000
report={'schema':'stage5-resume-readiness/v1','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'wholeStage5Accepted':False,'coldOneShotPass':False,'sameRetainedQa3':True,'productNanoCpus':row['HostConfig']['NanoCpus'],'healthTimeoutNs':health['Timeout'],'healthObservations':[]}
def save():out.write_text(json.dumps(report,indent=2)+'\n');out.chmod(0o600)
try:
 p=run(['docker','start',name],90);assert p.returncode==0
 end=time.monotonic()+180
 while time.monotonic()<end:
  row=inspect();h=row['State'].get('Health',{});status=h.get('Status')
  report['healthObservations'].append({'status':status,'running':row['State']['Running'],'oomKilled':row['State']['OOMKilled'],'recentExitCodes':[l['ExitCode'] for l in h.get('Log',[])]});save()
  if status=='healthy':report['requiredDockerHealthPassed']=True;break
  assert row['State']['Running'] and not row['State']['OOMKilled']
  time.sleep(10)
 else:report['requiredDockerHealthPassed']=False
 start=time.monotonic()
 try:
  p=run(['docker','exec',name,'sh','-c',health['Test'][1]],40)
  report['requiredSqlProbe']={'exit':p.returncode,'seconds':round(time.monotonic()-start,3)}
 except subprocess.TimeoutExpired:report['requiredSqlProbe']={'deadlineExceeded':True,'seconds':round(time.monotonic()-start,3)}
 p=run(['docker','exec',name,'sh','-c','cat /sys/fs/cgroup/cpu.stat; cat /sys/fs/cgroup/memory.events'],30)
 report['containerResourceCounters']=p.stdout if p.returncode==0 else 'unavailable'
 report['resourceLimitsUnchanged']=inspect()['HostConfig']==row['HostConfig']
finally:
 p=run(['docker','stop','--time','30',name],90);report['candidateStopped']=p.returncode==0
 report['preservationHashesUnchanged']=before==preserved()
 report['noRunningGuestContainers']=not run(['docker','ps','-q']).stdout.strip()
 save();print(json.dumps(report),flush=True)
assert report.get('requiredDockerHealthPassed') and report.get('requiredSqlProbe',{}).get('exit')==0,'unchanged-product-readiness-failed'
