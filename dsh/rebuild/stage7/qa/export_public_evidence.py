"""Read-only, bounded evidence export. Never export credentials or raw customer payloads."""
import json,hashlib
from pathlib import Path
from qa_common import OUT,ROOT,CELL
import host_operations as h
names=['oidc-result','first-acceptance','extended-host','qualification-credential-rotation','clean-install','reboot-result','hostile-boundary','qualified-recurring-soak','negative-acceptance','host-operations','isolation','application-lifecycle','business-faults','operations-api','credential-lifecycle','privacy-acceptance','update-suite','research-positive-control']
paths={n:OUT/(n+'.json') for n in names}
rec=Path('/var/lib/alica-stage7-recovery-qa3')
for n in ['backup-receipt','restore-result','cold-verified','extraction-receipt']:paths[n]=rec/(n+'.json')
paths['update-control-state']=rec/'update-control/state.json'
secrets=[]
def collect(v,forced=False):
 if isinstance(v,dict):
  for k,x in v.items():collect(x,forced or any(t in k.lower() for t in ('password','token','secret','cookie')))
 elif isinstance(v,list):
  for x in v:collect(x,forced)
 elif forced and isinstance(v,str) and len(v)>12:secrets.append(v)
for p in [OUT/'registration.json',OUT/'registration-expired-qualification-attempt1.json',OUT/'isolation-registration.json',OUT/'customer-passwords.json',*OUT.glob('*grant*.json')]:
 if p.exists():collect(json.loads(p.read_text()),p.name=='customer-passwords.json')
for p in [*ROOT.joinpath('secrets').glob('*'),*OUT.joinpath('reference-secrets').glob('*'),*OUT.glob('.test-owner*')]:
 if p.is_file() and p.stat().st_size<32768:
  try:
   s=p.read_text().strip()
   if len(s)>12:secrets.append(s)
  except UnicodeError:pass
redactions=[]
def clean(v,path):
 if isinstance(v,dict):return {k:clean(x,path+'/'+k) for k,x in v.items()}
 if isinstance(v,list):return [clean(x,path+'/'+str(i)) for i,x in enumerate(v)]
 if isinstance(v,str):
  for secret in secrets:
   if secret in v:
    v=v.replace(secret,'[REDACTED_PRIVATE_MATERIAL]');redactions.append(path)
 return v
result={};hashes={}
for name,p in paths.items():
 assert p.is_file() and p.stat().st_size<4*1024*1024
 raw=p.read_bytes();hashes[name]=hashlib.sha256(raw).hexdigest();result[name]=clean(json.loads(raw),name)
s=h.until(lambda s:h.healthy(s) and s['snapshot']['nativeWork']['observed'] and s['snapshot']['nativeWork']['active']==0);assert not s['maintenance']
result['final-health']={'passed':True,'ownershipVerified':True,'services':{n:r['state'] for n,r in s['snapshot']['services'].items()},'nativeWork':s['snapshot']['nativeWork'],'maintenance':s['maintenance']}
print(json.dumps({'reports':result,'sourceSha256':hashes,'redactedFields':sorted(set(redactions))}))
