#!/usr/bin/env python3
"""Derive a checksummed readiness candidate without rebuilding/importing images."""
import argparse,hashlib,importlib.util,json,os,shutil
from pathlib import Path
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  while b:=f.read(8*1024*1024):h.update(b)
 return h.hexdigest()
def main():
 a=argparse.ArgumentParser();a.add_argument('--base',type=Path,required=True);a.add_argument('--base-sha',required=True);a.add_argument('--output',type=Path,required=True);a.add_argument('--packager',type=Path,required=True);a.add_argument('--revision',required=True);a.add_argument('--ops',type=Path);v=a.parse_args()
 assert not v.output.exists();assert sha(v.base/'release.json')==v.base_sha
 r=json.loads((v.base/'release.json').read_text())
 for n,h in r['files'].items():
  assert not Path(n).is_absolute() and '..' not in Path(n).parts
  assert sha(v.base/n)==h,('modified-base',n)
 spec=importlib.util.spec_from_file_location('stage5_package',v.packager);assert spec and spec.loader
 p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
 v.output.mkdir()
 for n in r['files']:
  dst=v.output/n;dst.parent.mkdir(parents=True,exist_ok=True)
  if n=='images.tar':os.link(v.base/n,dst)
  else:shutil.copyfile(v.base/n,dst)
 if v.ops:
  shutil.copyfile(v.ops,v.output/'ops.py');r['files']['ops.py']=sha(v.output/'ops.py')
  r['source_revisions']['operations_readiness_guard']=v.revision
 c=json.loads((v.output/'compose.template.json').read_text());p.configure_postgres_readiness(c)
 (v.output/'compose.template.json').write_text(json.dumps(c,indent=2)+'\n')
 r['files']['compose.template.json']=sha(v.output/'compose.template.json')
 r['base_stage5_release_sha256']=v.base_sha;r['release']='dsh-stage5-readiness-'+v.revision
 r['source_revisions']['postgres_readiness']=v.revision
 r['acceptance']='DEVELOPMENT CANDIDATE; Stage5 acceptance pending'
 (v.output/'release.json').write_text(json.dumps(r,indent=2)+'\n')
 digest=sha(v.output/'release.json');(v.output/'release.sha256').write_text(digest+'  release.json\n')
 assert sha(v.base/'release.json')==v.base_sha
 print(json.dumps({'candidate':str(v.output),'releaseSha256':digest,'baseUnchanged':True,'imageArchiveReused':True,'imagesUnchanged':True}))
if __name__=='__main__':main()
