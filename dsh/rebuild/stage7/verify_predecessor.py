"""Reauthenticate both immutable predecessor copies; never extract private data."""
import concurrent.futures,json,subprocess,sys,time
from pathlib import Path
CIPHER='7ea6a5900cf3dd4fd289f2d93b438bed1fae78fe8d1a819d4d8052bcfc0ec5d9'
MANIFEST='349e113c2abe7941bc8340e92767d695c8b8ada821e54043edfb7d4f4bb9d210'
here=Path(__file__).parent;source=here.parent/'stage6/archive.py';key='/home/herman/.ssh/alica_v1_deploy_ed25519'
def verify(name,cmd,script=None):
 p=subprocess.run(cmd,input=script,text=True,capture_output=True,timeout=900)
 assert p.returncode==0,name+' authentication/content verification failed'
 v=json.loads(p.stdout);assert v['authenticationVerified'] and v['contentsVerified'] and v['entriesVerified']==28204 and v['manifestSha256']==MANIFEST
 return name,v
def main():
 local=[sys.executable,str(source),'verify','--archive','/home/herman/dsh2-backups/stage7-predecessor.age','--identity','/home/herman/.config/alica-recovery/dsh2.agekey','--sha256',CIPHER]
 remote=['ssh','-o','BatchMode=yes','-i',key,'deploy@167.233.135.142','sudo -n python3 - verify --archive /srv/alica-dsh-development/stage7-backups/predecessor.age --identity /var/lib/alica-recovery-keys/dsh2.agekey --sha256 '+CIPHER]
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  futures=[pool.submit(verify,'ElioHermes1',local),pool.submit(verify,'ALICA-v1',remote,source.read_text())]
  hosts=dict(f.result() for f in futures)
 result={'schema':'stage7-predecessor-offhost-verification/v1','checkedAt':time.time(),'ciphertextSha256':CIPHER,'manifestSha256':MANIFEST,'hosts':hosts,'passed':True,'stage7Accepted':False}
 (here/'evidence/predecessor-offhost-verification.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result),flush=True)
if __name__=='__main__':main()
