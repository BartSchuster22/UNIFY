"""Reauthenticate BOTH off-host archives without extracting or exposing their contents."""
import concurrent.futures,json,subprocess,sys,time
from pathlib import Path
import provider_rebuild as p
here=Path(__file__).parent
p.backups()
args=['verify','--archive','/home/herman/dsh2-backups/dsh2-stage6-backup.age','--identity','/home/herman/.config/alica-recovery/dsh2.agekey','--sha256',p.CIPHER]
remote=['ssh','-o','BatchMode=yes','-i',str(p.KEY),'deploy@167.233.135.142','sudo -n python3 - verify --archive /srv/alica-dsh-development/stage6-backups/dsh2-stage6-backup.age --identity /var/lib/alica-recovery-keys/dsh2.agekey --sha256 '+p.CIPHER]
def verify(name,cmd,script=None):
 result=subprocess.run(cmd,input=script,text=True,capture_output=True,timeout=600);assert result.returncode==0,name+' archive verification failed'
 value=json.loads(result.stdout);assert value['authenticationVerified'] and value['contentsVerified'] and value['entriesVerified']==9513
 return name,value
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
 futures=[pool.submit(verify,'ElioHermes1',[sys.executable,str(here/'archive.py'),*args]),pool.submit(verify,'ALICA-v1',remote,(here/'archive.py').read_text())]
 report={'schema':'stage6-final-offhost-recheck/v1','checkedAt':time.time(),'referenceImageCopiesHashVerified':True,'hosts':dict(f.result() for f in futures),'passed':True}
(here/'evidence/offhost-final-recheck.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
