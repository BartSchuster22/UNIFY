#!/usr/bin/env python3
"""DSH2-only clean artifact admission and measured installation. No restored state."""
import hashlib,json,os,socket,subprocess,tarfile,time,urllib.request
from pathlib import Path
BASE='https://github.com/BartSchuster22/Alica-DSH/releases/download/dsh-stage7-qa1-2772d9c/'
ARCHIVE='dsh-stage7-qa1-2772d9c-linux-amd64.tar.gz'
SHA='43a98d80cb49223e76be72b040913826552ba82cdd209e065d9e18162d4c68c6'
TRUST='5af48e80bffa12df7921c2c688f4f2f2249c68032d04e6f7e10621668d264034'
VERIFIER='62f39860a259a76721068b23140eca846def5acca5b728fbab26518576722547'
RELEASE='26ccaff3c5539288dda0a0e9b60fa7187fb64b70c772f104e1c0068efbed2b01'
HOME=Path('/srv/alica-stage7-2772d9c');OUT=Path('/var/lib/alica-stage7-qa3');ROOT=Path('/opt/dsh2-stage7-qa3')
def run(args):return subprocess.check_output(args,text=True,stderr=subprocess.PIPE).strip()
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
def download(name,expected=None):
 p=HOME/name
 with urllib.request.urlopen(BASE+name,timeout=60) as r,p.open('xb') as f:
  while True:
   b=r.read(1048576)
   if not b:break
   f.write(b)
 if expected:assert digest(p)==expected,'Downloaded checksum mismatch'
 return p

def main():
 assert os.geteuid()==0 and socket.gethostname()=='DSH2'
 assert not HOME.exists() and not OUT.exists() and not ROOT.exists()
 for args in [('ps','-aq'),('volume','ls','-q'),('image','ls','-q')]:assert not run(['docker',*args]),'Not a clean Docker store'
 os.umask(0o077);HOME.mkdir(mode=0o755);OUT.mkdir(mode=0o700)
 a=download(ARCHIVE,SHA);trust=download('candidate-trust.json',TRUST);verifier=download('release_trust.py',VERIFIER);envelope=download('candidate-envelope.json')
 bundle=HOME/'bundle';bundle.mkdir(mode=0o755)
 with tarfile.open(a) as t:
  seen=set()
  for m in t:
   parts=m.name.split('/');assert len(parts)==2 and parts[0]=='bundle' and parts[1] not in ('','.','..') and m.isfile() and m.name not in seen
   seen.add(m.name);p=bundle/parts[1]
   source=t.extractfile(m);assert source is not None
   with source as src,p.open('xb') as dst:
    while True:
     b=src.read(1048576)
     if not b:break
     dst.write(b)
   p.chmod(0o755 if p.name=='alicactl' else 0o644)
 admission=json.loads(run(['python3',str(verifier),'verify','--bundle',str(bundle),'--trust',str(trust),'--envelope',str(envelope),'--scope','qa','--installed-sequence','0','--current','0'*64]))
 request={'cell':ROOT.name,'origin':'https://stage7.qa.invalid','port':443,'bind':'127.0.0.1','owner':'stage7-owner'}
 req=OUT/'request.json';req.write_text(json.dumps(request))
 mem=lambda:{l.split(':')[0]:int(l.split()[1])*1024 for l in Path('/proc/meminfo').read_text().splitlines()}
 before=mem();disk=os.statvfs('/')
 report={'schema':'stage7-clean-install/v1','candidateSha256':SHA,'releaseSha256':RELEASE,'downloadedOnTarget':True,'admission':admission,'cleanDockerBefore':True,'noStateRestored':True,'cpuCount':os.cpu_count(),'memoryTotalBytes':before['MemTotal'],'diskAvailableBeforeBytes':disk.f_bavail*disk.f_frsize,'bootId':Path('/proc/sys/kernel/random/boot_id').read_text().strip(),'stage7Accepted':False}
 start=time.monotonic();peak=0
 with (OUT/'private-install.log').open('w') as log:
  p=subprocess.Popen([str(bundle/'alicactl'),'install','--bundle',str(bundle),'--release-sha256',RELEASE,'--root',str(ROOT),'--request',str(req)],stdout=log,stderr=subprocess.STDOUT)
  while p.poll() is None:
   peak=max(peak,before['MemTotal']-mem()['MemAvailable'])
   if time.monotonic()-start>1800:p.terminate();p.wait(timeout=30);raise RuntimeError('Bounded installation timed out')
   time.sleep(1)
 report.update({'installExit':p.returncode,'seconds':round(time.monotonic()-start,3),'peakHostNonAvailableBytes':peak,'operationsEnrolled':(ROOT/'operations/broker.json').is_file()})
 ids=run(['docker','ps','-aq','--filter','label=com.docker.compose.project='+ROOT.name]).split()
 rows=json.loads(run(['docker','inspect',*ids])) if ids else []
 report['containers']=[{'name':r['Name'],'image':r['Image'],'running':r['State']['Running'],'health':r['State'].get('Health',{}).get('Status'),'oomKilled':r['State']['OOMKilled'],'memoryLimit':r['HostConfig']['Memory'],'nanoCpus':r['HostConfig']['NanoCpus'],'pidsLimit':r['HostConfig']['PidsLimit']} for r in rows]
 report['operationsHealthy']=False
 try:
  units=['alica-'+ROOT.name+'-'+role+'.service' for role in ('cell','broker','observer')]
  report['operationUnits']=run(['systemctl','is-active',*units]).splitlines()
  code='/usr/local/lib/alica-dsh-ops/'+ROOT.name
  probe="import json,sys;sys.path.insert(0,"+repr(code)+");from doghouse_dsh.observer import request;print(json.dumps(request('/run/alica-ops-"+ROOT.name+"/broker.sock',{'op':'snapshot'})))"
  state=json.loads(run(['runuser','-u','alica-ops','--','python3','-c',probe]))
  report['operationsHealthy']=report['operationUnits']==['active']*3 and state['ok'] and state['status']['snapshot']['ownershipVerified'] and all(v['state']=='healthy' for v in state['status']['snapshot']['services'].values())
 except Exception as exc:report['operationsProbeError']=type(exc).__name__
 report['passed']=p.returncode==0 and report['operationsEnrolled'] and report['operationsHealthy'] and len(rows)==7 and all(r['State']['Running'] and r['State'].get('Health',{}).get('Status')=='healthy' for r in rows)
 (OUT/'clean-install.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report),flush=True)
 assert report['passed'],'Clean-install gate failed; diagnostics retained'
if __name__=='__main__':main()
