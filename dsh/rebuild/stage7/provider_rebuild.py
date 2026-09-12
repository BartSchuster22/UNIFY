#!/usr/bin/env python3
"""Explicit approved DSH2 rebuild, with secret-safe API handling and pinned SSH.
prepare registers only a recovery public key and validates cloud-init on old DSH2.
rebuild is destructive ONLY for pinned server 165497729 / 95.216.216.143.
Never retries a POST after an uncertain submission. Credentials are never logged.
"""
import argparse,fcntl,hashlib,json,os,shlex,stat,subprocess,time,urllib.request,urllib.error
from pathlib import Path
BASE=Path('/home/herman/.alica-provider-access');PLAN=BASE/'stage7-rebuild-plan.json';IP='95.216.216.143';SERVER=165497729;IMAGE=387894169
KEY=Path('/home/herman/.ssh/alica_v1_deploy_ed25519');OLD=BASE/'dsh2-stage6-known-hosts';KNOWN=BASE/'dsh2-stage7-known-hosts'
CIPHER='7ea6a5900cf3dd4fd289f2d93b438bed1fae78fe8d1a819d4d8052bcfc0ec5d9';REF='51c522b717e99eb6bb1025c442e713e9f6a1827fbeecef7a70f2cdc12618fd7b'
def need(ok,message):
 if not ok:raise RuntimeError(message)
def run(args,timeout=120):
 p=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
 need(p.returncode==0,'Command failed: '+args[0]+' exit '+str(p.returncode));return p.stdout.strip()
def ssh(command,known=OLD,timeout=120):return run(['ssh','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','HostKeyAlgorithms=ssh-ed25519','-o','ConnectTimeout=5','-o','UserKnownHostsFile='+str(known),'-i',str(KEY),'deploy@'+IP,command],timeout)
def digest(p):
 h=hashlib.sha256()
 with Path(p).open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
def save(p,v):
 tmp=p.with_suffix('.new');fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'w') as f:json.dump(v,f);f.flush();os.fsync(f.fileno())
 os.replace(tmp,p);fd=os.open(p.parent,os.O_DIRECTORY);os.fsync(fd);os.close(fd)
def api(path,body=None):
 token_file=BASE/'hetzner-cloud.token';s=token_file.lstat();need(stat.S_ISREG(s.st_mode) and s.st_uid==os.geteuid() and stat.S_IMODE(s.st_mode)==0o600,'Unsafe API credential')
 token=token_file.read_text().strip();request=urllib.request.Request('https://api.hetzner.cloud/v1/'+path,data=None if body is None else json.dumps(body).encode(),headers={'Authorization':'Bearer '+token,'Content-Type':'application/json','User-Agent':'ALICA-Stage7-DSH2-only'})
 try:
  with urllib.request.urlopen(request,timeout=45) as response:return json.load(response)
 except urllib.error.HTTPError as e:raise RuntimeError('Provider API HTTP '+str(e.code)) from None
 except Exception as e:raise RuntimeError('Provider API transport failure: '+type(e).__name__) from None

def target():
 server=api('servers/'+str(SERVER))['server'];need(server['id']==SERVER and server['name']=='DSH2' and server['public_net']['ipv4']['ip']==IP,'Provider target mismatch');need(not server['volumes'] and not server['protection']['rebuild'],'Unexpected volume/protection state');return server

def backups():
 from verify_predecessor import main as verify_both
 verify_both()
 need(ssh('sudo -n sha256sum /var/lib/alica-stage7-predecessor/predecessor.age',OLD).split()[0]==CIPHER,'Source recovery artifact mismatch')


