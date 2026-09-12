"""Build and sign a narrow operations-only QA successor from verified base bytes."""
import io,json,sys,tarfile,time,subprocess
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parents[1]/'stage6'));import release_trust as t
BASE='26ccaff3c5539288dda0a0e9b60fa7187fb64b70c772f104e1c0068efbed2b01'
def main():
 source=Path('/home/herman/stage7-artifacts/dsh-stage7-qa1-2772d9c-linux-amd64.tar.gz');assert t.digest(source)=='43a98d80cb49223e76be72b040913826552ba82cdd209e065d9e18162d4c68c6'
 out=Path('/home/herman/stage7-operations-update');out.mkdir(mode=0o700);bundle=out/'bundle';bundle.mkdir(mode=0o755)
 inventory=t.load(Path(__file__).parent/'evidence/candidates/2772d9c/inventory.json');parts={}
 with tarfile.open(source,'r|gz') as archive:
  for m in archive:
   name=m.name.removeprefix('bundle/')
   if name in ('doghouse-dsh.tar','release.json'):
    value=archive.extractfile(m).read();assert t.hashlib.sha256(value).hexdigest()==inventory[name];parts[name]=value
 assert set(parts)=={'doghouse-dsh.tar','release.json'}
 with tarfile.open(fileobj=io.BytesIO(parts['doghouse-dsh.tar'])) as archive:
  for m in archive:
   assert m.isfile() and len(Path(m.name).parts)==2 and Path(m.name).parts[0]=='doghouse_dsh' and m.name.endswith('.py')
   p=bundle/m.name;p.parent.mkdir(exist_ok=True);p.write_bytes(archive.extractfile(m).read());p.chmod(0o644)
 identity=bundle/'doghouse_dsh/identity.py'
 with identity.open('a') as f:f.write('\n\ndef qualified_update_identity():\n    return "stage7-qa3-operations-update/v1"\n')
 release=json.loads(parts['release.json']);revision=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
 # Native runtime image identities come from the signed base release, not a tag.
 images={name:row['id'] for name,row in release['images'].items()}
 assert set(images)=={'hermes','postgresql','keycloak','memory-v4','unify-core','uniui','caddy'}
 desc={'schema':'alica-qa3-host-operations-release/v1','sourceRevision':revision,'baseReleaseSha256':BASE,'runtimeImages':images,'mapping':{'identities':'preserve','channels':'preserve','schedules':'preserve'},'targetSignatureSchema':'alica-runtime-identity/v2','platform':'ubuntu-26.04/docker-29.1.3/overlay2/linux-amd64'}
 (bundle/'release.json').write_bytes(t.canonical(desc)+b'\n');files=t.inventory(bundle);now=int(time.time())
 trust=t.load(Path(__file__).parent/'evidence/candidates/2772d9c/candidate-trust.json')
 receipts=[]
 for sequence in (2,3,4,5):
  payload={'schema':'alica-release-admission/v1','scope':'qa','sequence':sequence,'issuedAt':now,'expiresAt':now+7*86400,'platform':'linux/amd64','acceptedPredecessors':[BASE],'artifacts':files,'releaseSha256':files['release.json']}
  envelope=t.sign(payload,Path('/home/herman/.alica-release-signing/stage6-qa.pem'));(out/('envelope-'+str(sequence)+'.json')).write_bytes(t.canonical(envelope)+b'\n')
  receipts.append(t.verify(envelope,trust,bundle,BASE,sequence-1,'qa'))
 (out/'verification.json').write_bytes(t.canonical({'baseReleaseSha256':BASE,'releaseSha256':files['release.json'],'sourceRevision':revision,'runtimeImagesUnchanged':True,'scope':'operations-only-qa','verifications':receipts,'accepted':False})+b'\n')
 print((out/'verification.json').read_text())
if __name__=='__main__':main()
