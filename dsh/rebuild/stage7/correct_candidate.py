#!/usr/bin/env python3
"""Reassemble CLI correction from SHA-pinned published bytes, on development host.
No runtime image change, no target build, no overwrite or inherited acceptance.
"""
import argparse,json,tarfile,re
from pathlib import Path
from package import LIFECYCLE_CLI,sha,fix_installer,fix_operations
PIN='9f7455f10e90e96b40c631a897354074e03d002720e71b02d4348cb41aba9d16'
def produce(source,output,revision):
 assert re.fullmatch('[a-f0-9]{40}',revision)
 assert sha(source)==PIN and not output.exists()
 output.mkdir(mode=0o755);bundle=output/'bundle';bundle.mkdir()
 with tarfile.open(source) as t:
  seen=set()
  for m in t:
   parts=m.name.split('/');assert m.isfile() and len(parts)==2 and parts[0]=='bundle' and parts[1] not in ('','.','..') and m.name not in seen
   seen.add(m.name);p=bundle/parts[1];f=t.extractfile(m);assert f is not None
   with f,p.open('xb') as dst:
    while block:=f.read(1048576):dst.write(block)
   p.chmod(0o755 if p.name=='alicactl' else 0o644)
 old=json.loads((bundle/'release.json').read_text())
 for n,h in old['files'].items():assert sha(bundle/n)==h
 (bundle/'alicactl').write_text(LIFECYCLE_CLI)
 (bundle/'install.py').write_text(fix_installer((bundle/'install.py').read_text()))
 (bundle/'ops.py').write_text(fix_operations((bundle/'ops.py').read_text()))
 old['release']='stage7-qa1-'+revision[:7];old['source_revisions']['stage7_operations']=revision
 old['stage7_assembly'].update({'sourceRevision':revision,'correctedPublishedArchiveSha256':PIN,'correction':'CLI routes through ops.py; explicit file modes survive restrictive umask','runtimeImagesUnchanged':True})
 old['files']={n:sha(bundle/n) for n in old['files']}
 (bundle/'release.json').write_text(json.dumps(old,indent=2)+'\n');release=sha(bundle/'release.json')
 (bundle/'release.sha256').write_text(release+'  release.json\n')
 archive=output/('dsh-stage7-qa1-'+revision[:7]+'-linux-amd64.tar.gz')
 with tarfile.open(archive,'w:gz',compresslevel=1) as t:
  for p in sorted(bundle.iterdir()):
   info=t.gettarinfo(p,arcname='bundle/'+p.name);info.uid=info.gid=0;info.uname=info.gname='root';info.mode=0o755 if p.name=='alicactl' else 0o644
   with p.open('rb') as f:t.addfile(info,f)
 inventory={p.name:sha(p) for p in bundle.iterdir()}
 receipt={'schema':'stage7-candidate-build/v1','sourceRevision':revision,'doghouseRevision':old['stage7_assembly']['doghouseRevision'],'archive':archive.name,'archiveSha256':sha(archive),'archiveBytes':archive.stat().st_size,'releaseSha256':release,'fileCount':len(old['files']),'stage7Accepted':False,'productionAccepted':False}
 (output/'inventory.json').write_text(json.dumps(inventory,indent=2)+'\n');(output/'build-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt),flush=True)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--revision',required=True);a=p.parse_args();produce(a.source,a.output,a.revision)