def prepare():
 need(not PLAN.exists(),'Existing plan: review before replacing it');server=target();backups()
 before=json.loads(ssh("python3 -c \"import json,socket;from pathlib import Path;print(json.dumps({'hostname':socket.gethostname(),'bootId':Path('/proc/sys/kernel/random/boot_id').read_text().strip(),'machineId':Path('/etc/machine-id').read_text().strip()}))\""));need(before['hostname']=='DSH2','SSH host mismatch');need(not ssh('sudo -n docker ps -q'),'Source writers still running')
 pub=Path(str(KEY)+'.pub').read_text().strip();keys=api('ssh_keys?per_page=50')['ssh_keys'];found=[k for k in keys if k['public_key'].split()[:2]==pub.split()[:2]]
 key=found[0] if found else api('ssh_keys',{'name':'DSH2-stage7-recovery-deploy','public_key':pub})['ssh_key']
 host=BASE/'dsh2-stage7-host-ed25519';need(not host.exists(),'Existing new-host key');run(['ssh-keygen','-q','-t','ed25519','-N','','-C','DSH2-stage7-host','-f',str(host)])
 host_pub=Path(str(host)+'.pub').read_text().strip();KNOWN.write_text(IP+' '+' '.join(host_pub.split()[:2])+'\n');KNOWN.chmod(0o600)
 # Preserve existing deploy key restrictions verbatim, plus the already verified client key.
 lines=ssh("python3 -c \"from pathlib import Path;print(Path('/home/deploy/.ssh/authorized_keys').read_text())\"").splitlines();authorized=[s for s in lines if s.strip() and not s.lstrip().startswith('#')]
 if not any(pub.split()[1] in s for s in authorized):authorized.append(pub)
 config={'hostname':'DSH2','manage_etc_hosts':True,'users':[{'name':'deploy','uid':1000,'groups':['sudo'],'shell':'/bin/bash','sudo':['ALL=(ALL) NOPASSWD:ALL'],'lock_passwd':True,'ssh_authorized_keys':authorized}],'disable_root':True,'ssh_pwauth':False,'ssh_deletekeys':True,'ssh_genkeytypes':['ed25519'],'ssh_keys':{'ed25519_private':host.read_text(),'ed25519_public':host_pub},'package_update':True,'packages':['age','python3-cryptography',['docker.io','29.1.3-0ubuntu4.1'],['docker-compose-v2','2.40.3+ds1-0ubuntu1'],'curl','ca-certificates','git','unzip','jq'],'runcmd':[['systemctl','enable','--now','docker']]}
 cloud=BASE/'dsh2-stage7-cloud-init.yaml';config['write_files']=[{'path':'/etc/docker/daemon.json','owner':'root:root','permissions':'0644','content':json.dumps({'features':{'containerd-snapshotter':False},'storage-driver':'overlay2'})}];fd=os.open(cloud,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'w') as f:f.write('#cloud-config\n'+json.dumps(config));f.flush();os.fsync(f.fileno())
 run(['scp','-o','UserKnownHostsFile='+str(OLD),'-i',str(KEY),str(cloud),'deploy@'+IP+':/home/deploy/.stage7-cloud-init.yaml'])
 ssh('sudo -n cloud-init schema --config-file /home/deploy/.stage7-cloud-init.yaml');ssh("python3 -c \"from pathlib import Path;Path('/home/deploy/.stage7-cloud-init.yaml').unlink()\"")
 plan={'phase':'prepared','serverId':SERVER,'ip':IP,'imageId':IMAGE,'imageName':'ubuntu-26.04','before':before,'recoverySshKeyId':key['id'],'hostKeyFingerprint':run(['ssh-keygen','-lf',str(host)+'.pub']),'cloudInitSha256':digest(cloud),'backupSha256':CIPHER,'referenceImageSha256':REF,'stage7Accepted':False};save(PLAN,plan);print(json.dumps(plan))

def rebuild():
 plan=json.loads(PLAN.read_text());need(plan['phase']=='prepared','Uncertain/already submitted rebuild; no automatic retry');target();backups();need(digest(BASE/'dsh2-stage7-cloud-init.yaml')==plan['cloudInitSha256'],'Bootstrap changed')
 need(ssh("python3 -c \"from pathlib import Path;print(Path('/proc/sys/kernel/random/boot_id').read_text().strip())\"")==plan['before']['bootId'],'Source boot changed');need(not ssh('sudo -n docker ps -q'),'Source not quiesced')
 plan['phase']='submitting-rebuild';plan['startedAt']=time.time();save(PLAN,plan)
 response=api('servers/'+str(SERVER)+'/actions/rebuild',{'image':IMAGE,'user_data':(BASE/'dsh2-stage7-cloud-init.yaml').read_text()})
 # Do not persist or print the provider-generated root password.
 action=response['action'];plan['actionId']=action['id'];plan['phase']='rebuild-submitted';save(PLAN,plan);need(action['command']=='rebuild_server','Unexpected provider action');print(json.dumps({'actionId':action['id'],'phase':plan['phase']}),flush=True)
 wait_ready(plan)

