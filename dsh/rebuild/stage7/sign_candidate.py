"""Independently hash every archive member before signing the QA assembly."""
import argparse,base64,hashlib,json,sys,tarfile,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parents[1]/'stage6'))
import release_trust as t # pyright: ignore[reportMissingImports]
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--evidence',type=Path,default=Path(__file__).parent/'evidence');e=parser.parse_args().evidence;receipt=t.load(e/'receipt.json');expected=t.load(e/'inventory.json')
 t.safe_name(receipt['archive']);assert Path(receipt['archive']).name==receipt['archive']
 archive=Path('/home/herman/stage7-artifacts')/receipt['archive'];assert t.digest(archive)==receipt['archiveSha256']
 observed={}
 with tarfile.open(archive,'r|gz') as tar:
  for member in tar:
   assert member.isfile() and member.name.startswith('bundle/')
   name=member.name.removeprefix('bundle/');t.safe_name(name);assert '/' not in name and name not in observed
   f=tar.extractfile(member);assert f;h=hashlib.sha256()
   while block:=f.read(1048576):h.update(block)
   observed[name]=h.hexdigest()
 assert observed==expected and observed['release.json']==receipt['releaseSha256']
 now=int(time.time());p={'schema':'alica-release-admission/v1','scope':'qa','sequence':1,'issuedAt':now,'expiresAt':now+7*86400,'platform':'linux/amd64','acceptedPredecessors':['0'*64],'artifacts':observed,'releaseSha256':observed['release.json']}
 keyfile=Path('/home/herman/.alica-release-signing/stage6-qa.pem');envelope=t.sign(p,keyfile)
 key=serialization.load_pem_private_key(t.owned(keyfile,True).read_bytes(),password=None)
 assert isinstance(key,Ed25519PrivateKey)
 public=key.public_key().public_bytes(serialization.Encoding.Raw,serialization.PublicFormat.Raw)
 trust={'schema':'alica-release-trust/v1','scope':'qa','keys':{t.key_id(public):base64.b64encode(public).decode()},'revoked':[]}
 key.public_key().verify(base64.b64decode(envelope['signature']),t.DOMAIN+t.canonical(envelope['payload']))
 for n,v in [('candidate-envelope.json',envelope),('candidate-trust.json',trust)]:
  path=e/n;assert not path.exists();path.write_bytes(t.canonical(v)+b'\n')
 result={'schema':'stage7-archive-verification/v1','archiveSha256':receipt['archiveSha256'],'allArchiveMembersIndependentlyVerified':True,'membersVerified':len(observed),'qaSignatureVerified':True,'keyId':t.key_id(public),'trustFileSha256':t.digest(e/'candidate-trust.json'),'stage7Accepted':False}
 (e/'archive-verification.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
if __name__=='__main__':main()
