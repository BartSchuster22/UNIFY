#!/usr/bin/env python3
import hashlib,json,os,shutil,subprocess,sys
from pathlib import Path
repo=Path('/srv/alica-dsh-development/repos/UNIFY-internal-install')
base=Path('/var/lib/alica-dsh-internal/real-download/bundle')
out=Path('/var/lib/alica-dsh-internal/dev-tls-3');bundle=out/'bundle'
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
assert not out.exists(),'Refuse replacement'
assert sha(base/'release.json')=='1486b3aa2dccb7a21941140508280b5125d816452e708e13c7640ea120a2e66c','Unexpected base release'
r=json.loads((base/'release.json').read_text())
for n,h in r['files'].items():assert Path(n).name==n and not (base/n).is_symlink() and sha(base/n)==h,'Base file mismatch'
assert shutil.disk_usage('/').free>15*1024**3
out.mkdir(mode=0o755);bundle.mkdir(mode=0o755)
for n in r['files']:
 if n.endswith('.tar'):os.link(base/n,bundle/n)
 else:shutil.copyfile(base/n,bundle/n)
sys.path.insert(0,str(repo/'dsh/rebuild/stage7'));from package import fix_installer,fix_operations
for n in ['render.py','tls_lifecycle.py']:shutil.copyfile(repo/'dsh/rebuild/stage2'/n,bundle/n)
(bundle/'install.py').write_text(fix_installer((repo/'dsh/rebuild/stage2/install.py').read_text()))
ops=fix_operations((repo/'dsh/rebuild/stage5/ops.py').read_text())
ops=ops.replace('from doghouse_dsh.broker import signature','from doghouse_dsh.identity import canonical_signature as signature, SCHEMA')
ops=ops.replace("cfg={'root':str(root)","cfg={'signatureSchema':SCHEMA,'root':str(root)")
(bundle/'ops.py').write_text(ops);(bundle/'alicactl').chmod(0o755)
# Remove predecessor-only QA topology and its private callback exception.
template=json.loads((bundle/'compose.template.json').read_text())
assert template['networks']['application']['ipam']['config']==[{'subnet':'10.84.0.0/24'}]
template['networks']['application'].pop('ipam')
template['services']['unify-core']['environment']['APPLICATION_CALLBACK_PINS_JSON']='{}'
(bundle/'compose.template.json').write_text(json.dumps(template,indent=2)+'\n')
from internal_operations import adapt
adapt(bundle/'doghouse-dsh.tar',bundle/'doghouse-dsh.new')
os.replace(bundle/'doghouse-dsh.new',bundle/'doghouse-dsh.tar')
r['release']='internal-dev-tls-3'
r['acceptance']='UNQUALIFIED TLS/onboarding engineering candidate; not frozen or accepted'
r['internalDevelopment']={'baseReleaseSha256':sha(base/'release.json'),'sourceHead':subprocess.check_output(['git','-C',str(repo),'rev-parse','HEAD'],text=True).strip(),'sourceDirty':True,'imagesUnchanged':True,'scope':'ALICA-v1 isolated development; no DSH2 deployment'}
r['files']={p.name:sha(p) for p in sorted(bundle.iterdir()) if p.is_file()}
(bundle/'release.json').write_text(json.dumps(r,indent=2)+'\n');h=sha(bundle/'release.json');(bundle/'release.sha256').write_text(h+'  release.json\n')
request={'cell':'dsh2-internal-dev3','origin':'https://dsh-dev.aquiero.com','port':443,'bind':'127.0.0.1','owner':'internal-owner','tls_mode':'proxy','edge_network':'dsh2-internal-dev-edge'}
(out/'request.json').write_text(json.dumps(request,indent=2)+'\n')
print(json.dumps({'bundle':str(bundle),'releaseSha256':h,'request':request,'qualified':False}))