def wait_ready(plan):
 deadline=time.monotonic()+900
 while time.monotonic()<deadline:
  a=api('actions/'+str(plan['actionId']))['action']
  if a['status']=='success':break
  need(a['status']!='error','Provider rebuild failed');time.sleep(5)
 else:raise RuntimeError('Provider action deadline exceeded')
 plan['phase']='provider-rebuilt';save(PLAN,plan)
 while time.monotonic()<deadline:
  try:
   value=json.loads(ssh("python3 -c \"import json,socket;from pathlib import Path;print(json.dumps({'hostname':socket.gethostname(),'bootId':Path('/proc/sys/kernel/random/boot_id').read_text().strip(),'machineId':Path('/etc/machine-id').read_text().strip()}))\"",KNOWN,15));break
  except (RuntimeError,subprocess.TimeoutExpired):time.sleep(5)
 else:raise RuntimeError('Pinned SSH bootstrap deadline exceeded')
 need(value['hostname']=='DSH2' and value['bootId']!=plan['before']['bootId'],'New boot not proven')
 # Hetzner may deterministically retain machine-id on a rebuild of the same VM.
 # Prove OS replacement using the successful provider action and absent old data,
 # not by manufacturing a different machine-id.
 status=json.loads(ssh('sudo -n cloud-init status --wait --format json; rc=$?; [ "$rc" = 0 ] || [ "$rc" = 2 ]',KNOWN,1200))
 need(status['status']=='done' and not status.get('errors'),'Cloud-init failed')
 warnings=status.get('recoverable_errors',{});need(not set(warnings)-{'DEPRECATED'},'Unexpected bootstrap warnings')
 for warning in warnings.get('DEPRECATED',[]):need(warning.startswith("Config key 'lists' is deprecated") or warning.startswith('The chpasswd multiline string is deprecated'),'Unreviewed deprecation warning')
 absent=json.loads(ssh("python3 -c \"import json;from pathlib import Path;print(json.dumps(all(not Path(p).exists() for p in ['/opt/dsh2-stage5-qa3','/opt/dsh2-stage5-qa4','/opt/dsh2-stage5-qa5','/usr/local/lib/alica-dsh-ops','/var/lib/alica-stage5-qa5'])))\"",KNOWN));need(absent,'Old installation still present')
 need(not ssh('sudo -n docker ps -aq; sudo -n docker volume ls -q; sudo -n docker image ls -q',KNOWN),'New target is not empty')
 plan.update({'phase':'fresh-os-ready','after':value,'elapsedSeconds':round(time.time()-plan['startedAt'],3),'pinnedSshVerified':True,'emptyDockerVerified':True,'oldInstallationAbsent':True,'machineIdPreserved':value['machineId']==plan['before']['machineId'],'bootstrapWarnings':warnings});save(PLAN,plan);print(json.dumps(plan),flush=True)

def resume():
 from datetime import datetime
 plan=json.loads(PLAN.read_text());need(plan['phase'] in ('submitting-rebuild','rebuild-submitted','provider-rebuilt'),'No incomplete rebuild to resume')
 actions=api('servers/'+str(SERVER)+'/actions?sort=started:desc&per_page=25')['actions']
 candidates=[a for a in actions if a['command']=='rebuild_server' and datetime.fromisoformat(a['started'].replace('Z','+00:00')).timestamp()>=plan['startedAt']-5 and {'id':SERVER,'type':'server'} in a['resources'] and {'id':IMAGE,'type':'image'} in a['resources']]
 need(len(candidates)==1,'Cannot uniquely identify submitted rebuild')
 action=candidates[0];need('actionId' not in plan or plan['actionId']==action['id'],'Action identity mismatch')
 plan['actionId']=action['id'];plan['phase']='rebuild-submitted';save(PLAN,plan);wait_ready(plan)

def main():
 p=argparse.ArgumentParser();p.add_argument('action',choices=['prepare','rebuild','resume']);a=p.parse_args();need(stat.S_IMODE(BASE.stat().st_mode)==0o700,'Unsafe credential directory')
 with (BASE/'operation.lock').open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  if a.action=='prepare':prepare()
  elif a.action=='resume':resume()
  else:rebuild()
if __name__=='__main__':main()
