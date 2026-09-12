#!/usr/bin/env python3
"""Produce an immutable QA candidate from authenticated bytes; no target build."""
import argparse,hashlib,json,os,shutil,tarfile
from pathlib import Path
BASE='1fde4fdfeea219bbad1e61e6bcce8046b2a7f9d880218d95a660624be08cd4f6'
REF='51c522b717e99eb6bb1025c442e713e9f6a1827fbeecef7a70f2cdc12618fd7b'
LIFECYCLE_CLI='''#!/usr/bin/env bash
set -euo pipefail
base=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
case "${1:-}" in
 recover-owner) shift; exec python3 "$base/recover_owner.py" "$@" ;;
 plan) exec python3 "$base/install.py" "$@" ;;
 *) exec python3 "$base/ops.py" "$@" ;;
esac
'''
def fix_installer(source):
 old="with os.fdopen(fd,'w') as f:f.write(value);f.flush();os.fsync(f.fileno())"
 new="with os.fdopen(fd,'w') as f:f.write(value);f.flush();os.fchmod(f.fileno(),mode);os.fsync(f.fileno())"
 assert source.count(old)==1,'Unexpected installer write primitive'
 return source.replace(old,new)

def fix_operations(source):
 old='    code.mkdir(parents=True,mode=0o755)'
 new='''    # These are non-secret executable-code directories. The unprivileged
    # observer must traverse them even when the operator uses umask 077.
    if code.parent.is_symlink() or code.parent.exists() and (code.parent.stat().st_uid!=0 or code.parent.stat().st_mode&0o022):raise RuntimeError('unsafe operations code parent')
    code.mkdir(parents=True,mode=0o755)
    code.parent.chmod(0o755);code.chmod(0o755)'''
 assert source.count(old)==1,'Unexpected operations code preparation'
 source=source.replace(old,new)
 old="(op/'public').mkdir(exist_ok=True,mode=0o755)"
 assert source.count(old)==1,'Unexpected public-status preparation'
 return source.replace(old,old+";(op/'public').chmod(0o755)")

def sha(p):
 h=hashlib.sha256()
 with Path(p).open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
def produce(base,reference,doghouse,output,revision,doghouse_revision):
 base,reference,doghouse,output=map(Path,(base,reference,doghouse,output))
 assert not output.exists(),'Refuse candidate replacement'
 assert sha(base/'release.json')==BASE and sha(reference)==REF,'Unauthenticated input'
 old=json.loads((base/'release.json').read_text())
 for name,digest in old['files'].items():
  assert Path(name).name==name and not (base/name).is_symlink() and sha(base/name)==digest
 assert len(revision)==40 and len(doghouse_revision)==40
 output.mkdir(mode=0o755);bundle=output/'bundle';bundle.mkdir()
 for name in old['files']:
  # Never hard-link mutable source metadata/code into a candidate.
  if name=='images.tar':os.link(base/name,bundle/name)
  else:shutil.copyfile(base/name,bundle/name)
 shutil.copyfile(reference,bundle/'reference-image.tar')
 # The public lifecycle entrypoint must enroll and use host operations, not
 # bypass their locks, maintenance fencing and joint-readiness checks.
 (bundle/'alicactl').write_text(LIFECYCLE_CLI)
 (bundle/'alicactl').chmod(0o755)
 (bundle/'install.py').write_text(fix_installer((bundle/'install.py').read_text()))
 ops=fix_operations((bundle/'ops.py').read_text())
 assert ops.count('from doghouse_dsh.broker import signature')==1
 ops=ops.replace('from doghouse_dsh.broker import signature','from doghouse_dsh.identity import canonical_signature as signature, SCHEMA')
 assert ops.count("cfg={'root':str(root)")==1
 ops=ops.replace("cfg={'root':str(root)","cfg={'signatureSchema':SCHEMA,'root':str(root)")
 (bundle/'ops.py').write_text(ops)
 sources=sorted(doghouse.glob('*.py'));assert len(sources)>=7
 assert all(not p.is_symlink() for p in sources)
 with tarfile.open(bundle/'doghouse-dsh.tar','w') as t:
  for p in sources:t.add(p,arcname='doghouse_dsh/'+p.name,recursive=False)
 old['release']='stage7-qa1-'+revision[:7]
 old['stage7_assembly']={'sourceRevision':revision,'doghouseRevision':doghouse_revision,'baseReleaseSha256':BASE,'referenceArchiveSha256':REF,'runtimeImagesUnchanged':True,'observedAssemblyNotReproducibleBuild':True,'productionAccepted':False}
 old['source_revisions']['stage7_operations']=revision
 old['source_revisions']['doghouse']=doghouse_revision
 old['acceptance']='UNQUALIFIED Stage 7 QA candidate; independent acceptance pending'
 old['files']={p.name:sha(p) for p in sorted(bundle.iterdir()) if p.is_file()}
 (bundle/'release.json').write_text(json.dumps(old,indent=2)+'\n');release=sha(bundle/'release.json')
 (bundle/'release.sha256').write_text(release+'  release.json\n')
 archive=output/('dsh-stage7-qa1-'+revision[:7]+'-linux-amd64.tar.gz')
 with tarfile.open(archive,'w:gz',compresslevel=1) as t:
  for p in sorted(bundle.iterdir()):
   info=t.gettarinfo(p,arcname='bundle/'+p.name);info.uid=info.gid=0;info.uname=info.gname='root';info.mode=0o755 if p.name=='alicactl' else 0o644
   with p.open('rb') as f:t.addfile(info,f)
 receipt={'schema':'stage7-candidate-build/v1','sourceRevision':revision,'doghouseRevision':doghouse_revision,'archive':archive.name,'archiveSha256':sha(archive),'archiveBytes':archive.stat().st_size,'releaseSha256':release,'fileCount':len(old['files']),'stage7Accepted':False,'productionAccepted':False}
 (output/'build-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt),flush=True)
if __name__=='__main__':
 p=argparse.ArgumentParser()
 for n in ('base','reference','doghouse','output','revision','doghouse-revision'):p.add_argument('--'+n,required=True)
 a=p.parse_args();produce(a.base,a.reference,a.doghouse,a.output,a.revision,a.doghouse_revision)
