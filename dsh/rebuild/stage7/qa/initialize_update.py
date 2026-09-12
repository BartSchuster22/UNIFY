"""Initialize from a pristine signed archive, not its mutable Python execution tree.
Strict artifact inventory verification is unchanged. Deployed declared bytes are
also checked; generated interpreter cache is recorded separately, never admitted.
"""
import json,tarfile,shutil
from pathlib import Path
import release_trust as trust
import restore_context as r
import update_ops as u
r.guard();u.CONTROL.mkdir(mode=0o700,exist_ok=True);assert not u.STATE.exists()
a=r.BUNDLE.parent/'dsh-stage7-qa1-2772d9c-linux-amd64.tar.gz'
assert trust.digest(a)=='43a98d80cb49223e76be72b040913826552ba82cdd209e065d9e18162d4c68c6'
base=u.CONTROL/'pristine-base';base.mkdir(mode=0o700)
e=trust.load(r.BUNDLE.parent/'candidate-envelope.json');expected=e['payload']['artifacts'];seen=set();size=0
assert shutil.disk_usage(base).free>10*1024**3
with tarfile.open(a,'r|gz') as t:
 for m in t:
  assert m.isfile() and m.name.startswith('bundle/')
  name=m.name[len('bundle/'):];assert name in expected and name not in seen and '/' not in name
  seen.add(name);size+=m.size;assert size<8*1024**3
  with t.extractfile(m) as source,(base/name).open('xb') as dest:shutil.copyfileobj(source,dest)
assert seen==set(expected)
result=trust.verify(e,trust.load(trust.owned(u.TRUST)),base,'0'*64,0,'qa')
assert result['releaseSha256']==r.RELEASE and result['sequence']==1
for name,digest in expected.items():assert trust.digest(r.BUNDLE/name)==digest,'Deployed declared file changed: '+name
extras={str(p.relative_to(r.BUNDLE)):trust.digest(p) for p in r.BUNDLE.rglob('*') if p.is_file() and str(p.relative_to(r.BUNDLE)) not in expected}
assert all(Path(n).parent==Path('__pycache__') and n.endswith('.pyc') for n in extras),'Unexpected execution-tree file'
assert trust.load(r.ROOT/'operations/broker.json')['signatureSchema']=='alica-runtime-identity/v2'
r.save(u.STATE,{'releaseSha256':r.RELEASE,'sequence':1,'highestAttempt':1})
report={'signedBaseAuthorityInitialized':True,'releaseSha256':r.RELEASE,'sequence':1,'strictPristineInventoryVerified':True,'deployedDeclaredFilesVerified':len(expected),'runtimeCacheHashesOutsideArtifact':extras,'archiveInventoryRulesUnchanged':True}
r.save(u.CONTROL/'base-admission.json',report);print(json.dumps(report))
