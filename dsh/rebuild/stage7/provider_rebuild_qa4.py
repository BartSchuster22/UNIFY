"""Fresh-OS QA4 qualification. Refuses rebuild without CURRENT verified safeguards."""
import json,os,shlex,stat,subprocess,sys,urllib.request,urllib.error
from pathlib import Path
import provider_rebuild as p
from qa4 import archive
CREDENTIALS=p.BASE
PROOF=Path(__file__).parent/'evidence/candidates/72297c3/live/post-privacy-safeguard.json'
KEY=Path('/home/herman/.config/alica-recovery/dsh2.agekey')
p.BASE=CREDENTIALS/'stage7-qa4-fresh-os';p.BASE.mkdir(mode=0o700,exist_ok=True)
p.PLAN=p.BASE/'stage7-rebuild-plan.json';p.OLD=CREDENTIALS/'dsh2-stage7-known-hosts';p.KNOWN=p.BASE/'dsh2-stage7-known-hosts'
raw_ssh=p.ssh;raw_wait=p.wait_ready
p.CIPHER=json.loads(PROOF.read_text())['receipt']['ciphertextSha256']
p.REF=json.loads((Path(__file__).parent/'evidence/candidates/72297c3/inventory.json').read_text())['reference-image.tar']
def ssh(command,known=None,timeout=120):return raw_ssh(command,known or p.OLD,timeout)
p.ssh=ssh
def api(path,body=None):
 f=CREDENTIALS/'hetzner-cloud.token';s=f.lstat();p.need(stat.S_ISREG(s.st_mode) and s.st_uid==os.geteuid() and stat.S_IMODE(s.st_mode)==0o600,'Unsafe credential')
 r=urllib.request.Request('https://api.hetzner.cloud/v1/'+path,data=None if body is None else json.dumps(body).encode(),headers={'Authorization':'Bearer '+f.read_text().strip(),'Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(r,timeout=45) as response:return json.load(response)
 except urllib.error.HTTPError as e:raise RuntimeError('Provider HTTP '+str(e.code)) from None
 except Exception as e:raise RuntimeError('Provider transport '+type(e).__name__) from None
p.api=api
def backups():
 proof=json.loads(PROOF.read_text());expected=proof['receipt'];p.need(expected['ciphertextSha256']==p.CIPHER,'Safeguard changed')
 v=archive.verify('/home/herman/.config/alica-recovery/stage7-qa4-final/backup.age',KEY,p.CIPHER);p.need(v['manifestSha256']==expected['manifestSha256'],'First backup mismatch')
 d='/srv/alica-dsh-development/stage7-qa4-final-safeguard'
 code=f"import sys,json;sys.path.insert(0,{d!r});import archive;print(json.dumps(archive.verify({(d+'/backup.age')!r},'/dev/stdin',{p.CIPHER!r})))"
 r=subprocess.run(['ssh','-o','BatchMode=yes','-i',str(p.KEY),'deploy@167.233.135.142','python3 -c '+shlex.quote(code)],input=KEY.read_bytes(),capture_output=True,timeout=300);p.need(r.returncode==0,'Second backup unavailable');v=json.loads(r.stdout);p.need(v['manifestSha256']==expected['manifestSha256'],'Second backup mismatch')
 p.need(ssh('sudo -n sha256sum /var/lib/alica-stage7-qa4-final-safeguard/backup.age').split()[0]==p.CIPHER,'Source safeguard changed')
p.backups=backups
def wait_ready(plan):
 raw_wait(plan)
 code="from pathlib import Path;import json;print(json.dumps(all(not Path(x).exists() for x in ['/opt/dsh2-stage7-qa4','/var/lib/alica-stage7-qa4','/srv/alica-stage7-72297c3','/var/lib/alica-stage7-recovery-qa4'])))"
 p.need(json.loads(ssh('python3 -c '+shlex.quote(code),p.KNOWN)),'Previous QA4 state survived rebuild')
 plan=json.loads(p.PLAN.read_text());plan['previousQa4StateAbsent']=True;p.save(p.PLAN,plan)
p.wait_ready=wait_ready
if __name__=='__main__':p.main()
